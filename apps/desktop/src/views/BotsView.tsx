import { useMemo, useState } from 'react';
import type { ApprovalPolicy, Bot, ProviderConfig } from '@mesh/core';
import { mesh } from '../lib/bridge';
import { useMesh } from '../state';
import { Button, Field, IconButton, Panel, Segmented, Sheet, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';

const DEFAULT_PROMPT = `你是 {bot_name}，一个运行在 MeshBot 里的通用智能体。
你有一台共享的云端 Linux 电脑（4 vCPU / 8 GB），平时处于休眠状态，需要时会被自动唤醒。
- 涉及文件、命令、脚本、绘图的任务，用 cloud_* 工具在云电脑里完成；聊天闲聊不必唤醒云电脑。
- 需要生成图片时调用 generate_image，它会按配置走云主机或图像 API。
- 长任务先说明计划，再用工具一步步执行，每一步都给出可验证的结果。
- 不确定的信息要说明不确定，不要编造命令输出。`;

const GRADIENTS = [
  { from: '#7aa2ff', to: '#c084fc' },
  { from: '#5eead4', to: '#60a5fa' },
  { from: '#fbbf24', to: '#fb7185' },
  { from: '#a78bfa', to: '#f472b6' },
  { from: '#34d399', to: '#a3e635' },
  { from: '#f97316', to: '#ef4444' },
];

const TOOLS: { id: string; label: string; hint: string }[] = [
  { id: 'cloud_exec', label: '云电脑命令', hint: '在共享 Linux 里执行 shell' },
  { id: 'cloud_read', label: '读书机文件', hint: '读取云电脑上的文本文件' },
  { id: 'cloud_write', label: '写云机文件', hint: '把结果写进云电脑' },
  { id: 'generate_image', label: '绘图', hint: '按需唤醒云主机出图' },
  { id: 'remember', label: '写长期记忆', hint: '跨会话记住事实' },
  { id: 'recall', label: '查长期记忆', hint: '关键词检索记忆' },
  { id: 'schedule_task', label: '定时任务', hint: '用 cron 创建自动化' },
  { id: 'web_fetch', label: '网页抓取', hint: '只读 https 页面' },
];

function newBot(provider: ProviderConfig | undefined, seed?: Bot): Bot {
  const now = Date.now();
  const gradient = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)]!;
  return seed
    ? { ...seed, id: crypto.randomUUID(), name: `${seed.name} 副本`, handle: `${seed.handle}-copy`, createdAt: now, updatedAt: now }
    : {
        id: crypto.randomUUID(),
        name: '新 Bot',
        handle: 'bot',
        avatar: { ...gradient, glyph: 'B' },
        providerId: provider?.id ?? '',
        model: provider?.defaultModel ?? '',
        temperature: 0.7,
        systemPrompt: DEFAULT_PROMPT,
        approvalPolicy: 'never',
        tools: TOOLS.map((tool) => tool.id),
        image: {
          backend: 'api',
          aspect: '1:1',
          wakeHost: true,
          cloudCommand: 'mkdir -p "$(dirname {out})" && python3 /opt/meshbot/draw.py --prompt {prompt} --out {out}',
          cloudOutputPath: '/data/meshbot/out/{name}.png',
        },
        wakeOnTask: true,
        createdAt: now,
        updatedAt: now,
      };
}

export function BotsView() {
  const { settings, saveBot, deleteBot, selectBot, bot: activeBot } = useMesh();
  const [editing, setEditing] = useState<Bot | null>(null);

  const providerName = (id: string) => settings.providers.find((provider) => provider.id === id)?.name ?? '未绑定供应商';

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Bot 管理</h1>
          <p>每个 Bot 有自己的供应商、模型、人格与权限；它们共用同一台按需唤醒的云电脑。</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing(newBot(settings.providers[0], undefined))}>
          新建 Bot
        </Button>
      </header>

      <div className="bots-grid">
        {settings.bots.map((item) => (
          <Panel key={item.id} className={`bot-card ${activeBot?.id === item.id ? 'is-active' : ''}`}>
            <div className="bot-card__glow" style={{ background: `radial-gradient(circle at 30% 0%, ${item.avatar.from}66, transparent 60%)` }} />
            <div className="bot-card__head">
              <span className="bot-avatar bot-avatar--xl" style={{ background: `linear-gradient(140deg, ${item.avatar.from}, ${item.avatar.to})` }}>
                {item.avatar.glyph}
              </span>
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
              <IconButton name="copy" label="复制这个 Bot" onClick={() => setEditing(newBot(settings.providers.find((p) => p.id === item.providerId), item))} />
            </div>
          </Panel>
        ))}

        <button type="button" className="bot-card bot-card--new" onClick={() => setEditing(newBot(settings.providers[0]))}>
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
            await saveBot(next);
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
  const { secrets, saveProviderKey, toast } = useMesh();
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
      const list = await mesh().listModels(draft.providerId);
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
      const result = await mesh().testProvider(draft.providerId);
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
            <span className="bot-avatar bot-avatar--xl" style={{ background: `linear-gradient(140deg, ${draft.avatar.from}, ${draft.avatar.to})` }}>
              {draft.avatar.glyph}
            </span>
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
          <div className="swatch-row">
            {GRADIENTS.map((gradient) => (
              <button
                key={gradient.from}
                type="button"
                aria-label="颜色"
                className={`swatch ${gradient.from === draft.avatar.from ? 'is-active' : ''}`}
                style={{ background: `linear-gradient(140deg, ${gradient.from}, ${gradient.to})` }}
                onClick={() => patch('avatar', { ...gradient, glyph: draft.avatar.glyph })}
              />
            ))}
          </div>
        </section>

        <section className="editor-block">
          <h3>供应商</h3>
          <Field label="供应商">
            <select
              className="select"
              value={draft.providerId}
              onChange={(event) => {
                const next = providers.find((item) => item.id === event.target.value);
                setDraft((prev) => ({ ...prev, providerId: event.target.value, model: next?.defaultModel ?? prev.model }));
                setModels([]);
              }}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.kind === 'gemini' ? 'Gemini 协议' : item.kind === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}）
                </option>
              ))}
            </select>
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
              <input className="input mono" list="model-options" value={draft.model} onChange={(event) => patch('model', event.target.value)} />
              <datalist id="model-options">
                {[...new Set([...models, ...(provider?.models ?? [])])].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
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