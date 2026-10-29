import { providerFetch } from './transport';
import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './types';
import { ProviderError, splitDataUrl, parseToolArguments } from './types';
import { iterSse, readErrorMessage } from './sse';
import type { ProviderConfig } from '../types';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export class AnthropicProvider implements ChatProvider {
  readonly kind = 'anthropic' as const;
  constructor(private readonly config: ProviderConfig, private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...(this.config.extraHeaders ?? {}),
    };
  }

  private buildMessages(args: ChatArgs): { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] {
    const messages: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
    for (const message of args.messages) {
      let role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user';
      const blocks: AnthropicBlock[] = [];
      if (message.role === 'user') {
        for (const image of message.images ?? []) {
          const split = splitDataUrl(image.dataUrl);
          if (split) {
            blocks.push({ type: 'image', source: { type: 'base64', media_type: split.mimeType, data: split.base64 } });
          }
        }
        if (message.content) blocks.push({ type: 'text', text: message.content });
      } else if (message.role === 'assistant') {
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
        }
      } else {
        role = 'user';
        blocks.push({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content });
      }
      if (blocks.length === 0) continue;
      const last = messages.at(-1);
      if (last && last.role === role) last.content.push(...blocks);
      else messages.push({ role, content: blocks });
    }
    return messages;
  }

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    if (!this.apiKey) throw new ProviderError('该供应商还没有填写 API Key。', 401, 'missing_key');
    const body = {
      model: args.model,
      max_tokens: args.maxTokens ?? 4096,
      temperature: args.temperature,
      stream: true,
      ...(args.system.trim() ? { system: args.system } : {}),
      messages: this.buildMessages(args),
      ...(args.tools.length
        ? {
            tools: args.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    };

    const url = this.config.baseUrl.endsWith('/v1')
      ? `${this.config.baseUrl}/messages`
      : `${this.config.baseUrl}/v1/messages`;
    const res = await providerFetch(this.config, url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: args.signal,
    });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);

    let finishReason = 'stop';
    let usage: ChatOutcome['usage'];
    const pending = new Map<number, { id: string; name: string; json: string }>();
    let sawContent = false;

    for await (const event of iterSse(res)) {
      if (!event.data) continue;
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }
      switch (payload.type) {
        case 'message_start':
          if (payload.message?.usage) {
            const input = payload.message.usage;
            usage = { promptTokens: (input.input_tokens ?? 0) + (input.cache_read_input_tokens ?? 0) + (input.cache_creation_input_tokens ?? 0), completionTokens: input.output_tokens,
              cachedTokens: input.cache_read_input_tokens };
            handlers.onUsage?.(usage);
          }
          break;
        case 'content_block_start': {
          const block = payload.content_block;
          if (block?.type === 'tool_use') {
            pending.set(payload.index, { id: block.id, name: block.name, json: '' });
          } else if (block?.type === 'text' && block.text) {
            sawContent = true;
            handlers.onText(block.text);
          }
          break;
        }
        case 'content_block_delta': {
          const delta = payload.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            sawContent = true;
            handlers.onText(delta.text);
          } else if (delta?.type === 'input_json_delta') {
            const entry = pending.get(payload.index);
            if (entry) entry.json += delta.partial_json ?? '';
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            handlers.onReasoning?.(delta.thinking);
          }
          break;
        }
        case 'message_delta':
          if (payload.delta?.stop_reason) finishReason = payload.delta.stop_reason;
          if (typeof payload.usage?.output_tokens === 'number') {
            usage = { ...usage, completionTokens: payload.usage.output_tokens };
            handlers.onUsage?.(usage);
          }
          break;
        case 'error':
          throw new ProviderError(payload.error?.message ?? 'Anthropic stream error', 500);
        default:
          break;
      }
    }

    for (const entry of pending.values()) {
      handlers.onToolCall({ id: entry.id, name: entry.name, arguments: parseToolArguments(entry.json) });
    }
    if (!sawContent && pending.size === 0) {
      throw new ProviderError('供应商返回了空回复。', 502, 'empty_response');
    }
    return { finishReason, usage };
  }

  async listModels(): Promise<string[]> {
    const base = this.config.baseUrl.replace(/\/v1$/, '');
    const res = await providerFetch(this.config, `${base}/v1/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { data?: { id: string }[] };
    return (payload.data ?? []).map((item) => item.id);
  }

  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const base = this.config.baseUrl.replace(/\/v1$/, '');
      const res = await providerFetch(this.config, `${base}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.defaultModel,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) return { ok: false, message: await readErrorMessage(res), latencyMs };
      return { ok: true, message: '连接正常', latencyMs };
    } catch (error) {
      return { ok: false, message: (error as Error).message, latencyMs: Date.now() - startedAt };
    }
  }
}
