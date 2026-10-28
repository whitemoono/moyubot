import { useState } from 'react';
import type { AppSettings, ProviderConfig } from '@mesh/core';
import { mesh } from '../lib/bridge';
import { PRESETS as PROVIDER_PRESETS } from '../lib/presets';
import { useMesh } from '../state';
import { Button, Field, Panel, Segmented, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';

const ACCENTS = ['#7aa2ff', '#5eead4', '#c084fc', '#fb7185', '#fbbf24', '#34d399'];

const IMAGE_MODEL_HINT: Record<string, string> = {
  xai: 'grok-2-image',
  openai: 'gpt-image-1',
  gemini: 'gemini-2.5-flash-image',
  dashscope: 'wanx2.1-t2i-turbo',
  anthropic: '留空（Anthropic 暂无绘图）',
};

const imageModelHint = (provider: ProviderConfig) => IMAGE_MODEL_HINT[provider.id] ?? '留空则用供应商默认';

export function SettingsView() {
  const { settings, saveSettings, secrets, saveProviderKey, setView, version, platform, toast } = useMesh();
  const [providers, setProviders] = useState<ProviderConfig[]>(settings.providers);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramIds, setTelegramIds] = useState(settings.telegram.allowedIds.join(', '));

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) =>
    setProviders((prev) => prev.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)));

  const persistProviders = async () => {
    await saveSettings({ providers });
    toast('供应商配置已保存');
  };

  const addProvider = async (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const provider: ProviderConfig = {
      id: preset.id === 'custom' ? crypto.randomUUID() : preset.id,
      name: preset.label,
      kind: preset.kind,
      baseUrl: preset.baseUrl || 'https://api.example.com/v1',
      defaultModel: preset.model,
      models: preset.model ? [preset.model] : [],
      createdAt: Date.now(),
    };
    const next = [...providers.filter((item) => item.id !== provider.id), provider];
    setProviders(next);
    await saveSettings({ providers: next });
    toast(`已添加 ${provider.name}`);
  };

  const updateUi = (patch: Partial<AppSettings['ui']>) => void saveSettings({ ui: { ...settings.ui, ...patch } });

  const persistTelegram = async (patch: Partial<AppSettings['telegram']>) => {
    if (telegramToken) {
      await mesh().setTelegramToken(telegramToken);
      setTelegramToken('');
    }
    await saveSettings({ telegram: { ...settings.telegram, ...patch, allowedIds: telegramIds.split(',').map((id) => id.trim()).filter(Boolean) } });
    toast('Telegram 设置已保存');
  };

  return (
    <div className="view settings-view">
      <header className="view-head">
        <div>
          <h1>设置</h1>
          <p>供应商、外观、通道与数据。密钥使用系统级加密存储，不进入 settings.json。</p>
        </div>
        <span className={`badge badge--${secrets.encrypted ? 'ok' : 'warn'}`}>{secrets.encrypted ? '密钥已加密' : '密钥为明文（系统不支持加密）'}</span>
      </header>

      <Panel className="settings-card">
        <div className="panel-head">
          <div>
            <h3>供应商</h3>
            <p>任意 OpenAI 兼容端点，或原生 Anthropic / Gemini。每个 Bot 可以绑定不同供应商。</p>
          </div>
          <div className="head-actions">
            <select
              className="select select--compact"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void addProvider(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">添加预设…</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" icon="check" onClick={() => void persistProviders()}>
              保存全部
            </Button>
          </div>
        </div>

        <div className="provider-list">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              hasKey={Boolean(secrets.providerKeys[provider.id])}
              bots={settings.bots.filter((bot) => bot.providerId === provider.id).length}
              onChange={(patch) => updateProvider(provider.id, patch)}
              onSaveKey={async (key) => {
                await saveProviderKey(provider.id, key);
                toast('密钥已加密保存');
              }}
            />
          ))}
        </div>
      </Panel>

      <div className="settings-grid">
        <Panel className="settings-card">
          <div className="panel-head">
            <h3>外观</h3>
          </div>
          <Field label="强调色">
            <div className="swatch-row">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  aria-label={accent}
                  className={`swatch ${settings.ui.accent === accent ? 'is-active' : ''}`}
                  style={{ background: accent }}
                  onClick={() => void saveSettings({ ui: { ...settings.ui, accent } })}
                />
              ))}
            </div>
          </Field>
          <Field label="明暗">
            <Segmented
              value={settings.ui.appearance}
              onChange={(value) => void saveSettings({ ui: { ...settings.ui, appearance: value } })}
              options={[
                { value: 'dark', label: '深色' },
                { value: 'light', label: '浅色' },
                { value: 'system', label: '跟随系统' },
              ]}
            />
          </Field>
          <Field label={`玻璃浓度 ${Math.round(settings.ui.glassIntensity * 100)}%`}>
            <input
              className="range"
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.ui.glassIntensity}
              onChange={(event) => updateUi({ glassIntensity: Number(event.target.value) })}
            />
          </Field>
          <Field label="密度">
            <Segmented
              value={settings.ui.density}
              onChange={(value) => void saveSettings({ ui: { ...settings.ui, density: value } })}
              options={[
                { value: 'comfortable', label: '舒适' },
                { value: 'compact', label: '紧凑' },
              ]}
            />
          </Field>
          <Toggle
            checked={settings.ui.reduceMotion}
            onChange={(value) => void saveSettings({ ui: { ...settings.ui, reduceMotion: value } })}
            label="减少动效"
            hint="关闭极光漂移与弹簧位移"
          />
        </Panel>

        <Panel className="settings-card">
          <div className="panel-head">
            <div>
              <h3>Telegram 通道</h3>
              <p>长轮询、白名单制；机器人只主动出站，不开入站端口。</p>
            </div>
            <span className={`badge badge--${settings.telegram.enabled ? 'ok' : 'muted'}`}>{settings.telegram.enabled ? '已启用' : '未启用'}</span>
          </div>
          <Toggle
            checked={settings.telegram.enabled}
            onChange={(value) => void persistTelegram({ enabled: value })}
            label="启用 Telegram 网关"
            hint="白名单为空时拒绝所有消息（fail closed）"
          />
          <Field label="Bot Token" hint={secrets.telegramToken ? '已保存（输入新值可替换）' : '在 @BotFather 创建'}>
            <div className="key-row">
              <input className="input mono" type="password" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} placeholder="123456:ABC-…" />
              <Button size="sm" variant="glass" onClick={() => void persistTelegram({})}>
                保存
              </Button>
            </div>
          </Field>
          <Field label="允许的用户 ID" hint="逗号分隔；可先用 /help 获取 chat id（会显示在拒绝提示里）">
            <input className="input mono" value={telegramIds} onChange={(event) => setTelegramIds(event.target.value)} placeholder="123456789, 987654321" />
          </Field>
          <Field label="默认 Bot">
            <select
              className="select"
              value={settings.telegram.defaultBotId ?? settings.bots[0]?.id ?? ''}
              onChange={(event) => void saveSettings({ telegram: { ...settings.telegram, defaultBotId: event.target.value } })}
            >
              {settings.bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </Field>
        </Panel>

        <Panel className="settings-card">
          <div className="panel-head">
            <h3>关于</h3>
          </div>
          <dl className="about-list">
            <div>
              <dt>版本</dt>
              <dd className="mono">v{version}</dd>
            </div>
            <div>
              <dt>平台</dt>
              <dd className="mono">{platform}</dd>
            </div>
            <div>
              <dt>数据目录</dt>
              <dd className="mono">{settings.cloud.workspaceDir || '—'}</dd>
            </div>
            <div>
              <dt>许可</dt>
              <dd>MIT · 开源可自托管</dd>
            </div>
          </dl>
          <div className="about-actions">
            <Button variant="glass" icon="cloud" onClick={() => setView('cloud')}>
              云电脑设置
            </Button>
            <Button variant="ghost" icon="shield" onClick={() => toast('远程执行默认需要在云电脑里，Principal 不直接碰你的本机')}>
              安全模型
            </Button>
          </div>
          <p className="inline-hint">
            <Icon name="spark" size={14} /> 路线图：macOS / Android / iOS 会复用同一套 core 与 liquid glass 设计系统。
          </p>
        </Panel>
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  hasKey,
  bots,
  onChange,
  onSaveKey,
}: {
  provider: ProviderConfig;
  hasKey: boolean;
  bots: number;
  onChange: (patch: Partial<ProviderConfig>) => void;
  onSaveKey: (key: string) => Promise<void>;
}) {
  const { toast } = useMesh();
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>(provider.models);

  const test = async () => {
    if (key) await onSaveKey(key);
    setTesting(true);
    try {
      const result = await mesh().testProvider(provider.id);
      toast(`${provider.name}：${result.ok ? '连接正常' : '失败'} · ${result.message}`, result.ok ? 'info' : 'error');
    } finally {
      setTesting(false);
    }
  };

  const pull = async () => {
    try {
      const list = await mesh().listModels(provider.id);
      setModels(list);
      onChange({ models: list });
      toast(`${provider.name}：${list.length} 个模型`);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="provider-row">
      <div className="provider-row__head">
        <div className="provider-row__title">
          <span className="provider-dot" />
          <input className="inline-input" value={provider.name} onChange={(event) => onChange({ name: event.target.value })} />
          <span className="badge badge--muted">{provider.kind === 'openai' ? 'OpenAI 兼容' : provider.kind === 'anthropic' ? 'Anthropic' : 'Gemini'}</span>
          {bots > 0 ? <span className="badge badge--ok">{bots} 个 Bot</span> : null}
        </div>
        <span className={`badge badge--${hasKey ? 'ok' : 'muted'}`}>{hasKey ? '已配置密钥' : '无密钥'}</span>
      </div>
      <div className="provider-row__grid">
        <Field label="Base URL">
          <input className="input mono" value={provider.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} />
        </Field>
        <Field label="默认模型">
          <input className="input mono" list={`models-${provider.id}`} value={provider.defaultModel} onChange={(event) => onChange({ defaultModel: event.target.value })} />
          <datalist id={`models-${provider.id}`}>
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>
        <Field label="图像模型" hint="供 generate_image 工具使用">
          <input className="input mono" value={provider.imageModel ?? ''} placeholder={imageModelHint(provider)} onChange={(event) => onChange({ imageModel: event.target.value })} />
        </Field>
      </div>
      <div className="provider-row__foot">
        <div className="key-row">
          <input className="input mono" type="password" placeholder={hasKey ? '已保存（输入可替换）' : 'API Key'} value={key} onChange={(event) => setKey(event.target.value)} />
          <Button size="sm" variant="glass" onClick={() => void onSaveKey(key).then(() => toast('密钥已保存'))}>
            保存
          </Button>
          <Button size="sm" variant="ghost" loading={testing} onClick={() => void test()}>
            测试
          </Button>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void pull()}>
            模型列表
          </Button>
        </div>
      </div>
    </div>
  );
}