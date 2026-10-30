import type { ModelSettings, ProviderConfig } from '@moyu/core';
import { Field } from './Glass';
import { Select } from './Select';
import { LimitChips, formatTokens } from './LimitChips';
import { modelProfile } from '@moyu/core/dist/generation';

function LimitField({ label, hint, value, placeholder, chips, min, step, onValue, onPick }: {
  label: string; hint: string; value?: number; placeholder: string; chips: number[]; min: number; step: number;
  onValue: (next?: number) => void; onPick: (next?: number) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <input className="input mono" type="number" min={min} step={step} value={value ?? ''} placeholder={placeholder} aria-label={label}
        onChange={(event) => onValue(event.target.value === '' ? undefined : Number(event.target.value))} />
      <LimitChips value={value} chips={chips} onPick={onPick} />
      <span className="field__hint">{hint}</span>
    </div>
  );
}

export function ModelLimitsEditor({ provider, model, onChange }: { provider: ProviderConfig; model: string; onChange: (settings: ModelSettings) => void }) {
  const value = provider.modelSettings?.[model] ?? {};
  const profile = modelProfile(provider, model);
  const patch = (next: Partial<ModelSettings>) => onChange({ ...value, ...next });
  const controls = provider.kind === 'openai' ? [{ value: 'openai-effort', label: 'OpenAI reasoning_effort' }]
    : provider.kind === 'anthropic' ? [{ value: 'anthropic-budget', label: 'Anthropic 思考预算' }] : [{ value: 'gemini-budget', label: 'Gemini 思考预算' }];
  const windowDefault = provider.contextWindowTokens ?? provider.modelCatalog?.[model]?.contextWindowTokens ?? profile?.contextWindowTokens ?? 32768;
  const thresholdDefault = Math.floor(windowDefault * 0.9);
  return <div className="model-limits">
    <p className="inline-hint">当前模型：{model}。同一供应商的其他模型独立保存；请填写实际模型支持的额度。</p>

    <section className="limit-group">
      <h4 className="limit-group__title">高级</h4>
      <div className="provider-form__grid">
        <LimitField label="上下文窗口" value={value.contextWindowTokens} placeholder="如 128K，留空自动识别"
          hint={`模型可接受的上下文长度，会告知 Agent。留空按内置识别（当前 ${windowDefault}）。`}
          chips={[128, 200, 256, 400, 512, 1000]} min={4096} step={1024}
          onValue={(next) => patch({ contextWindowTokens: next })} onPick={(next) => patch({ contextWindowTokens: next })} />
        <LimitField label="最大输出" value={value.maxOutputTokens} placeholder="如 32K，留空按厂商默认"
          hint={`单次回复的最大 token（含思考、正文、工具参数）。自动起始 ${profile?.defaultOutputTokens ?? 8192}，留空按厂商默认。`}
          chips={[8, 16, 32, 64, 128]} min={256} step={256}
          onValue={(next) => patch({ maxOutputTokens: next })} onPick={(next) => patch({ maxOutputTokens: next })} />
        <LimitField label="压缩阈值" value={value.compactionThresholdTokens} placeholder="如 500K，留空按窗口 90%"
          hint={`长对话在此长度开始压缩。当前生效 ${value.compactionThresholdTokens ? `${formatTokens(value.compactionThresholdTokens)}（模型设置）` : `${formatTokens(thresholdDefault)}（窗口 90%）`}；大于等于窗口时使用完整窗口。`}
          chips={[128, 200, 272, 500, 1000]} min={4096} step={1024}
          onValue={(next) => patch({ compactionThresholdTokens: next })} onPick={(next) => patch({ compactionThresholdTokens: next })} />
      </div>
    </section>

    <Field label="思考接口" hint="默认不发送额外参数。仅在模型和中转服务明确支持时选择对应接口。"><Select label="模型思考接口" value={value.reasoningControl ?? 'default'} options={[{ value: 'default', label: '沿用模型默认' }, ...controls]} onChange={reasoningControl => patch({ reasoningControl: reasoningControl as ModelSettings['reasoningControl'] })} /></Field>
    {provider.kind === 'openai' ? <Field label="工具循环中的思考回传" hint="DeepSeek 思考模式需要回传 reasoning_content；按模型自动识别，也可适配中转接口。"><Select label="思考回传" value={value.reasoningReplay === undefined ? 'auto' : value.reasoningReplay ? 'enabled' : 'disabled'} options={[{ value: 'auto', label: `自动（${profile?.reasoningReplay ? '已启用' : '未启用'}）` }, { value: 'enabled', label: '启用 DeepSeek 思考回传' }, { value: 'disabled', label: '不回传' }]} onChange={next => patch({ reasoningReplay: next === 'auto' ? undefined : next === 'enabled' })} /></Field> : null}
    {provider.kind === 'openai' ? <Field label="输出额度参数" hint="推理模型可能要求 max_completion_tokens；按接口文档选择。"><Select label="输出额度参数" value={value.outputTokenParameter ?? 'max_tokens'} options={[{ value: 'max_tokens', label: 'max_tokens（兼容接口默认）' }, { value: 'max_completion_tokens', label: 'max_completion_tokens' }]} onChange={parameter => patch({ outputTokenParameter: parameter as ModelSettings['outputTokenParameter'] })} /></Field> : null}
    {value.reasoningControl === 'openai-effort' ? <Field label="默认思考强度"><Select label="默认思考强度" value={value.reasoningEffort ?? ''} options={[{ value: '', label: '沿用模型默认' }, { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} onChange={effort => patch({ reasoningEffort: effort ? effort as ModelSettings['reasoningEffort'] : undefined })} /></Field> : null}
    {['anthropic-budget', 'gemini-budget'].includes(value.reasoningControl ?? '') ? <Field label="默认思考预算" hint="小于输出额度；具体范围以模型文档为准，Bot 可覆盖。"><input className="input mono" aria-label="默认思考预算" type="number" min={1024} step={1024} value={value.thinkingBudgetTokens ?? ''} onChange={e => patch(Object.fromEntries([['thinkingBudgetTokens', e.target.value === '' ? undefined : Number(e.target.value)]]))} /></Field> : null}
  </div>;
}
