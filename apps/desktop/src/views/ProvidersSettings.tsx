import { useEffect, useState } from 'react';
import type { ProviderConfig } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { PRESETS } from '../lib/presets';
import { Button, Field } from '../components/Glass';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';

const PROTOCOLS = [{ value: 'openai', label: 'OpenAI 兼容', hint: '大部分中转站与本地服务' }, { value: 'anthropic', label: 'Anthropic', hint: 'Claude 原生协议' }, { value: 'gemini', label: 'Google Gemini', hint: 'Gemini 原生协议' }];
const protocol = (kind: string) => PROTOCOLS.find((item) => item.value === kind)?.label;

function validate(provider: ProviderConfig, requireModel = true) {
  if (!provider.name.trim()) throw new Error('请填写供应商名称');
  if (provider.networkMode && !['system', 'direct'].includes(provider.networkMode)) throw new Error('请选择有效的网络连接方式');
  let url: URL;
  try { url = new URL(provider.baseUrl); } catch { throw new Error('请填写完整的 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址须为 HTTP(S) 地址，不要包含密钥、查询参数或片段');
  if (requireModel && !provider.defaultModel.trim()) throw new Error('请填写默认模型，可直接输入模型 ID');
  return { ...provider, name: provider.name.trim(), baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''), defaultModel: provider.defaultModel.trim(), models: [...new Set([...provider.models, provider.defaultModel.trim()].filter(Boolean))] };
}

