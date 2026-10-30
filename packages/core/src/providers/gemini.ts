import { piChat } from './pi';
import { providerFetch } from './transport';
import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './types';
import { ProviderError, parseToolArguments } from './types';
import { readErrorMessage } from './sse';
import type { ProviderConfig } from '../types';

export class GeminiProvider implements ChatProvider {
  readonly kind = 'gemini' as const;
  constructor(private readonly config: ProviderConfig, private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-goog-api-key': this.apiKey,
      ...(this.config.extraHeaders ?? {}),
    };
  }

  private baseUrl(): string {
    // Accept both https://generativelanguage.googleapis.com/v1beta and .../v1
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    return piChat(this.config, this.apiKey, args, handlers);
  }

  async listModels(): Promise<string[]> {
    const res = await providerFetch(this.config, `${this.baseUrl()}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (payload.models ?? [])
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => model.name.replace(/^models\//, ''));
  }

  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const res = await providerFetch(this.config, `${this.baseUrl()}/models/${encodeURIComponent(this.config.defaultModel)}`, {
        headers: this.headers(),
      });
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) return { ok: false, message: await readErrorMessage(res), latencyMs };
      return { ok: true, message: '连接正常', latencyMs };
    } catch (error) {
      return { ok: false, message: (error as Error).message, latencyMs: Date.now() - startedAt };
    }
  }
}

export function toolArgsFromRaw(raw: unknown): Record<string, unknown> {
  return parseToolArguments(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}));
}
