import type { ProviderConfig } from '@moyu/core';

/**
 * 未识别模型的兜底上下文窗口。与 packages/core/src/generation.ts 的
 * DEFAULT_CONTEXT_WINDOW_TOKENS 保持一致。2026 年主流模型普遍 ≥128K，
 * 用 32K 会误报占用率并导致过早压缩。
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 131072;

/**
 * Renderer-side mirror of packages/core/src/generation.ts modelProfile.
 * Kept small and node-free so the browser bundle never pulls the core runtime
 * (which imports node:fs and friends). Keep the two tables in sync.
 */
const WINDOWS: { pattern: RegExp; contextWindowTokens: number }[] = [
  { pattern: /^deepseek-v4(\.1)?(?!.*pro)\b/, contextWindowTokens: 1000000 },
  { pattern: /^deepseek-(flash|v4-flash)/, contextWindowTokens: 1000000 },
  { pattern: /^deepseek-v4-pro/, contextWindowTokens: 1000000 },
  { pattern: /^deepseek-chat/, contextWindowTokens: 131072 },
  { pattern: /^glm-5\.3/, contextWindowTokens: 1000000 },
  { pattern: /^glm-5\.2/, contextWindowTokens: 1000000 },
  { pattern: /^glm-5(\.1)?$/, contextWindowTokens: 202752 },
  { pattern: /^kimi-k3/, contextWindowTokens: 1000000 },
  { pattern: /^kimi-k2/, contextWindowTokens: 262144 },
  // 阿里云百炼：3.8/3.7/3.6/3.5 的 flash/plus/max 均为 1M；开源尺寸型号为 256K。
  { pattern: /^qwen3\.8/, contextWindowTokens: 1000000 },
  { pattern: /^qwen3\.[5-7]-(flash|plus|max)/, contextWindowTokens: 1000000 },
  { pattern: /^qwen3\.[5-7]-\d+b/, contextWindowTokens: 262144 },
  { pattern: /^qwen-(plus|turbo)/, contextWindowTokens: 1000000 },
  { pattern: /^qwen-max/, contextWindowTokens: 131072 },
  { pattern: /^qwen-long/, contextWindowTokens: 10000000 },
  { pattern: /^gemini-(2\.5|3)/, contextWindowTokens: 1048576 },
  { pattern: /^minimax-m3/, contextWindowTokens: 524288 },
  { pattern: /^minimax-m2/, contextWindowTokens: 204800 },
];

export function contextWindowFor(_provider: ProviderConfig | undefined, model: string): number | undefined {
  const id = model.split('/').pop()!.trim().toLowerCase();
  return WINDOWS.find((entry) => entry.pattern.test(id))?.contextWindowTokens;
}
