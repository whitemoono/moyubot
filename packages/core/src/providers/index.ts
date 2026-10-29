import { providerFetch } from './transport';
import type { ProviderKind, ProviderConfig } from '../types';
import { OpenAICompatibleProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import type { ChatProvider } from './types';
import { ProviderError } from './types';
import { readErrorMessage } from './sse';

export type { ChatProvider, ChatArgs, StreamHandlers, ToolSchema, AgentMessage } from './types';
export { ProviderError } from './types';

export function createChatProvider(config: ProviderConfig, apiKey: string): ChatProvider {
  switch (config.kind) {
    case 'anthropic':
      return new AnthropicProvider(config, apiKey);
    case 'gemini':
      return new GeminiProvider(config, apiKey);
    case 'openai':
    default:
      return new OpenAICompatibleProvider(config, apiKey);
  }
}

export const PROVIDER_PRESETS: { id: string; label: string; kind: ProviderKind; baseUrl: string; model: string; hint: string }[] = [
  { id: 'xai', label: 'xAI Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', hint: '官方 Grok 接口' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', hint: 'GPT / o 系列' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', hint: 'Claude 原生协议' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', hint: '原生 Gemini 协议' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '兼容 OpenAI' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'x-ai/grok-4', hint: '聚合网关' },
  { id: 'dashscope', label: '阿里云百炼', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-max', hint: '通义千问兼容模式' },
  { id: 'moonshot', label: 'Moonshot', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2', hint: 'Kimi 兼容模式' },
  { id: 'ollama', label: '本地 Ollama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', hint: '无需 API Key' },
  { id: 'custom', label: '自定义', kind: 'openai', baseUrl: '', model: '', hint: '任意 OpenAI 兼容端点' },
];

const ASPECT_TO_SIZE: Record<string, { openai: string; gemini: string }> = {
  '1:1': { openai: '1024x1024', gemini: '1:1' },
  '3:2': { openai: '1536x1024', gemini: '3:2' },
  '2:3': { openai: '1024x1536', gemini: '2:3' },
  '4:3': { openai: '1536x1024', gemini: '4:3' },
  '3:4': { openai: '1024x1536', gemini: '3:4' },
  '16:9': { openai: '1536x1024', gemini: '16:9' },
  '9:16': { openai: '1024x1536', gemini: '9:16' },
};

export interface ImageRequest {
  prompt: string;
  aspect: keyof typeof ASPECT_TO_SIZE;
  model?: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
  revisedPrompt?: string;
}

/** Generate an image through the provider's native image API. */
export async function generateImageWithProvider(
  config: ProviderConfig,
  apiKey: string,
  request: ImageRequest,
): Promise<GeneratedImage> {
  const model = request.model || config.imageModel || '';
  const size = ASPECT_TO_SIZE[request.aspect] ?? ASPECT_TO_SIZE['1:1']!;

  if (config.kind === 'gemini') {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model || 'gemini-2.5-flash-image')}:generateContent`;
    const res = await providerFetch(config, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, ...(config.extraHeaders ?? {}) },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: size.gemini },
        },
      }),
    });
    if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
    const payload = (await res.json()) as any;
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        return { bytes: Uint8Array.from(Buffer.from(inline.data, 'base64')), mimeType: inline.mimeType ?? 'image/png' };
      }
    }
    throw new ProviderError('Gemini 没有返回图片（模型可能不支持图像生成）。', 502, 'no_image');
  }

  if (config.kind === 'anthropic') {
    throw new ProviderError('Anthropic 目前不提供图像生成接口，请为这个 Bot 选择支持图像 API 的供应商。', 400, 'no_image_api');
  }

  const res = await providerFetch(config, `${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: model || undefined,
      prompt: request.prompt,
      n: 1,
      size: size.openai,
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) throw new ProviderError(await readErrorMessage(res), res.status);
  const payload = (await res.json()) as any;
  const item = payload.data?.[0];
  if (!item) throw new ProviderError('图像接口没有返回结果。', 502, 'no_image');
  if (item.b64_json) {
    return {
      bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')),
      mimeType: 'image/png',
      revisedPrompt: item.revised_prompt,
    };
  }
  if (item.url) {
    const imageRes = await providerFetch(config, item.url);
    if (!imageRes.ok) throw new ProviderError(`下载生成的图片失败：HTTP ${imageRes.status}`, 502);
    const mimeType = imageRes.headers.get('content-type') ?? 'image/png';
    return { bytes: new Uint8Array(await imageRes.arrayBuffer()), mimeType, revisedPrompt: item.revised_prompt };
  }
  throw new ProviderError('图像接口返回了无法识别的数据。', 502, 'bad_image');
}
