import { useMemo, useState } from 'react';
import type { ApprovalPolicy, Bot, ProviderConfig } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { Button, Field, Segmented, Sheet } from './Glass';
import { BotAvatar } from './BotAvatar';
import { Icon } from './Icon';
import { BOT_TOOLS as TOOLS } from '../lib/bots';
import { AvatarPicker } from './AvatarPicker';
import { Select } from './Select';
import { BotGenerationEditor } from './BotGenerationEditor';
import { BotCapabilities } from './BotCapabilities';

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
        <BotGenerationEditor bot={draft} provider={provider} onChange={generation => patch('generation', generation)} />
        <div className="editor-block--wide"><BotCapabilities bot={draft} onChange={next => setDraft(prev => ({ ...prev, ...next }))} /></div>
      </div>
    </Sheet>
  );
}
