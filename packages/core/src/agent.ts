import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store';
import type { CloudHost, ComputerHost } from './cloud';
import { createChatProvider, generateImageWithProvider } from './providers';
import type { AgentMessage, ChatProvider, StreamHandlers } from './providers';
import { ProviderError } from './providers';
import type {
  AgentEvent,
  ApprovalRequest,
  Bot,
  ChatImageInput,
  Conversation,
  Message,
  SendMessageInput,
  SendMessageResult,
  ToolCall,
} from './types';
import type { GeneratedImage } from './providers';
import { runTool, schemasFor, toolNamesFor } from './tools';
import { newId, summarize, truncate } from './util';
import { contextWindow, isContextOverflow, messagesFor, prepareContext } from './context';
import { trackedChat } from './usage';

export interface AgentRuntimeDeps {
  store: Store;
  cloud: CloudHost;
  computers?: Record<string, ComputerHost>;
  emit: (event: AgentEvent) => void;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  maxSteps?: number;
}

interface RunState {
  abort: AbortController;
  conversationId: string;
}

export class AgentRuntime {
  private readonly store: Store;
  private readonly cloud: CloudHost;
  private readonly computers: Record<string, ComputerHost>;
  private readonly emit: (event: AgentEvent) => void;
  private readonly requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  private readonly maxSteps: number;
  private runs = new Map<string, RunState>();
  private runCompletions = new Map<string, Promise<void>>();

  constructor(deps: AgentRuntimeDeps) {
    this.store = deps.store;
    this.cloud = deps.cloud;
    this.computers = deps.computers ?? {};
    this.emit = deps.emit;
    this.requestApproval = deps.requestApproval;
    this.maxSteps = deps.maxSteps ?? 14;
  }

  private computerFor(bot: Bot): ComputerHost {
    return this.computers[bot.workspaceId ?? 'workspace_cloud'] ?? this.cloud;
  }

  isRunning(conversationId: string): boolean {
    return this.runs.has(conversationId);
  }

  stop(conversationId: string): boolean {
    const run = this.runs.get(conversationId);
    if (!run) return false;
    run.abort.abort();
    this.emit({ type: 'log', level: 'info', text: '已请求停止当前任务' });
    return true;
  }

  private providerFor(bot: Bot): { provider: ChatProvider; imageGenerator: (req: { prompt: string; aspect: Bot['image']['aspect'] }) => Promise<GeneratedImage> } {
    const config = this.store.getProvider(bot.providerId);
    if (!config) throw new Error('找不到这个 Bot 绑定的供应商，请在设置里重新选择。');
    const apiKey = this.store.secrets.get(this.store.providerSecretKey(config.id)) ?? '';
    const provider = createChatProvider(config, apiKey);
    return {
      provider,
      imageGenerator: (request) => generateImageWithProvider(config, apiKey, request),
    };
  }

  private buildSystemPrompt(bot: Bot, memoryScope = bot.id): string {
    const facts = this.store
      .listMemories(memoryScope)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
      .slice(0, 24);
    const memoryBlock = facts.length
      ? `\n\n长期记忆（关于用户与这个 Bot 的事实）：\n${facts.map((fact) => `- ${fact.text}`).join('\n')}`
      : '';
    const computer = this.computerFor(bot);
    const workspace = computer.getSettings().workspaceDir;
    const scheduleGuide = toolNamesFor(bot).includes('schedule_task') ? `\n\n定时任务（本地时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}）：用户要求或已允许后续执行才创建；时间不明确先询问。创建前查重，修改前用 list_tasks 定位，不能猜 ID。周期用 cron，一次用含时区 runAt。仅工具成功后确认操作和执行时间；到点执行不要重新创建同一任务。` : '';
    return `${bot.systemPrompt.replace(/\{bot_name\}/g, bot.name)}

当前时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
本地工作区（生成图片会存到这里）：${workspace}
当前工作区电脑：${computer.getSettings().machineName}${bot.workspaceId === 'workspace_local' ? '（本机 Windows）' : ` · 空闲 ${this.store.getSettings().cloud.idleSuspendMinutes} 分钟后自动休眠`}。
${memoryBlock}${scheduleGuide}`;
  }

