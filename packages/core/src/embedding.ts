import type { EmbeddingSettings } from './types';

/** 向量模型（embedding）客户端：OpenAI 兼容的 /embeddings 端点，如硅基流动、阿里云百炼等。 */
export async function embedTexts(config: EmbeddingSettings | undefined, apiKey: string, inputs: string[], timeoutMs = 20000): Promise<Float32Array[]> {
  if (!inputs.length) return [];
  if (!config?.enabled) throw new Error('向量模型未启用');
  if (!config.baseUrl || !config.model) throw new Error('向量模型未配置完整');
  if (!apiKey) throw new Error('向量模型 API Key 未配置');
  const base = config.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: inputs, encoding_format: 'float' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`向量服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }
  const payload = await response.json() as { data?: { index?: number; embedding?: number[] }[] };
  const items = payload.data;
  if (!Array.isArray(items) || items.length !== inputs.length) throw new Error('向量服务返回格式异常');
  const ordered = [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((item) => {
    if (!Array.isArray(item.embedding) || !item.embedding.length) throw new Error('向量服务返回空向量');
    return Float32Array.from(item.embedding);
  });
}
