import { piChat } from './pi';
import { providerFetch } from './transport';
import type { ChatArgs, ChatOutcome, ChatProvider, ModelCatalogEntry, StreamHandlers } from './types';
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

  /** Parses OpenAI-style /v1/models entries (magpie, OpenRouter, vLLM…) including limits. */
  async listModelCatalog(): Promise<ModelCatalogEntry[]> {
    const res = await providerFetch(this.config, `${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { data?: any[]; models?: any[] };
    const rows = payload.data ?? payload.models ?? [];
    const seen = new Set<string>();
    const entries: ModelCatalogEntry[] = [];
    for (const item of rows) {
      const id = String(item?.id ?? item?.name ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const context = item?.context_window ?? item?.context_length ?? item?.max_input_tokens ?? item?.limit?.context;
      const maxOut = item?.max_output_tokens ?? item?.limit?.output;
      const name = typeof item?.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : undefined;
      entries.push({
        id,
        name: name && name !== id ? name : undefined,
        contextWindowTokens: typeof context === 'number' && context > 0 ? Math.floor(context) : undefined,
        maxOutputTokens: typeof maxOut === 'number' && maxOut > 0 ? Math.floor(maxOut) : undefined,
      });
    }
    return entries.sort((a, b) => a.id.localeCompare(b.id));
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
