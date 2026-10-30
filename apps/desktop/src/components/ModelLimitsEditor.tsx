import type { ModelSettings, ProviderConfig } from '@moyu/core';
import { Field } from './Glass';
import { Select } from './Select';
import { modelProfile } from '@moyu/core/dist/generation';

export function ModelLimitsEditor({ provider, model, onChange }: { provider: ProviderConfig; model: string; onChange: (settings: ModelSettings) => void }) {
  const value = provider.modelSettings?.[model] ?? {};
  const profile = modelProfile(provider, model);
  const patch = (next: Partial<ModelSettings>) => onChange({ ...value, ...next });
  const controls = provider.kind === 'openai' ? [{ value: 'openai-effort', label: 'OpenAI reasoning_effort' }]
    : provider.kind === 'anthropic' ? [{ value: 'anthropic-budget', label: 'Anthropic 思考预算' }] : [{ value: 'gemini-budget', label: 'Gemini 思考预算' }];
  return <div className="model-limits">
    <p className="inline-hint">当前模型：{model}。同一供应商的其他模型独立保存；请填写实际模型支持的额度。</p>
    <div className="provider-form__grid">
      <Field label="模型上下文上限" hint={`留空默认 ${provider.contextWindowTokens ?? profile?.contextWindowTokens ?? 32768}。`}><input className="input mono" aria-label="模型上下文上限" type="number" min={4096} step={1024} value={value.contextWindowTokens ?? ''} placeholder="自动识别或供应商默认" onChange={e => patch(Object.fromEntries([['contextWindowTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field>
      <Field label="模型最大输出" hint={`包含思考、正文和工具参数。自动起始 ${profile?.defaultOutputTokens ?? 8192}，必要时提高一次并沿用到任务结束；手动值是严格上限，截断时在任务预算内恢复。`}><input className="input mono" aria-label="模型最大输出" type="number" min={256} step={256} value={value.maxOutputTokens ?? ''} placeholder={provider.maxOutputTokens ? String(provider.maxOutputTokens) : '自动'} onChange={e => patch(Object.fromEntries([['maxOutputTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field>
    </div>
    <Field label="思考接口" hint="默认不发送额外参数。仅在模型和中转服务明确支持时选择对应接口。"><Select label="模型思考接口" value={value.reasoningControl ?? 'default'} options={[{ value: 'default', label: '沿用模型默认' }, ...controls]} onChange={reasoningControl => patch({ reasoningControl: reasoningControl as ModelSettings['reasoningControl'] })} /></Field>
    {provider.kind === 'openai' ? <Field label="工具循环中的思考回传" hint="DeepSeek 思考模式需要回传 reasoning_content；按模型自动识别，也可适配中转接口。"><Select label="思考回传" value={value.reasoningReplay === undefined ? 'auto' : value.reasoningReplay ? 'enabled' : 'disabled'} options={[{ value: 'auto', label: `自动（${profile?.reasoningReplay ? '已启用' : '未启用'}）` }, { value: 'enabled', label: '启用 DeepSeek 思考回传' }, { value: 'disabled', label: '不回传' }]} onChange={next => patch({ reasoningReplay: next === 'auto' ? undefined : next === 'enabled' })} /></Field> : null}
    {provider.kind === 'openai' ? <Field label="输出额度参数" hint="推理模型可能要求 max_completion_tokens；按接口文档选择。"><Select label="输出额度参数" value={value.outputTokenParameter ?? 'max_tokens'} options={[{ value: 'max_tokens', label: 'max_tokens（兼容接口默认）' }, { value: 'max_completion_tokens', label: 'max_completion_tokens' }]} onChange={parameter => patch({ outputTokenParameter: parameter as ModelSettings['outputTokenParameter'] })} /></Field> : null}
    {value.reasoningControl === 'openai-effort' ? <Field label="默认思考强度"><Select label="默认思考强度" value={value.reasoningEffort ?? ''} options={[{ value: '', label: '沿用模型默认' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} onChange={effort => patch({ reasoningEffort: effort ? effort as ModelSettings['reasoningEffort'] : undefined })} /></Field> : null}
    {['anthropic-budget', 'gemini-budget'].includes(value.reasoningControl ?? '') ? <Field label="默认思考预算" hint="小于输出额度；具体范围以模型文档为准，Bot 可覆盖。"><input className="input mono" aria-label="默认思考预算" type="number" min={1024} step={1024} value={value.thinkingBudgetTokens ?? ''} onChange={e => patch(Object.fromEntries([['thinkingBudgetTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field> : null}
  </div>;
}