  private attachmentsFrom(images: ChatImageInput[] | undefined) {
    if (!images?.length) return undefined;
    return images.map((image) => ({
      id: newId('att'),
      kind: 'image' as const,
      name: image.name ?? '粘贴的图片',
      mimeType: image.mimeType,
      dataUrl: image.dataUrl,
    }));
  }

  private replyFrom(input: SendMessageInput, conversation: Conversation): Message['replyTo'] {
    if (!input.replyTo) return undefined;
    const source = conversation.messages.find((message) => message.id === input.replyTo!.messageId);
    if (!source || !['user', 'assistant'].includes(source.role) || source.streaming) throw new Error('这条消息暂时无法引用，请重新选择。');
    const selected = input.replyTo.selectedText?.trim();
    if (selected && !source.content.includes(selected)) throw new Error('引用的文字与原消息不一致，请重新选择。');
    const author = source.role === 'user' ? '你' : source.botName ?? this.store.getBot(source.botId ?? conversation.botId)?.name ?? 'Bot';
    return { messageId: source.id, author, content: selected || source.content || source.attachments?.map((file) => `[图片：${file.name ?? '图片'}]`).join('\n') || '（空消息）' };
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const target = input.conversationId ? this.store.getConversation(input.conversationId) : undefined;
    if (target?.group) return this.sendGroup(input, target.id);
    const bot = this.store.getBot(input.botId);
    if (!bot) throw new Error('Bot 不存在');
    const requested = input.conversationId ? this.store.getConversation(input.conversationId) : undefined;
    if (requested && requested.botId !== bot.id) throw new Error('不能向其他 Bot 的会话发送消息');
    const conversation = this.store.botConversation(bot.id);
    const conversationId = conversation.id;
    if (this.runs.has(conversationId)) throw new Error('这个会话还在生成中，请先停止或等待完成。');
    const replyTo = this.replyFrom(input, conversation);

    const runId = newId('run');
    const abort = new AbortController();
    this.runs.set(conversationId, { abort, conversationId });
    this.emit({ type: 'run_start', runId, conversationId });

    const userMessage: Message = {
      id: newId('msg'),
      role: 'user',
      content: input.text,
      replyTo,
      createdAt: Date.now(),
      attachments: this.attachmentsFrom(input.images),
    };
    this.store.appendMessage(conversationId, userMessage);

    const assistantMessage: Message = {
      id: newId('msg'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: bot.model,
      streaming: true,
      toolCalls: [],
      toolResults: [],
    };
    this.store.appendMessage(conversationId, assistantMessage);
    this.emit({ type: 'message_start', conversationId, message: assistantMessage });

    const completion = this.runLoop({ bot, conversationId, runId, assistantMessage, abort, userMessage });
    this.runCompletions.set(conversationId, completion);
    void completion.finally(() => { if (this.runCompletions.get(conversationId) === completion) this.runCompletions.delete(conversationId); }).catch(() => {});

    return { conversationId, runId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  }

  private async sendGroup(input: SendMessageInput, conversationId: string): Promise<SendMessageResult> {
    const conversation = this.store.getConversation(conversationId)!;
    if (this.runs.has(conversationId)) throw new Error('群聊正在回复，请先停止或等待完成。');
    const bots = conversation.group!.memberBotIds.map((id) => this.store.getBot(id)).filter((bot): bot is Bot => !!bot);
    if (!bots.length) throw new Error('群聊已没有可用的 Bot，请重新创建群聊。');
    const replyTo = this.replyFrom(input, conversation);
    const runId = newId('run');
    const abort = new AbortController();
    this.runs.set(conversationId, { abort, conversationId });
    this.emit({ type: 'run_start', runId, conversationId });
    const userMessage: Message = { id: newId('msg'), role: 'user', content: input.text, replyTo, createdAt: Date.now(), attachments: this.attachmentsFrom(input.images) };
    this.store.appendMessage(conversationId, userMessage);
    const startReply = (bot: Bot): Message => {
      const message: Message = { id: newId('msg'), role: 'assistant', botId: bot.id, botName: bot.name, content: '', model: bot.model, createdAt: Date.now(), streaming: true, toolCalls: [], toolResults: [] };
      this.store.appendMessage(conversationId, message);
      this.emit({ type: 'message_start', conversationId, message });
      return message;
    };
    const first = startReply(bots[0]!);
    void (async () => {
      let error: string | undefined;
      try {
        for (const [index, bot] of bots.entries()) {
          if (abort.signal.aborted) break;
          const assistantMessage = index === 0 ? first : startReply(bot);
          await this.runLoop({ bot, conversationId, runId, assistantMessage, abort, userMessage, group: true });
          if (assistantMessage.error) error = assistantMessage.error;
        }
      } catch (failure) {
        error = (failure as Error).message;
        if (first.streaming) {
          first.streaming = false; first.error = error;
          this.store.appendMessage(conversationId, first);
          this.emit({ type: 'message_end', conversationId, message: first });
        }
      } finally {
        if (abort.signal.aborted) error = '已停止';
        this.runs.delete(conversationId);
        this.emit({ type: 'run_end', conversationId, runId, ok: !error, error });
      }
    })();
    return { conversationId, runId, userMessageId: userMessage.id, assistantMessageId: first.id };
  }

  private async runLoop(params: {
    bot: Bot;
    conversationId: string;
    runId: string;
    assistantMessage: Message;
    abort: AbortController;
    userMessage: Message;
    group?: boolean;
  }): Promise<void> {
    const { bot, conversationId, runId, assistantMessage, abort } = params;
    const message = assistantMessage;
    message.usageTracked = true;
    const conversation = this.store.getConversation(conversationId)!;
    const history: AgentMessage[] = params.group ? messagesFor(conversation.messages.slice(conversation.messages.findIndex((item) => item.id === params.userMessage.id), -1), bot.id) : messagesFor([params.userMessage]);
    const memoryScope = params.group ? conversationId : bot.id;
    let errorText: string | undefined;

    try {
      const { provider, imageGenerator } = this.providerFor(bot);
      const tools = schemasFor(bot);

      for (let step = 0; step < this.maxSteps; step += 1) {
        if (abort.signal.aborted) throw new Error('任务已停止');
        let pendingCalls: ToolCall[] = [];
        const contentBefore = message.content.length;
        const reasoningBefore = message.reasoning?.length ?? 0;
        const handlers: StreamHandlers = {
          onText: (chunk) => {
            message.content += chunk;
            this.emit({ type: 'delta', conversationId, messageId: message.id, text: chunk });
          },
          onReasoning: (chunk) => {
            message.reasoning = (message.reasoning ?? '') + chunk;
            this.emit({ type: 'reasoning', conversationId, messageId: message.id, text: chunk });
          },
          onToolCall: (call) => pendingCalls.push(call),
        };

        let outcome;
        for (let recovery = 0; recovery < 3; recovery++) {
          const context = await prepareContext({
            store: this.store, bot, provider, conversation: this.store.getConversation(conversationId)!,
            userMessageId: params.userMessage.id, live: history, system: this.buildSystemPrompt(bot, memoryScope) + (params.group ? `\n\n你正在群聊「${conversation.title}」中，以 ${bot.name} 的身份发言。群成员：${conversation.group!.memberBotIds.map((id) => this.store.getBot(id)?.name ?? '已移除的 Bot').join('、')}。每轮按成员顺序回复，参考其他成员的发言，补充有用观点；只代表自己，不冒充用户或其他成员。` : ''), tools,
            signal: abort.signal, emit: this.emit, recovery,
          });
          try {
            outcome = await trackedChat(this.store, bot, conversationId, 'chat', provider, { model: bot.model, ...context, tools, temperature: bot.temperature,
              maxTokens: Math.min(4096, Math.floor(contextWindow(this.store, bot) * .2)), signal: abort.signal }, handlers, message.id);
            break;
          } catch (error) {
            // A rejected request is retried only before any visible output or side effect.
            if (!isContextOverflow(error) || recovery === 2 || message.content.length !== contentBefore || (message.reasoning?.length ?? 0) !== reasoningBefore || pendingCalls.length) throw error;
            pendingCalls = [];
          }
        }
        if (!outcome) throw new Error('模型上下文不足，自动压缩后仍无法继续；完整消息已保留。');
        if (outcome.usage) message.usage = {
          promptTokens: (message.usage?.promptTokens ?? 0) + (outcome.usage.promptTokens ?? 0),
          completionTokens: (message.usage?.completionTokens ?? 0) + (outcome.usage.completionTokens ?? 0),
        };
        if (!pendingCalls.length) break;

        message.toolCalls = [...(message.toolCalls ?? []), ...pendingCalls];
        history.push({ role: 'assistant', content: message.content.slice(contentBefore), toolCalls: pendingCalls });

        for (const call of pendingCalls) {
          if (abort.signal.aborted) throw new Error('任务已停止');
          this.emit({ type: 'tool_start', conversationId, messageId: message.id, call });
          const result = await runTool(call, {
            bot,
            cloud: this.computerFor(bot),
            workspaceDir: this.computerFor(bot).getSettings().workspaceDir,
            imageApiKey: '',
            imageGenerator,
            requestApproval:
              bot.approvalPolicy === 'ask'
                ? (pending, summary) =>
                    this.requestApproval({
                      id: newId('approval'),
                      conversationId,
                      botId: bot.id,
                      toolName: pending.name,
                      summary,
                      command: typeof pending.arguments.cmd === 'string' ? pending.arguments.cmd : undefined,
                      createdAt: Date.now(),
                    })
                : undefined,
            remember: (text, pinned) => this.store.addMemory(memoryScope, text, pinned),
            recall: (query) =>
              this.store
                .listMemories(memoryScope)
                .filter((fact) => fact.text.toLowerCase().includes(query.toLowerCase()))
                .map((fact) => fact.text),
            createSchedule: (input) => this.store.createSchedule(bot.id, input),
            listTasks: (includeClosed) => this.store.listSchedules().filter((task) => task.botId === bot.id && (includeClosed || !task.closedAt && !task.completedAt)),
            updateTask: (id, patch) => this.store.updateSchedule(bot.id, id, patch),
            emitStatus: (status, note) => this.emit({ type: 'cloud', status, note }),
            signal: abort.signal,
          });

          message.toolResults = [...(message.toolResults ?? []), result];
          this.emit({ type: 'tool_end', conversationId, messageId: message.id, result });
          if (result.artifactPath) {
            message.attachments = [
              ...(message.attachments ?? []),
              {
                id: newId('att'),
                kind: 'image',
                name: path.basename(result.artifactPath),
                path: result.artifactPath,
                mimeType: result.artifactPath.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
              },
            ];
          }
          this.store.appendMessage(conversationId, message);
          history.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: truncate(result.ok ? result.detail ?? result.summary : `错误：${result.summary}\n${result.detail ?? ''}`, 8000),
          });
        }
      }
    } catch (error) {
      if (abort.signal.aborted) {
        errorText = '已停止';
        message.stopped = true;
        message.content = message.content || '';
      } else {
        errorText = error instanceof ProviderError ? error.message : (error as Error).message;
        message.error = errorText;
      }
      this.emit({ type: 'log', level: abort.signal.aborted ? 'info' : 'error', text: summarize(errorText, 300) });
    } finally {
      message.streaming = false;
      if (!message.content) {
        message.content = message.error ? `（没有回复：${message.error}）` : message.stopped || message.toolCalls?.length ? '' : '（空回复）';
      }
      this.store.appendMessage(conversationId, message);
      this.emit({ type: 'message_end', conversationId, message });
      if (!params.group) {
        this.runs.delete(conversationId);
        this.emit({ type: 'run_end', conversationId, runId, ok: !errorText, error: errorText });
      }
      this.computerFor(bot).touch();
      this.computerFor(bot).armIdleIfNeeded?.();
    }
  }

  async runUnattended(botId: string, prompt: string): Promise<{ conversationId: string }> {
    const bot = this.store.getBot(botId);
    if (!bot) throw new Error('Bot 不存在');
    const result = await this.send({ botId, text: prompt });
    await this.runCompletions.get(result.conversationId);
    const reply = this.store.getConversation(result.conversationId)?.messages.find((message) => message.id === result.assistantMessageId);
    if (reply?.error || reply?.stopped) throw new Error(reply.error || '任务已停止');
    return { conversationId: result.conversationId };
  }
}

/** Resolve the artifact path to a file inside the workspace, guarding traversal. */
export function resolveArtifact(workspaceDir: string, relative: string): string | undefined {
  const resolved = path.resolve(workspaceDir, relative);
  if (!resolved.startsWith(path.resolve(workspaceDir) + path.sep)) return undefined;
  return fs.existsSync(resolved) ? resolved : undefined;
}
