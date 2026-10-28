import { useMemo, useState } from 'react';
import type { ApprovalPolicy, Bot, ProviderConfig } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { Button, Field, IconButton, Panel, Segmented, Sheet, Toggle } from '../components/Glass';
import { BotAvatar } from '../components/BotAvatar';
import { Icon } from '../components/Icon';

import { BOT_TOOLS as TOOLS, newBot } from '../lib/bots';
import { AvatarPicker } from '../components/AvatarPicker';
import { Select } from '../components/Select';

export function BotsView({ onCreate, embedded = false }: { onCreate: () => void; embedded?: boolean }) {
  const { settings, saveBot, deleteBot, selectBot, bot: activeBot, updateBotMetadata, toast } = useMoyu();
  const [editing, setEditing] = useState<Bot | null>(null);

  const providerName = (id: string) => settings.providers.find((provider) => provider.id === id)?.name ?? '未绑定供应商';

  return (
    <div className={embedded ? 'settings-bots' : 'view'}>
      <header className="view-head">
        <div>
          {embedded ? <span className="settings-bots__count">{settings.bots.length} 个 Bot<span>独立人格 · 模型与权限</span></span> : <><h1>Bot 管理</h1><p>每个 Bot 有自己的供应商、模型、人格与权限；它们共用同一台按需唤醒的云电脑。</p></>}
        </div>
        <Button variant="primary" icon="plus" onClick={onCreate}>
          新建 Bot
        </Button>
      </header>

      <div className="bots-grid">
        {settings.bots.map((item) => (
          <Panel key={item.id} className={`bot-card ${activeBot?.id === item.id ? 'is-active' : ''}`}>
            <div className="bot-card__head">
              <BotAvatar bot={item} size="xl" />
              <div className="bot-card__title">
                <h3>{item.name}</h3>
                <p>@{item.handle}</p>
              </div>
              <IconButton name="settings" label="编辑" onClick={() => setEditing(item)} />
            </div>
            <dl className="bot-card__facts">
              <div>
                <dt>供应商</dt>
                <dd>{providerName(item.providerId)}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd className="mono">{item.model || '—'}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd>{item.approvalPolicy === 'ask' ? '执行前确认' : item.approvalPolicy === 'always' ? '全部允许' : '自动执行'}</dd>
              </div>
              <div>
                <dt>绘图</dt>
                <dd>{item.image.backend === 'cloud' ? '云主机出图' : '供应商 API'}</dd>
              </div>
            </dl>
            <div className="bot-card__foot">
              <Button size="sm" variant="glass" icon="chat" onClick={() => selectBot(item.id)}>
                开始对话
              </Button>
              {item.sidebar?.hidden ? <Button size="sm" variant="ghost" icon="sidebar" onClick={() => void updateBotMetadata(item.id, { sidebar: { hidden: false } }).catch((error: Error) => toast(error.message, 'error'))}>显示在侧栏</Button> : null}
              <IconButton name="copy" label="复制这个 Bot" onClick={() => setEditing(newBot(settings.providers.find((p) => p.id === item.providerId), item))} />
            </div>
          </Panel>
        ))}

        <button type="button" className="bot-card bot-card--new" onClick={onCreate}>
          <span className="new-icon">
            <Icon name="plus" size={22} />
          </span>
          <strong>再加一个 Bot</strong>
          <span>接入另一家供应商，或给同一个模型不同的性格与工具。</span>
        </button>
      </div>

      {editing ? (
        <BotEditor
          key={editing.id}
          initial={editing}
          existing={settings.bots.some((item) => item.id === editing.id)}
          providers={settings.providers}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await saveBot(next, { stayInSettings: embedded });
            setEditing(null);
          }}
          onDelete={
            settings.bots.length > 1
              ? async () => {
                  await deleteBot(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function BotEditor({
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
  const [draft, setDraft] = useState<Bot>(initial);
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
      title={title}
      subtitle="供应商和模型独立配置；云电脑是所有 Bot 共用的一台。"
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
      <div className="editor-grid">
        <section className="editor-block">
          <h3>身份</h3>
          <div className="identity-row">
            <BotAvatar bot={draft} size="xl" />
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

        <section className="editor-block">
          <h3>供应商</h3>
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
            <p className="inline-hint mono">
              {provider.baseUrl}
              {hasKey ? ' · 已保存密钥' : ' · 还没填密钥'}
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
              <Button size="sm" variant="glass" onClick={() => void saveProviderKey(draft.providerId, key).then(() => toast('密钥已加密保存'))}>
                保存
              </Button>
              <Button size="sm" variant="ghost" loading={testing} onClick={() => void test()}>
                测试
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

        <section className="editor-block editor-block--wide">
          <h3>人格与权限</h3>
          <Field label="系统提示词" hint="支持 {bot_name} 占位符">
            <textarea className="textarea" rows={6} value={draft.systemPrompt} onChange={(event) => patch('systemPrompt', event.target.value)} />
          </Field>
          <div className="two-col">
            <Field label="执行权限">
              <Segmented<ApprovalPolicy>
                value={draft.approvalPolicy}
                onChange={(value) => patch('approvalPolicy', value)}
                options={[
                  { value: 'never', label: '自动执行' },
                  { value: 'ask', label: '每次确认' },
                  { value: 'always', label: '全部允许' },
                ]}
              />
            </Field>
            <Field label="绘图通道">
              <Segmented<'api' | 'cloud'>
                value={draft.image.backend}
                onChange={(value) => setDraft((prev) => ({ ...prev, image: { ...prev.image, backend: value } }))}
                options={[
                  { value: 'api', label: '供应商 API' },
                  { value: 'cloud', label: '云主机出图' },
                ]}
              />
            </Field>
          </div>
          <Toggle
            checked={draft.image.wakeHost}
            onChange={(value) => setDraft((prev) => ({ ...prev, image: { ...prev.image, wakeHost: value } }))}
            label="绘图前唤醒云电脑"
            hint="即使走供应商 API，也先把共享云电脑叫醒（符合“有绘画任务就开机”的设定）"
          />
          {draft.image.backend === 'cloud' ? (
            <Field label="云主机绘图命令" hint="可用占位符：{prompt} {out} {aspect}">
              <textarea
                className="textarea mono"
                rows={3}
                value={draft.image.cloudCommand ?? ''}
                onChange={(event) => setDraft((prev) => ({ ...prev, image: { ...prev.image, cloudCommand: event.target.value } }))}
              />
            </Field>
          ) : null}
        </section>

        <section className="editor-block editor-block--wide">
          <h3>可用工具</h3>
          <div className="tool-toggles">
            {TOOLS.map((tool) => {
              const enabled = draft.tools.includes(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  className={`tool-toggle ${enabled ? 'is-on' : ''}`}
                  onClick={() =>
                    patch('tools', enabled ? draft.tools.filter((id) => id !== tool.id) : [...draft.tools, tool.id])
                  }
                >
                  <span className="tool-toggle__check">
                    <Icon name="check" size={12} />
                  </span>
                  <span>
                    <strong>{tool.label}</strong>
                    <em>{tool.hint}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
