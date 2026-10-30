import { piChat } from './pi';
import { providerFetch } from './transport';
import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './types';
import { ProviderError } from './types';
import { readErrorMessage } from './sse';
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

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    return piChat(this.config, this.apiKey, args, handlers);
  }

  async listModels(): Promise<string[]> {
    const res = await providerFetch(this.config, `${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { data?: { id: string }[]; models?: { id: string; name: string }[] };
    const ids = (payload.data ?? payload.models ?? []).map((item) => item.id ?? (item as any).name).filter(Boolean);
    return ids.sort();
  }

  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const res = await providerFetch(this.config, `${this.config.baseUrl}/chat/completions`, {
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
