import type { ProviderConfig } from '@moyu/core';

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
  { pattern: /^glm-5\.2/, contextWindowTokens: 262144 },
  { pattern: /^glm-5(\.1)?$/, contextWindowTokens: 202752 },
  { pattern: /^kimi-k3/, contextWindowTokens: 1000000 },
  { pattern: /^kimi-k2/, contextWindowTokens: 262144 },
  { pattern: /^gemini-(2\.5|3)/, contextWindowTokens: 1048576 },
  { pattern: /^minimax-m3/, contextWindowTokens: 524288 },
  { pattern: /^minimax-m2/, contextWindowTokens: 204800 },
];

export function contextWindowFor(_provider: ProviderConfig | undefined, model: string): number | undefined {
  const id = model.split('/').pop()!.trim().toLowerCase();
  return WINDOWS.find((entry) => entry.pattern.test(id))?.contextWindowTokens;
}
