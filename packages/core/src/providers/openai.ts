import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers, ToolSchema } from './types';
import { ProviderError, parseToolArguments } from './types';
import { iterSse, readErrorMessage } from './sse';
import type { ProviderConfig } from '../types';

/** OpenAI-compatible /chat/completions provider: xAI, OpenAI, DeepSeek, OpenRouter, Ollama, … */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly kind = 'openai' as const;
  constructor(private readonly config: ProviderConfig, private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...(this.config.extraHeaders ?? {}),
    };
  }

  private toOpenAiMessages(system: string, messages: ChatArgs['messages']) {
    const out: any[] = [];
    if (system.trim()) out.push({ role: 'system', content: system });
    for (const message of messages) {
      if (message.role === 'user') {
        if (message.images?.length) {
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: message.content },
              ...message.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
            ],
          });
        } else {
          out.push({ role: 'user', content: message.content });
        }
      } else if (message.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: message.content || null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }
            : {}),
        });
      } else {
        out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      }
    }
    return out;
  }

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    if (!this.apiKey && !this.config.baseUrl.includes('localhost') && !this.config.baseUrl.includes('127.0.0.1')) {
      throw new ProviderError('该供应商还没有填写 API Key，请在设置里补上。', 401, 'missing_key');
    }
    const tools: ToolSchema[] = args.tools;
    const body: Record<string, unknown> = {
      model: args.model,
      temperature: args.temperature,
      stream: true,
      messages: this.toOpenAiMessages(args.system, args.messages),
      ...(tools.length
        ? {
            tools: tools.map((tool) => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
    };

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: args.signal,
    });
    if (!res.ok) {
      throw new ProviderError(await readErrorMessage(res), res.status);
    }

    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason = 'stop';
    let usage: ChatOutcome['usage'];
    let gotAnyContent = false;

    for await (const event of iterSse(res)) {
      if (!event.data || event.data === '[DONE]') continue;
      let chunk: any;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError(chunk.error.message ?? 'provider stream error', 500);
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) handlers.onReasoning?.(reasoning);
      if (typeof delta.content === 'string' && delta.content) {
        gotAnyContent = true;
        handlers.onText(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const part of delta.tool_calls) {
          const index = typeof part.index === 'number' ? part.index : 0;
          const current = toolAcc.get(index) ?? { id: '', name: '', arguments: '' };
          if (part.id) current.id = part.id;
          if (part.function?.name) current.name += part.function.name;
          if (part.function?.arguments) current.arguments += part.function.arguments;
          toolAcc.set(index, current);
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    for (const [index, call] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (!call.name) continue;
      handlers.onToolCall({
        id: call.id || `call_${index}_${Date.now().toString(36)}`,
        name: call.name,
        arguments: parseToolArguments(call.arguments),
      });
    }
    if (!gotAnyContent && toolAcc.size === 0 && finishReason === 'stop') {
      throw new ProviderError('供应商返回了空回复，请重试或换一个模型。', 502, 'empty_response');
    }
    return { finishReason, usage };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { data?: { id: string }[]; models?: { id: string; name: string }[] };
    const ids = (payload.data ?? payload.models ?? []).map((item) => item.id ?? (item as any).name).filter(Boolean);
    return ids.sort();
  }

  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          stream: false,
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