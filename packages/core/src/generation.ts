import type { Bot, BotGenerationSettings, ModelSettings, ProviderConfig } from './types';

export const DEFAULT_TASK_LIMITS = { maxSteps: 32, maxTaskOutputTokens: 131072, maxDurationSeconds: 1200 };

/** Verified DeepSeek API defaults, 2026-10-29. Exact model IDs also work on compatible relays. */
export function modelProfile(provider: ProviderConfig | undefined, model: string) {
  if (provider?.kind === 'openai' && ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)) {
    return { contextWindowTokens: 1000000, maxOutputTokens: 393216, defaultOutputTokens: 65536, reasoningReplay: true };
  }
  return undefined;
}

export function modelSettings(provider: ProviderConfig | undefined, model: string): ModelSettings {
  const profile = modelProfile(provider, model);
  return { reasoningReplay: profile?.reasoningReplay,
    contextWindowTokens: provider?.contextWindowTokens ?? profile?.contextWindowTokens,
    maxOutputTokens: provider?.maxOutputTokens,
    ...Object.fromEntries(Object.entries(provider?.modelSettings?.[model] ?? {}).filter(([, value]) => value !== undefined)) };
}

function integer(value: unknown, min: number, max: number, label: string) {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) throw new Error(`${label}需要是 ${min}–${max} 的整数`);
}
export function validateModelSettings(settings: ModelSettings, kind: ProviderConfig['kind']) {
  if (settings.reasoningReplay !== undefined && typeof settings.reasoningReplay !== 'boolean') throw new Error('思考回传配置无效');
  integer(settings.contextWindowTokens, 4096, 10000000, '上下文上限');
  integer(settings.maxOutputTokens, 256, 1000000, '单次输出上限');
  if (settings.contextWindowTokens && settings.maxOutputTokens && settings.maxOutputTokens >= settings.contextWindowTokens) throw new Error('输出上限必须小于上下文上限，需为输入预留空间');
  const allowed = { openai: ['default', 'openai-effort'], anthropic: ['default', 'anthropic-budget'], gemini: ['default', 'gemini-budget'] };
  if (settings.reasoningControl && !allowed[kind].includes(settings.reasoningControl)) throw new Error('思考接口与供应商协议不匹配');
  if (settings.reasoningEffort && !['low', 'medium', 'high'].includes(settings.reasoningEffort)) throw new Error('思考强度无效');
  if (settings.outputTokenParameter && !['max_tokens', 'max_completion_tokens'].includes(settings.outputTokenParameter)) throw new Error('输出参数无效');
  integer(settings.thinkingBudgetTokens, 1024, 999999, '思考预算');
  if (settings.thinkingBudgetTokens && settings.maxOutputTokens && settings.thinkingBudgetTokens >= settings.maxOutputTokens) throw new Error('思考预算必须小于输出上限');
}
export function validateGeneration(settings: BotGenerationSettings | undefined) {
  if (!settings) return;
  integer(settings.maxOutputTokens, 256, 1000000, 'Bot 输出上限');
  integer(settings.thinkingBudgetTokens, 1024, 999999, 'Bot 思考预算');
  integer(settings.maxSteps, 1, 200, '任务轮数');
  integer(settings.maxTaskOutputTokens, 1024, 10000000, '任务累计生成上限');
  integer(settings.maxDurationSeconds, 30, 86400, '任务最长时间（秒）');
  if (settings.reasoningEffort && !['low', 'medium', 'high'].includes(settings.reasoningEffort)) throw new Error('Bot 思考强度无效');
  if (settings.thinkingBudgetTokens && settings.maxOutputTokens && settings.thinkingBudgetTokens >= settings.maxOutputTokens) throw new Error('Bot 思考预算必须小于输出上限');
}

/** Shared by normal calls and compaction; failed requests consume budget too. */
export class TaskOutputBudget {
  used = 0;
  constructor(readonly limit: number) {}
  remaining() { return Math.max(0, this.limit - this.used); }
  consume(tokens: number) { if (Number.isFinite(tokens) && tokens > 0) this.used += Math.ceil(tokens); }
  requireAvailable() { if (this.remaining() < 256) throw new Error(`已达到任务累计生成额度（${this.limit} tokens），任务尚未确认完成；已执行结果已保留。`); }
}
