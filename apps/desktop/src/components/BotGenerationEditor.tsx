import type { Bot, BotGenerationSettings, ProviderConfig } from '@moyu/core';
import { Field } from './Glass';
import { Select } from './Select';

export function BotGenerationEditor({ bot, provider, onChange }: { bot: Bot; provider?: ProviderConfig; onChange: (next: BotGenerationSettings) => void }) {
  const value = bot.generation ?? {};
  const control = provider?.modelSettings?.[bot.model]?.reasoningControl ?? 'default';
  const patch = (next: Partial<BotGenerationSettings>) => onChange({ ...value, ...next });
  return <section className="editor-block editor-block--wide">
    <h3>生成与任务预算</h3>
    <Field label="Bot 单次输出上限" hint="留空沿用模型配置。可降低额度，不能超过模型最大输出；思考和工具参数计入额度。"><input className="input mono" aria-label="Bot 单次输出上限" type="number" min={256} step={256} value={value.maxOutputTokens ?? ''} placeholder="沿用模型配置" onChange={e => patch(Object.fromEntries([['maxOutputTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field>
    {control === 'openai-effort' ? <Field label="Bot 思考强度"><Select label="Bot 思考强度" value={value.reasoningEffort ?? ''} options={[{ value: '', label: '沿用模型配置' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} onChange={effort => patch({ reasoningEffort: effort ? effort as BotGenerationSettings['reasoningEffort'] : undefined })} /></Field> : null}
    {['anthropic-budget', 'gemini-budget'].includes(control) ? <Field label="Bot 思考预算" hint="留空沿用模型配置。必须小于输出额度。"><input className="input mono" aria-label="Bot 思考预算" type="number" min={1024} step={1024} value={value.thinkingBudgetTokens ?? ''} onChange={e => patch(Object.fromEntries([['thinkingBudgetTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field> : null}
    <div className="editor-grid">
      <Field label="每次任务最多生成轮数" hint="每轮可包含多个工具调用。"><input className="input mono" aria-label="任务生成轮数" type="number" min={1} max={200} value={value.maxSteps ?? ''} placeholder="默认 32" onChange={e => patch({ maxSteps: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      <Field label="任务累计生成额度" hint="包含所有请求、失败重试与历史压缩的输出。不含输入；缺少用量时按本次预留额度计入。"><input className="input mono" aria-label="任务累计生成额度" type="number" min={1024} step={1024} value={value.maxTaskOutputTokens ?? ''} placeholder="默认 131072 tokens" onChange={e => patch(Object.fromEntries([['maxTaskOutputTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field>
      <Field label="任务最长时间（秒）" hint="超限会停止并保留已执行结果。"><input className="input mono" aria-label="任务最长时间" type="number" min={30} max={86400} value={value.maxDurationSeconds ?? ''} placeholder="默认 1200（20 分钟）" onChange={e => patch({ maxDurationSeconds: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
    </div>
  </section>;
}
