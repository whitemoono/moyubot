import type { Store } from './store';
import type { AgentRuntime } from './agent';
import { sleep, truncate } from './util';

export interface TelegramGatewayDeps {
  store: Store;
  runtime: AgentRuntime;
  token: string;
  onLog?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string; username?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

/** Outbound-only Telegram long-polling gateway with a strict allowlist. */
export class TelegramGateway {
  private offset = 0;
  private stopped = false;
  private polling = false;
  private readonly deps: TelegramGatewayDeps;

  constructor(deps: TelegramGatewayDeps) {
    this.deps = deps;
  }

  private api(method: string, body: Record<string, unknown>): Promise<any> {
    return fetch(`https://api.telegram.org/bot${this.deps.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => res.json());
  }

  async start(): Promise<void> {
    if (!this.deps.token) {
      this.deps.onLog?.('warn', 'Telegram 已启用但缺少 Bot Token');
      return;
    }
    const allow = this.deps.store.getSettings().telegram.allowedIds;
    if (allow.length === 0) {
      this.deps.onLog?.('warn', 'Telegram 白名单为空，网关默认拒绝所有消息（fail closed）');
    }
    const me = await this.api('getMe', {}).catch(() => null);
    if (!me?.ok) {
      this.deps.onLog?.('error', `Telegram Token 无效：${me?.description ?? '未知错误'}`);
      return;
    }
    this.deps.onLog?.('info', `Telegram 网关已启动：@${me.result?.username ?? 'bot'}`);
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    this.polling = true;
    while (!this.stopped) {
      try {
        const res = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message'],
        });
        if (!res?.ok) {
          this.deps.onLog?.('error', `Telegram 拉取失败：${res?.description ?? 'network'}`);
          await sleep(5000);
          continue;
        }
        for (const update of res.result as TelegramUpdate[]) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          if (update.message?.text) await this.handle(update.message);
        }
      } catch (error) {
        this.deps.onLog?.('warn', `Telegram 轮询异常：${(error as Error).message}`);
        await sleep(3000);
      }
    }
    this.polling = false;
  }

  private async reply(chatId: number, text: string): Promise<void> {
    await this.api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }).catch(() => undefined);
  }

  private async handle(message: NonNullable<TelegramUpdate['message']>): Promise<void> {
    const settings = this.deps.store.getSettings();
    const chatId = message.chat.id;
    const allowed = settings.telegram.allowedIds.map((id) => id.trim()).filter(Boolean);
    if (!allowed.includes(String(chatId)) && !allowed.includes(String(message.from?.id ?? ''))) {
      await this.reply(chatId, `⛔ 未授权的会话 (chat ${chatId})。\n把 ${chatId} 加进 MoyuBot → 设置 → Telegram 白名单。`);
      return;
    }
    const text = (message.text ?? '').trim();
    const botId = settings.telegram.defaultBotId ?? settings.bots[0]?.id;
    const bot = botId ? this.deps.store.getBot(botId) : undefined;
    if (!bot) {
      await this.reply(chatId, '还没有可用的 Bot，请先在桌面端创建一个。');
      return;
    }

    if (text === '/help' || text === '/start') {
      await this.reply(
        chatId,
        `MoyuBot · ${bot.name}\n直接发消息，继续这个 Bot 的固定对话。较早内容会自动压缩并整理记忆。\n/status 云主机状态\n/account 当前绑定\n/help 帮助`,
      );
      return;
    }
    if (text === '/status') {
      const status = this.deps.store.getSettings().cloud;
      await this.reply(chatId, `云主机：${status.machineName}\n空闲 ${status.idleSuspendMinutes} 分钟后休眠`);
      return;
    }
    if (text === '/account') {
      await this.reply(chatId, `当前 Bot：${bot.name}（${bot.model}）`);
      return;
    }
    if (text === '/new') {
      await this.reply(chatId, '每个 Bot 只有一个持续对话，无需新建。直接发送消息即可继续，上下文会自动整理。');
      return;
    }

    const startedAt = Date.now();
    const { conversationId } = await this.deps.runtime.send({ botId: bot.id, text });
    let assistantText = '';
    for (let i = 0; i < 600; i += 1) {
      await sleep(700);
      if (!this.deps.runtime.isRunning(conversationId)) {
        const conv = this.deps.store.getConversation(conversationId);
        const last = [...(conv?.messages ?? [])].reverse().find((msg) => msg.role === 'assistant' && msg.createdAt >= startedAt);
        assistantText = last?.content ?? '';
        break;
      }
    }
    await this.reply(chatId, truncate(assistantText || '（没有回复）', 3800));
  }
}