export function ProvidersSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { settings, saveSettings, secrets, saveProviderKey, toast } = useMoyu();
  const [drafts, setDrafts] = useState(settings.providers);
  const [selected, setSelected] = useState(settings.providers[0]?.id ?? '');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [remove, setRemove] = useState(false);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(settings.providers) || Object.values(keys).some(Boolean);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const current = drafts.find((item) => item.id === selected);
  const patch = (next: Partial<ProviderConfig>) => { setDrafts((prev) => prev.map((item) => item.id === selected ? { ...item, ...next } : item)); setResult(null); };
  const choose = (id: string) => { setSelected(id); setAdding(false); setModelSearch(''); setResult(null); setRemove(false); };
  const add = (presetId: string) => {
    const preset = PRESETS.find((item) => item.id === presetId)!;
    const unique = preset.id !== 'custom' && !drafts.some((item) => item.id === preset.id);
    const item: ProviderConfig = { id: unique ? preset.id : crypto.randomUUID(), name: preset.id === 'custom' ? '自定义中转站' : preset.label, kind: preset.kind, baseUrl: preset.baseUrl, defaultModel: preset.model, models: preset.model ? [preset.model] : [], createdAt: Date.now() };
    setDrafts((prev) => [...prev, item]); choose(item.id);
  };
  const save = async () => {
    setBusy('save');
    try {
      const next = drafts.map((item) => validate(item));
      await saveSettings({ providers: next });
      for (const [id, key] of Object.entries(keys)) {
        if (key.trim()) { await saveProviderKey(id, key.trim()); setKeys((prev) => ({ ...prev, [id]: '' })); }
      }
      setDrafts(next); toast('供应商配置已保存');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(null); }
  };
  const request = async (action: 'test' | 'models') => {
    if (!current) return;
    setBusy(action); setResult(null);
    try {
      const config = validate(current, action === 'test');
      if (action === 'test') {
        const response = await moyu().testProvider(current.id, config, keys[current.id]);
        setResult({ ok: response.ok, message: response.ok ? `连接正常 · ${response.latencyMs} ms` : response.message });
      } else {
        const models = [...new Set(await moyu().listModels(current.id, config, keys[current.id]))];
        if (models.length) setDrafts((prev) => prev.map((item) => item.id === current.id ? { ...item, defaultModel: item.defaultModel || models[0]!, models: [...new Set([...models, item.defaultModel].filter(Boolean))] } : item));
        setResult({ ok: true, message: models.length ? `发现 ${models.length} 个模型，保存后生效` : '未返回模型列表，请手动添加模型 ID' });
      }
    } catch (error) { setResult({ ok: false, message: (error as Error).message }); }
    finally { setBusy(null); }
  };
  const models = current ? [...new Set([...current.models, current.defaultModel].filter(Boolean))] : [];
  const botCount = settings.bots.filter((bot) => bot.providerId === selected).length;
  return <div className="provider-workspace">
    <aside className="provider-browser">
      <div className="provider-browser__head"><span>我的供应商 <small>{drafts.length}</small></span><button type="button" className="icon-btn" aria-label="添加供应商" disabled={!!busy} onClick={() => setAdding(true)}><Icon name="plus" size={16} /></button></div>
      <label className="provider-search"><Icon name="search" size={14} /><input aria-label="搜索供应商" placeholder="搜索供应商" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <div className="provider-browser__list">{drafts.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item) => <button type="button" disabled={!!busy} key={item.id} className={`provider-item ${selected === item.id && !adding ? 'is-active' : ''}`} onClick={() => choose(item.id)}><span className="provider-monogram">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{protocol(item.kind)}</small></span><i className={secrets.providerKeys[item.id] ? 'is-configured' : ''} title={secrets.providerKeys[item.id] ? '密钥已保存' : '未保存密钥'} /></button>)}{!drafts.length ? <p className="provider-empty">添加第一个供应商，<br />开始连接你的模型。</p> : null}</div>
      <button type="button" className="provider-add" disabled={!!busy} onClick={() => setAdding(true)}><Icon name="plus" size={14} />添加供应商</button>
      <p className="provider-browser__hint">官方 API · 第三方中转 · 本地模型</p>
    </aside>
    <div className="provider-detail">
      {adding || !current ? <div className="provider-catalog" key="catalog"><div className="provider-detail__head"><div><h3>连接一个新供应商</h3><p>选择服务，或使用自己的兼容接口。</p></div>{current ? <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>返回</Button> : null}</div><h4>官方与聚合服务</h4><div className="provider-presets">{PRESETS.filter((item) => !['custom', 'ollama'].includes(item.id)).map((item) => <button type="button" key={item.id} onClick={() => add(item.id)}><span className="provider-monogram">{item.label.slice(0, 1)}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span><Icon name="plus" size={14} /></button>)}</div><h4>更多接入方式</h4><button type="button" className="provider-custom" onClick={() => add('custom')}><Icon name="plug" size={20} /><span><strong>第三方中转 / 自定义 API</strong><small>自定义地址，支持 OpenAI、Anthropic 和 Gemini 协议</small></span><Icon name="plus" size={16} /></button><button type="button" className="provider-custom" onClick={() => add('ollama')}><Icon name="terminal" size={20} /><span><strong>本地 Ollama</strong><small>连接本机或局域网中的模型服务</small></span><Icon name="plus" size={16} /></button></div>
      : <div className="provider-form" key={current.id}>
        <div className="provider-detail__head"><div className="provider-identity"><span className="provider-monogram provider-monogram--large">{current.name.slice(0, 1)}</span><div><h3>{current.name || '新供应商'}</h3><p>{protocol(current.kind)} · {botCount} 个 Bot 使用</p></div></div><span className={`badge badge--${secrets.providerKeys[current.id] ? 'ok' : 'muted'}`}>{secrets.providerKeys[current.id] ? '已配置密钥' : '待配置'}</span></div>
        <fieldset disabled={!!busy} className="provider-fields">
          <Field label="网络连接" hint={current.networkMode === 'system' ? '使用系统代理和绕过规则；没有代理时直接连接。' : '仅此供应商直接连接，不使用系统代理。'}><Select label="供应商网络连接" value={current.networkMode ?? 'direct'} options={[{ value: 'direct', label: '直连（默认）', hint: '此供应商不使用系统代理' }, { value: 'system', label: '跟随系统', hint: '遵循系统代理和直连规则' }]} onChange={(value) => patch({ networkMode: value as ProviderConfig['networkMode'] })} /></Field>
          <div className="provider-form__grid"><Field label="供应商名称"><input className="input" aria-label="供应商名称" value={current.name} onChange={(e) => patch({ name: e.target.value })} /></Field><Field label="API 协议"><Select label="API 协议" value={current.kind} options={PROTOCOLS} onChange={(value) => patch({ kind: value as ProviderConfig['kind'] })} /></Field></div>
          <div className="provider-form__grid"><Field label="API 地址" hint="包含 /v1 等版本路径。"><input className="input mono" aria-label="API 地址" placeholder="https://your-api.example.com/v1" title={current.baseUrl} value={current.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} spellCheck={false} /></Field>
          <Field label="API Key" hint={secrets.providerKeys[current.id] ? '已安全保存，留空保留。' : '无需密钥的服务可留空。'}><input className="input mono" aria-label="供应商 API Key" type="password" autoComplete="new-password" value={keys[current.id] ?? ''} placeholder={secrets.providerKeys[current.id] ? '••••••••••••••••' : '输入 API Key'} onChange={(e) => { setKeys((prev) => ({ ...prev, [current.id]: e.target.value })); setResult(null); }} /></Field></div>
          <div className="provider-form__grid"><Field label="默认模型"><Select allowCustom label="默认模型" value={current.defaultModel} placeholder="选择或输入模型 ID" options={models.map((model) => ({ value: model, label: model }))} onChange={(value) => patch({ defaultModel: value })} /></Field><Field label="上下文上限 (tokens)"><input className="input mono" aria-label="上下文上限" type="number" min={4096} step={1024} value={current.contextWindowTokens ?? 32768} onChange={(e) => patch({ contextWindowTokens: Math.max(4096, Number(e.target.value) || 32768) })} /></Field></div>
          <details className="provider-advanced"><summary>高级设置<Icon name="chevron" size={13} /></summary><Field label="图像模型" hint="供绘图工具使用，留空使用供应商默认。"><input className="input mono" aria-label="图像模型" value={current.imageModel ?? ''} placeholder="可选，例如 gpt-image-1" onChange={(e) => patch({ imageModel: e.target.value })} /></Field><p>接近上下文上限时，会自动压缩对话并整理记忆。</p></details>
        </fieldset>
        <div className="provider-models"><div className="provider-models__head"><h4>可用模型 <small>{models.length}</small></h4><Button variant="ghost" size="sm" icon="refresh" disabled={!!busy} loading={busy === 'models'} onClick={() => void request('models')}>获取模型</Button></div><label className="provider-search"><Icon name="search" size={14} /><input aria-label="搜索模型" placeholder="筛选模型" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} /></label><div className="provider-models__list">{models.filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase())).map((model) => <button type="button" disabled={!!busy} key={model} className={current.defaultModel === model ? 'is-active' : ''} onClick={() => patch({ defaultModel: model })}><Icon name="spark" size={13} /><span>{model}</span>{current.defaultModel === model ? <small>默认</small> : <small>设为默认</small>}</button>)}{!models.length ? <p>从接口获取，或手动添加模型 ID。</p> : null}</div><form className="provider-models__manual" onSubmit={(e) => { e.preventDefault(); if (manualModel.trim()) { patch({ models: [...new Set([...models, manualModel.trim()])] }); setManualModel(''); } }}><input className="input mono" aria-label="手动模型 ID" placeholder="输入模型 ID 手动添加" disabled={!!busy} value={manualModel} onChange={(e) => setManualModel(e.target.value)} /><Button type="submit" variant="ghost" size="sm" disabled={!!busy || !manualModel.trim()} icon="plus">添加</Button></form></div>
        {result ? <p role="status" className={`provider-result ${result.ok ? 'is-ok' : 'is-error'}`}><Icon name={result.ok ? 'check' : 'alert'} size={14} />{result.message}</p> : null}
        <div className="provider-danger">{remove ? <><span>从配置中移除这个供应商？</span><Button size="sm" variant="ghost" onClick={() => setRemove(false)}>取消</Button><Button size="sm" variant="danger" onClick={() => { const next = drafts.filter((item) => item.id !== selected); setDrafts(next); setKeys((prev) => { const copy = { ...prev }; delete copy[selected]; return copy; }); choose(next[0]?.id ?? ''); }}>确认移除</Button></> : <button type="button" disabled={botCount > 0 || !!busy} title={botCount ? '请先为使用它的 Bot 更换供应商' : '保存后生效'} onClick={() => setRemove(true)}><Icon name="trash" size={13} />{botCount ? '使用中的供应商不可移除' : '移除供应商'}</button>}</div>
      </div>}
    </div>
    <footer className="provider-savebar"><span>{dirty ? '有未保存的更改' : '所有更改已保存'}<small>测试使用当前配置，不会自动保存</small></span><div>{current && !adding ? <Button variant="glass" size="sm" disabled={!!busy} loading={busy === 'test'} onClick={() => void request('test')}>测试连接</Button> : null}<Button variant="primary" size="sm" disabled={!!busy || !dirty} loading={busy === 'save'} icon="check" onClick={() => void save()}>保存更改</Button></div></footer>
  </div>;
}
