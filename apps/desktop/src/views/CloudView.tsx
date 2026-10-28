import { useState } from 'react';
import { CLOUD_META, formatDuration } from '../lib/format';
import { useMoyu } from '../state';
import { Button, Field, Panel, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';

interface TerminalLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

const IDLE_OPTIONS = [
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 1800, label: '30 分钟' },
];

export function CloudView() {
  const { settings, cloud, saveCloud, cloudAction, secrets, toast } = useMoyu();
  const [apiKey, setApiKey] = useState('');
  const [machineName, setMachineName] = useState(settings.cloud.machineName);
  const [idle, setIdle] = useState(settings.cloud.idleSuspendMinutes);
  const [autoSuspend, setAutoSuspend] = useState(settings.cloud.autoSuspendAfterSeconds);
  const [template, setTemplate] = useState(settings.cloud.templateId);
  const [driver, setDriver] = useState(settings.cloud.driver);
  const [lines, setLines] = useState<TerminalLine[]>([
    { kind: 'out', text: 'MoyuBot 云终端 · 唤醒后可直接在这里跑命令' },
  ]);
  const [command, setCommand] = useState('uname -a');
  const [busy, setBusy] = useState(false);

  const meta = CLOUD_META[cloud.state];
  const awake = cloud.state === 'ready' || cloud.state === 'busy';
  const configured = cloud.state !== 'unconfigured';

  const runCommand = async () => {
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setLines((prev) => [...prev, { kind: 'cmd', text: `$ ${cmd}` }]);
    try {
      const result = await window.moyu.cloudExec(cmd);
      setLines((prev) => [
        ...prev,
        ...(result.stdout ? [{ kind: 'out' as const, text: result.stdout }] : []),
        ...(result.stderr ? [{ kind: 'err' as const, text: result.stderr }] : []),
        ...(result.exitCode !== 0 ? [{ kind: 'err' as const, text: `exit ${result.exitCode}` }] : []),
      ]);
    } catch (error) {
      setLines((prev) => [...prev, { kind: 'err', text: (error as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const persist = async (apiKeyValue?: string) => {
    await saveCloud(
      {
        machineName,
        idleSuspendMinutes: idle,
        autoSuspendAfterSeconds: autoSuspend,
        templateId: template,
        driver,
        wakeOnDemand: settings.cloud.wakeOnDemand,
      },
      apiKeyValue,
    );
    setApiKey('');
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>共享云电脑</h1>
          <p>所有 Bot 共用一台 InstaBox 云主机。空闲自动休眠，出现绘图或任务时自动唤醒。</p>
        </div>
        <div className="head-actions">
          <Button variant="glass" icon="refresh" onClick={() => void cloudAction('refresh')}>
            刷新
          </Button>
          {awake ? (
            <Button variant="glass" icon="moon" onClick={() => void cloudAction('sleep')}>
              立即休眠
            </Button>
          ) : (
            <Button variant="primary" icon="power" disabled={!configured} onClick={() => void cloudAction('wake')}>
              唤醒云电脑
            </Button>
          )}
        </div>
      </header>

      {cloud.state === 'unconfigured' ? (
        <Panel className="notice notice--warn">
          <Icon name="key" size={18} />
          <div>
            <strong>还没有接入 InstaBox</strong>
            <p>填入 API Key 即可使用真实云主机；也可以把驱动切到「演示模式」先体验完整流程。</p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setDriver('mock');
              void saveCloud({ driver: 'mock' });
            }}
          >
            进入演示模式
          </Button>
        </Panel>
      ) : null}

      <div className="cloud-layout">
        <Panel className={`cloud-hero cloud-hero--${meta.tone}`}>
          <div className={`big-orb big-orb--${meta.tone}`}>
            <span className="big-orb__core" />
            <span className="big-orb__halo" />
            <span className="big-orb__label">{meta.label}</span>
          </div>
          <div className="cloud-hero__text">
            <h2>{cloud.machine?.name ?? settings.cloud.machineName}</h2>
            <p>{meta.hint}</p>
            {cloud.pendingReason ? <span className="cloud-reason">原因：{cloud.pendingReason}</span> : null}
            {cloud.lastError ? <span className="cloud-error">{cloud.lastError}</span> : null}
            {cloud.operationPhase ? <span className="cloud-phase">阶段：{cloud.operationPhase}</span> : null}
          </div>
          <div className="cloud-stats">
            <div>
              <span>唤醒次数</span>
              <strong>{cloud.wakeCount}</strong>
            </div>
            <div>
              <span>本次运行</span>
              <strong>{cloud.state === 'ready' || cloud.state === 'busy' ? formatDuration(cloud.awakeMs || Date.now() - (cloud.lastWakeAt ?? Date.now())) : '—'}</strong>
            </div>
            <div>
              <span>驱动</span>
              <strong>{settings.cloud.driver === 'mock' ? '演示' : 'InstaBox'}</strong>
            </div>
            <div>
              <span>规格</span>
              <strong>{settings.cloud.vcpus ?? 4}C · {Math.round((settings.cloud.memMiB ?? 8192) / 1024)}G</strong>
            </div>
          </div>
        </Panel>

        <Panel className="cloud-settings">
          <div className="panel-head">
            <h3>连接</h3>
            <span className={`badge badge--${driver === 'mock' || secrets.cloudKey ? 'ok' : 'muted'}`}>
              {driver === 'mock' ? '本地模拟' : secrets.cloudKey ? '密钥已保存' : '未保存密钥'}
            </span>
          </div>
          <Field label="驱动">
            <select className="select" value={driver} onChange={(event) => setDriver(event.target.value as typeof driver)}>
              <option value="instabox">InstaBox 云主机</option>
              <option value="mock">演示模式（本地模拟）</option>
            </select>
          </Field>
          <Field label="InstaBox API Key" hint="加密后保存在本机，只在主进程里使用">
            <div className="key-row">
              <input
                className="input mono"
                type="password"
                placeholder={secrets.cloudKey ? '已保存（输入可替换）' : 'ibk_…'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <Button size="sm" variant="glass" onClick={() => void persist(apiKey)}>
                保存
              </Button>
            </div>
          </Field>
          <Field label="API 地址">
            <input className="input mono" value={settings.cloud.baseUrl} readOnly />
          </Field>
          <Field label="机器名">
            <input className="input" value={machineName} onChange={(event) => setMachineName(event.target.value)} />
          </Field>
          <Field label="模板" hint="Free 计划可用 agent-browser">
            <select className="select" value={template} onChange={(event) => setTemplate(event.target.value)}>
              <option value="agent-browser">agent-browser（含桌面与 Chromium）</option>
              <option value="universal">universal（无桌面，更轻）</option>
            </select>
          </Field>
          <Button variant="glass" icon="check" onClick={() => void persist()}>
            保存设置
          </Button>
        </Panel>

        <Panel className="cloud-settings">
          <div className="panel-head">
            <h3>省电策略</h3>
          </div>
          <Field label={`空闲 ${idle} 分钟后本地休眠`} hint="客户端侧兜底，避免忘记休眠烧时长">
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={idle}
              className="range"
              onChange={(event) => setIdle(Number(event.target.value))}
            />
          </Field>
          <Field label="InstaBox 空闲休眠" hint="服务端自动挂起（保留运行现场）">
            <select className="select" value={autoSuspend} onChange={(event) => setAutoSuspend(Number(event.target.value))}>
              {IDLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Toggle
            checked={settings.cloud.wakeOnDemand}
            onChange={(value) => void saveCloud({ wakeOnDemand: value })}
            label="按需唤醒"
            hint="任务 / 绘图开始时自动开机"
          />
          <div className="cost-note">
            <Icon name="spark" size={16} />
            <p>休眠时不计运行时长；恢复到运行现场通常需要 1–3 秒，日志与文件都保留。</p>
          </div>
        </Panel>

        <Panel className="cloud-terminal">
          <div className="panel-head">
            <h3>云终端</h3>
            <span className="badge badge--muted">{cloud.machine?.id?.slice(0, 12) ?? '未分配机器'}</span>
          </div>
          <div className="terminal__body">
            {lines.map((line, index) => (
              <pre key={index} className={`terminal-line terminal-line--${line.kind}`}>
                {line.text}
              </pre>
            ))}
          </div>
          <div className="terminal__input">
            <span className="terminal__prompt">$</span>
            <input
              className="mono"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runCommand();
              }}
              placeholder="uname -a"
            />
            <Button size="sm" variant="glass" loading={busy} onClick={() => void runCommand()}>
              运行
            </Button>
          </div>
          <p className="inline-hint">演示模式下命令由本地模拟器返回；接入真实 Key 后直接走 InstaBox exec。</p>
        </Panel>
      </div>

      <p className="foot-note">
        云主机工作区：<span className="mono">{settings.cloud.workspaceDir || '—'}</span> · 生成的图片会下载到本地 images 目录
        <button type="button" className="link-btn" onClick={() => toast('密钥由系统加密存储，不写入 settings.json')}>
          存储说明
        </button>
      </p>
    </div>
  );
}