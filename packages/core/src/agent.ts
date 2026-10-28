import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store';
import type { CloudHost } from './cloud';
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
  ToolResult,
} from './types';
import type { GeneratedImage } from './providers';
import { runTool, schemasFor } from './tools';
import { newId, summarize, truncate } from './util';

export interface AgentRuntimeDeps {
  store: Store;
  cloud: CloudHost;
  emit: (event: AgentEvent) => void;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  maxSteps?: number;
}

interface RunState {
  abort: AbortController;
  conversationId: string;
}

const MAX_HISTORY_MESSAGES = 40;

export class AgentRuntime {
  private readonly store: Store;
  private readonly cloud: CloudHost;
  private readonly emit: (event: AgentEvent) => void;
  private readonly requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  private readonly maxSteps: number;
  private runs = new Map<string, RunState>();

  constructor(deps: AgentRuntimeDeps) {
    this.store = deps.store;
    this.cloud = deps.cloud;
    this.emit = deps.emit;
    this.requestApproval = deps.requestApproval;
    this.maxSteps = deps.maxSteps ?? 14;
  }

  isRunning(conversationId: string): boolean {
    return this.runs.has(conversationId);
  }

  stop(conversationId: string): boolean {
    const run = this.runs.get(conversationId);
    if (!run) return false;
    run.abort.abort();
    this.emit({ type: 'log', level: 'warn', text: '已请求停止当前任务' });
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

  private buildSystemPrompt(bot: Bot): string {
    const facts = this.store
      .listMemories(bot.id)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
      .slice(0, 24);
    const memoryBlock = facts.length
      ? `\n\n长期记忆（关于用户与这个 Bot 的事实）：\n${facts.map((fact) => `- ${fact.text}`).join('\n')}`
      : '';
    const workspace = this.store.getSettings().cloud.workspaceDir;
    return `${bot.systemPrompt.replace(/\{bot_name\}/g, bot.name)}

当前时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
本地工作区（生成图片会存到这里）：${workspace}
共享云电脑：${this.cloud.getSettings().machineName} · 空闲 ${this.store.getSettings().cloud.idleSuspendMinutes} 分钟后自动休眠。
${memoryBlock}`;
  }

  private historyFor(conversation: Conversation): AgentMessage[] {
    const messages = conversation.messages
      .filter((message) => !message.streaming || message.content)
      .slice(-MAX_HISTORY_MESSAGES);
    const history: AgentMessage[] = [];
    for (const message of messages) {
      if (message.role === 'user') {
        history.push({
          role: 'user',
          content: message.content,
          images: message.attachments
            ?.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
            .map((attachment) => ({ mimeType: attachment.mimeType ?? 'image/png', dataUrl: attachment.dataUrl! })),
        });
      } else if (message.role === 'assistant') {
        if (!message.content && !message.toolCalls?.length) continue;
        history.push({ role: 'assistant', content: message.content, toolCalls: message.toolCalls });
        for (const result of message.toolResults ?? []) {
          history.push({
            role: 'tool',
            toolCallId: result.id,
            name: result.name,
            content: truncate(result.detail ?? result.summary, 8000),
          });
        }
      }
    }
    return history;
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

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const bot = this.store.getBot(input.botId);
    if (!bot) throw new Error('Bot 不存在');
    let conversation = input.conversationId ? this.store.getConversation(input.conversationId) : undefined;
    if (!conversation) conversation = this.store.createConversation(bot.id);
    const conversationId = conversation.id;
    if (this.runs.has(conversationId)) throw new Error('这个会话还在生成中，请先停止或等待完成。');

    const runId = newId('run');
    const abort = new AbortController();
    this.runs.set(conversationId, { abort, conversationId });
    this.emit({ type: 'run_start', runId, conversationId });

    const userMessage: Message = {
      id: newId('msg'),
      role: 'user',
      content: input.text,
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
    this.emit({ type: 'message_start', message: assistantMessage });

    void this.runLoop({ bot, conversationId, runId, assistantMessage, abort, history: this.historyFor(this.store.getConversation(conversationId)!) });

    return { conversationId, runId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  }

  private async runLoop(params: {
    bot: Bot;
    conversationId: string;
    runId: string;
    assistantMessage: Message;
    abort: AbortController;
    history: AgentMessage[];
  }): Promise<void> {
    const { bot, conversationId, runId, assistantMessage, abort } = params;
    const message = assistantMessage;
    const history = params.history;
    let errorText: string | undefined;

    try {
      const { provider, imageGenerator } = this.providerFor(bot);
      const system = this.buildSystemPrompt(bot);
      const tools = schemasFor(bot);

      for (let step = 0; step < this.maxSteps; step += 1) {
        if (abort.signal.aborted) throw new Error('任务已停止');
        const pendingCalls: ToolCall[] = [];
        const handlers: StreamHandlers = {
          onText: (chunk) => {
            message.content += chunk;
            this.emit({ type: 'delta', messageId: message.id, text: chunk });
          },
          onReasoning: (chunk) => {
            message.reasoning = (message.reasoning ?? '') + chunk;
            this.emit({ type: 'reasoning', messageId: message.id, text: chunk });
          },
          onToolCall: (call) => pendingCalls.push(call),
        };

        const outcome = await provider.chat(
          { model: bot.model, system, messages: history, tools, temperature: bot.temperature, signal: abort.signal },
          handlers,
        );
        if (outcome.usage) message.usage = outcome.usage;
        if (!pendingCalls.length) break;

        message.toolCalls = [...(message.toolCalls ?? []), ...pendingCalls];
        history.push({ role: 'assistant', content: message.content, toolCalls: pendingCalls });

        for (const call of pendingCalls) {
          if (abort.signal.aborted) throw new Error('任务已停止');
          this.emit({ type: 'tool_start', messageId: message.id, call });
          const result = await runTool(call, {
            bot,
            cloud: this.cloud,
            workspaceDir: this.store.getSettings().cloud.workspaceDir,
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
            remember: (text, pinned) => this.store.addMemory(bot.id, text, pinned),
            recall: (query) =>
              this.store
                .listMemories(bot.id)
                .filter((fact) => fact.text.toLowerCase().includes(query.toLowerCase()))
                .map((fact) => fact.text),
            createSchedule: (cron, prompt) => {
              const schedule = {
                id: newId('sched'),
                botId: bot.id,
                prompt,
                cron,
                enabled: true,
                lastStatus: undefined as undefined,
              };
              return this.store.upsertSchedule(schedule);
            },
            emitStatus: (status, note) => this.emit({ type: 'cloud', status, note }),
            signal: abort.signal,
          });

          message.toolResults = [...(message.toolResults ?? []), result];
          this.emit({ type: 'tool_end', messageId: message.id, result });
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
        message.content = message.content || '';
      } else {
        errorText = error instanceof ProviderError ? error.message : (error as Error).message;
        message.error = errorText;
      }
      this.emit({ type: 'log', level: 'error', text: summarize(errorText, 300) });
    } finally {
      message.streaming = false;
      if (!message.content) {
        message.content = message.error ? `（没有回复：${message.error}）` : message.toolCalls?.length ? '' : '（空回复）';
      }
      this.store.appendMessage(conversationId, message);
      this.emit({ type: 'message_end', message });
      this.emit({ type: 'run_end', runId, ok: !errorText, error: errorText });
      this.runs.delete(conversationId);
      this.cloud.touch();
      this.cloud.armIdleIfNeeded?.();
    }
  }

  async runUnattended(botId: string, prompt: string): Promise<{ conversationId: string }> {
    const bot = this.store.getBot(botId);
    if (!bot) throw new Error('Bot 不存在');
    const result = await this.send({ botId, text: prompt });
    return { conversationId: result.conversationId };
  }
}

/** Resolve the artifact path to a file inside the workspace, guarding traversal. */
export function resolveArtifact(workspaceDir: string, relative: string): string | undefined {
  const resolved = path.resolve(workspaceDir, relative);
  if (!resolved.startsWith(path.resolve(workspaceDir) + path.sep)) return undefined;
  return fs.existsSync(resolved) ? resolved : undefined;
}