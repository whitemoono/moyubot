import type { ChatArgs, ChatOutcome, ChatProvider, StreamHandlers } from './types';
import { ProviderError, splitDataUrl, parseToolArguments } from './types';
import { iterSse, readErrorMessage } from './sse';
import type { ProviderConfig } from '../types';

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

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

  private buildContents(args: ChatArgs) {
    const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
    for (const message of args.messages) {
      if (message.role === 'user') {
        const parts: GeminiPart[] = [];
        for (const image of message.images ?? []) {
          const split = splitDataUrl(image.dataUrl);
          if (split) parts.push({ inlineData: { mimeType: split.mimeType, data: split.base64 } });
        }
        if (message.content) parts.push({ text: message.content });
        contents.push({ role: 'user', parts });
      } else if (message.role === 'assistant') {
        const parts: GeminiPart[] = [];
        if (message.content) parts.push({ text: message.content });
        for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.arguments } });
        if (parts.length) contents.push({ role: 'model', parts });
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: message.name, response: { content: message.content } } }],
        });
      }
    }
    return contents;
  }

  async chat(args: ChatArgs, handlers: StreamHandlers): Promise<ChatOutcome> {
    if (!this.apiKey) throw new ProviderError('该供应商还没有填写 API Key。', 401, 'missing_key');
    const url = `${this.baseUrl()}/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`;
    const body = {
      contents: this.buildContents(args),
      ...(args.system.trim() ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
      ...(args.tools.length
        ? {
            tools: [
              {
                functionDeclarations: args.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        temperature: args.temperature,
        ...(args.maxTokens ? { maxOutputTokens: args.maxTokens } : {}),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: args.signal,
    });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);

    let sawContent = false;
    let finishReason = 'stop';
    let usage: ChatOutcome['usage'];
    let functionCallIndex = 0;

    for await (const event of iterSse(res)) {
      if (!event.data || event.data === '[DONE]') continue;
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (payload.error) throw new ProviderError(payload.error.message ?? 'Gemini stream error', 500);
      if (payload.usageMetadata) {
        usage = {
          promptTokens: payload.usageMetadata.promptTokenCount,
          completionTokens: payload.usageMetadata.candidatesTokenCount,
        };
      }
      const candidate = payload.candidates?.[0];
      if (!candidate) continue;
      for (const part of candidate.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text) {
          sawContent = true;
          handlers.onText(part.text);
        }
        if (part.functionCall) {
          sawContent = true;
          handlers.onToolCall({
            id: part.functionCall.id ?? `gemini_call_${functionCallIndex++}_${Date.now().toString(36)}`,
            name: part.functionCall.name,
            arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }
      if (candidate.finishReason) finishReason = String(candidate.finishReason).toLowerCase();
    }

    if (!sawContent) throw new ProviderError('供应商返回了空回复。', 502, 'empty_response');
    return { finishReason, usage };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl()}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (payload.models ?? [])
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => model.name.replace(/^models\//, ''));
  }

  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.baseUrl()}/models/${encodeURIComponent(this.config.defaultModel)}`, {
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