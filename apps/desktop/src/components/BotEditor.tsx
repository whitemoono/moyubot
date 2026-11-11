import { useEffect, useId, useMemo, useState } from 'react';
import type { ApprovalPolicy, Bot, ProviderConfig } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { Button, Field, Segmented, Sheet } from './Glass';
import { BotAvatar } from './BotAvatar';
import { Icon } from './Icon';
import { editorToolCatalog, groupToolsForEditor, isToolEnabled, toggleTool } from '../lib/bots';
import { AvatarPicker } from './AvatarPicker';
import { Select } from './Select';
import { BotGenerationEditor } from './BotGenerationEditor';
import { BotCapabilities } from './BotCapabilities';
import '../styles/bot-editor.css';

const SECTIONS = [
  { id: 'identity', label: '基本资料', icon: 'bots' },
  { id: 'model', label: '模型与供应商', icon: 'plug' },
  { id: 'behavior', label: '人格与权限', icon: 'shield' },
  { id: 'tools', label: '可用工具', icon: 'grid' },
  { id: 'budget', label: '生成与预算', icon: 'sliders' },
  { id: 'extensions', label: '扩展能力', icon: 'spark' },
] as const;

export function BotEditor({
  initial,
  existing,
  providers,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Bot;
  existing: boolean;
  providers: ProviderConfig[];
  onClose: () => void;
  onSave: (bot: Bot) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { secrets, saveProviderKey, toast } = useMoyu();
  const sectionPrefix = useId();
  const sectionId = (name: typeof SECTIONS[number]['id']) => `${sectionPrefix}-${name}`;
  const [draft, setDraft] = useState<Bot>(initial);
  const [builtinTools, setBuiltinTools] = useState<{ name: string; description?: string }[]>([]);
  const [toolSectionCollapsed, setToolSectionCollapsed] = useState<Record<string, boolean>>({});
  const toolGroups = useMemo(() => groupToolsForEditor(editorToolCatalog(builtinTools)), [builtinTools]);
  useEffect(() => { let active = true; void moyu().listTools().then((tools) => { if (active) setBuiltinTools(tools); }).catch(() => {}); return () => { active = false; }; }, []);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const provider = providers.find((item) => item.id === draft.providerId);
  const hasKey = draft.providerId ? secrets.providerKeys[draft.providerId] : false;

  const patch = <K extends keyof Bot>(key: K, value: Bot[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const pullModels = async () => {
    if (!draft.providerId) return;
    setLoadingModels(true);
    try {
      const list = await moyu().listModels(draft.providerId);
      setModels(list);
      if (list.length) toast(`拉到 ${list.length} 个模型`);
      else toast('供应商没有返回模型列表，可手动填写', 'warn');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoadingModels(false);
    }
  };

  const test = async () => {
    if (!draft.providerId) return;
    if (key) await saveProviderKey(draft.providerId, key);
    setTesting(true);
    try {
      const result = await moyu().testProvider(draft.providerId);
      toast(result.ok ? `连接正常 · ${result.latencyMs}ms` : `失败：${result.message}`, result.ok ? 'info' : 'error');
    } finally {
      setTesting(false);
    }
  };

  const title = useMemo(() => (existing ? `编辑 ${initial.name}` : '新建 Bot'), [existing, initial.name]);

  return (
    <Sheet
      open
      wide
      className="sheet--bot-editor"
      headingIcon="bots"
      title={title}
      subtitle="配置这个 Bot 的外观、模型和工作方式。"
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <Button variant="danger" size="sm" icon="trash" onClick={() => void onDelete()}>
              删除 Bot
            </Button>
          ) : null}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon="check" onClick={() => void onSave({ ...draft, updatedAt: Date.now() })}>
            保存
          </Button>
        </>
      }
    >
      <div className="bot-editor">
        <nav className="bot-editor__nav" aria-label="Bot 设置目录">
          <span className="bot-editor__nav-label" aria-hidden="true">设置目录</span>
          {SECTIONS.map(({ id, label, icon }) => <button key={id} type="button" aria-controls={sectionId(id)} onClick={() => {
            const target = document.getElementById(sectionId(id));
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'start' });
          }}><Icon name={icon} size={16} /><span>{label}</span></button>)}
        </nav>
        <div className="editor-grid bot-editor__sections">
        <section id={sectionId('identity')} tabIndex={-1} className="editor-block">
          <header className="bot-editor__section-head"><h3>基本资料</h3><p>设置会话列表中显示的名称和头像。</p></header>
          <div className="identity-row">
            <div className="bot-editor__portrait"><BotAvatar bot={draft} size="xl" /></div>
            <div className="identity-fields">
              <Field label="名字">
                <input
                  className="input"
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value, avatar: { ...prev.avatar, glyph: (event.target.value[0] ?? 'B').toUpperCase() } }))}
                />
              </Field>
              <Field label="Handle">
                <input className="input" value={draft.handle} onChange={(event) => patch('handle', event.target.value)} />
              </Field>
            </div>
          </div>
          <AvatarPicker value={draft.avatar} onChange={(avatar) => patch('avatar', avatar)} />
        </section>

        <section id={sectionId('model')} tabIndex={-1} className="editor-block">
          <header className="bot-editor__section-head"><h3>模型与供应商</h3><p>选择回复使用的模型，并检查供应商连接。</p></header>
          <Field label="供应商">
            <Select label="Bot 供应商" value={draft.providerId} options={providers.map((item) => ({ value: item.id, label: item.name, hint: item.kind === 'gemini' ? 'Gemini 协议' : item.kind === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容' }))}
              onChange={(value) => {
                const next = providers.find((item) => item.id === value);
                setDraft((prev) => ({ ...prev, providerId: value, model: next?.defaultModel ?? prev.model }));
                setModels([]);
              }}
            />
          </Field>
          {provider ? (
            <p className="bot-editor__endpoint">
              <span className="mono">{provider.baseUrl}</span>
              <span className="bot-editor__key-status" data-configured={!!hasKey}>{hasKey ? '已保存密钥' : '未设置密钥'}</span>
            </p>
          ) : null}
          <Field label="API Key">
            <div className="key-row">
              <input
                className="input mono"
                type="password"
                placeholder={hasKey ? '已保存（输入可替换）' : 'sk-…'}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button size="sm" variant="glass" disabled={!draft.providerId || !key} onClick={() => void saveProviderKey(draft.providerId, key).then(() => toast('密钥已加密保存'))}>
                保存密钥
              </Button>
              <Button size="sm" variant="ghost" disabled={!draft.providerId} loading={testing} onClick={() => void test()}>
                测试连接
              </Button>
            </div>
          </Field>
          <Field label="模型" hint="可手动填写，也可以从供应商拉取列表">
            <div className="key-row">
              <Select allowCustom label="Bot 模型" value={draft.model} onChange={(value) => patch('model', value)} options={[...new Set([...models, ...(provider?.models ?? [])])].map((model) => ({ value: model, label: model }))} />
              <Button size="sm" variant="ghost" loading={loadingModels} onClick={() => void pullModels()}>
                拉取
              </Button>
            </div>
          </Field>
          <Field label={`温度 ${draft.temperature.toFixed(2)}`}>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={draft.temperature}
              onChange={(event) => patch('temperature', Number(event.target.value))}
              className="range"
            />
          </Field>
        </section>

        <section id={sectionId('behavior')} tabIndex={-1} className="editor-block">
          <header className="bot-editor__section-head"><h3>人格与权限</h3><p>定义 Bot 怎么回答，以及执行操作前是否需要确认。</p></header>
          <Field label="系统提示词" hint="支持 {bot_name} 占位符">
            <textarea className="textarea" rows={6} value={draft.systemPrompt} onChange={(event) => patch('systemPrompt', event.target.value)} />
          </Field>
          <Field label="工作目录" hint="留空 = 默认（本机工作区 / 该 Bot 名）。填绝对路径（如 D:\\dev\\moyubot）就让这个 Bot 在那个目录里干活；想让几个 Bot 共用一棵树，就各自填同一个路径。">
            <input
              className="input mono"
              data-testid="bot-working-dir"
              value={draft.dirName ?? ''}
              placeholder="默认：<工作区>/<Bot 名>"
              onChange={(event) => patch('dirName', event.target.value.trim() ? event.target.value : undefined)}
            />
          </Field>
          <Field label="执行权限">
            <Segmented<ApprovalPolicy>
              value={draft.approvalPolicy}
              onChange={(value) => patch('approvalPolicy', value)}
              options={[
                { value: 'never', label: '自动执行' },
                { value: 'ask', label: '每次确认' },
              ]}
            />
          </Field>
        </section>

        <section id={sectionId('tools')} tabIndex={-1} className="editor-block">
          <header className="bot-editor__section-head"><h3>可用工具</h3><p>按类别选择这个 Bot 可以调用的内置工具。</p></header>
          <div className="tool-groups">
            {toolGroups.map((group) => {
              const defaultEnabled = builtinTools.map((item) => item.name);
              const items = group.items;
              const on = items.filter((item) => isToolEnabled(draft.tools, item.id, defaultEnabled)).length;
              const open = !toolSectionCollapsed[group.id];
              return <div className="tool-group" key={group.id}>
                <button type="button" className="tool-group__head" aria-expanded={open} onClick={() => setToolSectionCollapsed((prev) => ({ ...prev, [group.id]: open }))}>
                  <Icon name="chevron" size={13} className={open ? 'is-open' : ''} />
                  <strong>{group.title}</strong>
                  <span className="tool-group__count">{on}/{items.length}</span>
                </button>
                {open ? <div className="tool-group__grid">{items.map((tool) => {
                  const enabled = isToolEnabled(draft.tools, tool.id, defaultEnabled);
                  return <button
                    key={tool.id}
                    type="button"
                    className={`tool-toggle ${enabled ? 'is-on' : ''}`}
                    aria-pressed={enabled}
                    onClick={() => patch('tools', toggleTool(draft.tools, tool.id, defaultEnabled))}
                  >
                    <span className="tool-toggle__check"><Icon name="check" size={12} /></span>
                    <span><strong>{tool.label}</strong><em>{tool.hint}</em></span>
                  </button>;
                })}</div> : null}
              </div>;
            })}
          </div>
        </section>
        <div id={sectionId('budget')} tabIndex={-1}>
          <BotGenerationEditor bot={draft} provider={provider} onChange={generation => patch('generation', generation)} />
        </div>
        <section id={sectionId('extensions')} tabIndex={-1} className="editor-block bot-editor__extensions">
          <header className="bot-editor__section-head"><h3>扩展能力</h3><p>查看这个工作区可用的 MCP 服务和技能。</p></header>
          <BotCapabilities bot={draft} onChange={next => setDraft(prev => ({ ...prev, ...next }))} />
        </section>
        </div>
      </div>
    </Sheet>
  );
}
