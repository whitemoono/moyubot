/**
 * Renderer-side copy of the provider presets.
 * The core package keeps the authoritative list (it needs no DOM); importing it here
 * would pull node-only modules into the renderer bundle.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: 'openai' | 'anthropic' | 'gemini';
  baseUrl: string;
  model: string;
  hint: string;
}

export const PRESETS: ProviderPreset[] = [
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