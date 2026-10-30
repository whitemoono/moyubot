import { piChat } from './pi';
import { providerFetch } from './transport';
import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './types';
import { ProviderError } from './types';
import { readErrorMessage } from './sse';
import type { ProviderConfig } from '../types';

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

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    return piChat(this.config, this.apiKey, args, handlers);
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
