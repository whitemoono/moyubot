import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@moyu/core';
import { CLOUD_META, formatDuration } from '../lib/format';
import { useMoyu } from '../state';
import { Button, Field, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { TerminalCommand } from '../components/TerminalCommand';

interface TerminalLine { kind: 'cmd' | 'out' | 'err'; text: string }
const IDLE_OPTIONS = [300, 600, 900, 1800].map((seconds) => ({ value: String(seconds), label: `${seconds / 60} 分钟` }));
const connection = (cloud: AppSettings['cloud']) => ({ driver: cloud.driver, baseUrl: cloud.baseUrl, machineName: cloud.machineName, templateId: cloud.templateId, idleSuspendMinutes: cloud.idleSuspendMinutes, autoSuspendAfterSeconds: cloud.autoSuspendAfterSeconds, wakeOnDemand: cloud.wakeOnDemand });

export function CloudView(props: { active?: boolean; onDirty?: (value: boolean) => void }) {
  const { activeWorkspace } = useMoyu();
  return activeWorkspace?.kind === 'local' ? <LocalWorkspaceView active={props.active} /> : <CloudWorkspacePanel {...props} />;
}

function LocalWorkspaceView({ active = true }: { active?: boolean }) {
  const { activeWorkspace, chooseLocalDirectory, toast } = useMoyu();
  const [command, setCommand] = useState('Get-Location');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [executing, setExecuting] = useState(false);
  const output = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active && output.current) output.current.scrollTop = output.current.scrollHeight; }, [lines, active]);
  const run = async () => {
    const cmd = command.trim(); if (!cmd || executing) return;
    setExecuting(true); setLines((previous) => [...previous.slice(-100), { kind: 'cmd', text: cmd }]);
    try { const result = await window.moyu.localExec(cmd); setLines((previous) => [...previous, ...(result.stdout ? [{ kind: 'out' as const, text: result.stdout }] : []), ...(result.stderr ? [{ kind: 'err' as const, text: result.stderr }] : []), ...(result.exitCode ? [{ kind: 'err' as const, text: `exit ${result.exitCode}` }] : [])]); }
    catch (error) { setLines((previous) => [...previous, { kind: 'err', text: (error as Error).message }]); }
    finally { setExecuting(false); }
  };
  return <div className="computer-page"><div className="computer-page__scroll">
    <section className="computer-overview computer-overview--ready" aria-label="本地工作区状态"><div className="computer-overview__top"><div className="computer-device" aria-hidden="true"><Icon name="terminal" size={42} /><i /></div><div className="computer-overview__identity"><div><h3>本机 Windows</h3><span className="computer-status"><i />本机已就绪</span></div><p>所有本地工作区 Bot 共用这台电脑</p></div></div><div className="computer-metrics"><div><span>工作区</span><strong>{activeWorkspace?.name}</strong></div><div><span>执行位置</span><strong>本机</strong></div><div><span>终端</span><strong>PowerShell</strong></div><div><span>状态</span><strong>在线</strong></div></div></section>
    <div className="computer-workspace"><Icon name="folder" size={14} /><span>工作目录<strong>{activeWorkspace?.directory}</strong></span><Button size="sm" disabled={executing} onClick={() => void chooseLocalDirectory().catch((error: Error) => toast(error.message, 'error'))}>选择目录</Button></div>
    <section className="computer-terminal"><header><div><span className="computer-terminal__lights"><i /><i /><i /></span><span>本机终端</span><small>Windows PowerShell · 本地执行</small></div><Button size="sm" variant="ghost" icon="trash" disabled={executing || !lines.length} onClick={() => setLines([])}>清空</Button></header><div className="computer-terminal__output" ref={output} role="log" aria-live="polite" aria-label="本机终端输出">{lines.length ? lines.map((line, index) => <pre key={index} className={`computer-terminal__line computer-terminal__line--${line.kind}`}>{line.kind === 'cmd' ? <span>PS&gt; </span> : null}{line.text}</pre>) : <div className="computer-terminal__empty"><Icon name="terminal" size={26} /><strong>本机终端已就绪</strong><p>命令会在当前 Windows 工作区执行，所有本地 Bot 共用这个环境。</p></div>}{executing ? <p className="computer-terminal__running"><span className="spinner" />正在执行…</p> : null}</div><TerminalCommand className="computer-terminal__command" command={command} onChange={setCommand} onRun={() => void run()} local running={executing} label="本机终端命令" runLabel="运行" /><p className="computer-terminal__hint">每条命令独立执行，起始目录为所选工作目录；本机执行使用你的 Windows 账户权限。</p></section>
  </div></div>;
}

function CloudWorkspacePanel({ active = true, onDirty }: { active?: boolean; onDirty?: (value: boolean) => void }) {
  const { settings, cloud, saveCloud, cloudAction, secrets, toast } = useMoyu();
  const [draft, setDraft] = useState(() => connection(settings.cloud));
  const [apiKey, setApiKey] = useState('');
  const [tab, setTab] = useState<'connection' | 'terminal'>('connection');
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [command, setCommand] = useState('uname -a');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const output = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(connection(settings.cloud)) || Boolean(apiKey);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const awake = cloud.state === 'ready' || cloud.state === 'busy';
  const transitioning = cloud.state === 'waking' || cloud.state === 'sleeping';
  const meta = CLOUD_META[cloud.state];
  const patch = (value: Partial<typeof draft>) => setDraft((previous) => ({ ...previous, ...value }));
  useEffect(() => {
    if (!active || !awake) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, awake]);
  useEffect(() => { if (tab === 'terminal' && output.current) output.current.scrollTop = output.current.scrollHeight; }, [lines, tab]);
  const persist = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!draft.machineName.trim()) throw new Error('请填写机器名称');
      const url = new URL(draft.baseUrl.trim());
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API 地址需要使用 HTTP 或 HTTPS');
      const next = { ...draft, machineName: draft.machineName.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, '') };
      await saveCloud(next, apiKey.trim() || undefined);
      setDraft(next); setApiKey('');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  const act = async (action: 'wake' | 'sleep' | 'refresh') => {
    if (acting || saving) return;
    setActing(true);
    try { await cloudAction(action); } finally { setActing(false); }
  };
  const run = async () => {
    const cmd = command.trim();
    if (!cmd || executing || !awake || dirty || saving) return;
    setExecuting(true);
    setLines((previous) => [...previous.slice(-100), { kind: 'cmd', text: cmd }]);
    try {
      const result = await window.moyu.cloudExec(cmd);
      setLines((previous) => [...previous, ...(result.stdout ? [{ kind: 'out' as const, text: result.stdout }] : []), ...(result.stderr ? [{ kind: 'err' as const, text: result.stderr }] : []), ...(result.exitCode ? [{ kind: 'err' as const, text: `exit ${result.exitCode}` }] : [])]);
    } catch (error) { setLines((previous) => [...previous, { kind: 'err', text: (error as Error).message }]); }
    finally { setExecuting(false); }
  };
  const duration = awake ? formatDuration(cloud.lastWakeAt ? now - cloud.lastWakeAt : cloud.awakeMs) : '—';
  return <div className="computer-page">
    <div className="computer-page__scroll">
      <section className={`computer-overview computer-overview--${cloud.state}`} aria-label="云电脑状态">
        <div className="computer-overview__top">
          <div className="computer-device" aria-hidden="true"><svg viewBox="0 0 80 64" fill="none"><rect x="7" y="6" width="66" height="42" rx="6" /><path d="M7 38h66M32 48v9m16-9v9M25 58h30" /><circle cx="40" cy="23" r="6" /></svg><i /></div>
          <div className="computer-overview__identity"><div><h3>{cloud.machine?.name ?? settings.cloud.machineName}</h3><span className="computer-status" role="status"><i />{meta.label}</span></div><p>{settings.cloud.driver === 'mock' ? '演示环境 · ' : ''}{meta.hint}</p></div>
          <div className="computer-overview__actions"><Button size="sm" variant="ghost" icon="refresh" aria-label="刷新云电脑状态" title="刷新状态" disabled={acting || transitioning || saving} loading={acting} onClick={() => void act('refresh')} /><Button size="sm" variant={awake ? 'glass' : 'primary'} icon={awake ? 'moon' : 'power'} disabled={acting || transitioning || saving || dirty || cloud.state === 'unconfigured' || executing || cloud.state === 'busy'} loading={transitioning} onClick={() => void act(awake ? 'sleep' : 'wake')}>{transitioning ? cloud.state === 'waking' ? '正在唤醒' : '正在休眠' : awake ? '立即休眠' : '唤醒电脑'}</Button></div>
        </div>
        <div className="computer-metrics"><div><span>本次在线</span><strong>{duration}</strong></div><div><span>唤醒次数</span><strong>{cloud.wakeCount}<small> 次</small></strong></div><div><span>运行环境</span><strong>{settings.cloud.driver === 'mock' ? '本地演示' : 'InstaBox'}</strong></div><div><span>配置规格</span><strong>{settings.cloud.vcpus ?? 4}<small> vCPU</small><em> / </em>{Math.round((settings.cloud.memMiB ?? 8192) / 1024)}<small> GB</small></strong></div></div>
        {transitioning ? <div className="computer-operation"><span className="spinner" /><span>{cloud.state === 'waking' ? '正在恢复执行环境，请稍候…' : '正在保存工作状态，请稍候…'}</span></div> : null}
      </section>
      {cloud.lastError || cloud.state === 'unconfigured' ? <div className="computer-notice" role="status"><Icon name={cloud.lastError ? 'alert' : 'key'} size={15} /><span>{cloud.lastError || '添加 InstaBox API Key 并保存即可连接；也可以选择演示模式先体验。'}</span></div> : null}
      <div className="computer-subnav" role="tablist" aria-label="云电脑页面"><button type="button" role="tab" id="computer-tab-connection" aria-controls="computer-panel-connection" aria-selected={tab === 'connection'} onClick={() => setTab('connection')} onKeyDown={(e) => { if (e.key === 'ArrowRight') { setTab('terminal'); document.getElementById('computer-tab-terminal')?.focus(); } }}><Icon name="sliders" size={14} />连接与策略</button><button type="button" role="tab" id="computer-tab-terminal" aria-controls="computer-panel-terminal" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')} onKeyDown={(e) => { if (e.key === 'ArrowLeft') { setTab('connection'); document.getElementById('computer-tab-connection')?.focus(); } }}><Icon name="terminal" size={14} />云终端</button><span>{cloud.machine?.id ?? '尚未分配机器'}</span></div>
      <div id="computer-panel-connection" role="tabpanel" aria-labelledby="computer-tab-connection" hidden={tab !== 'connection'} className="computer-config">
        <section className="computer-card"><header><Icon name="plug" size={16} /><h4>连接配置</h4><span>{secrets.cloudKey ? '密钥已保存' : draft.driver === 'mock' ? '无需密钥' : '等待连接'}</span></header><fieldset disabled={saving || acting || executing || transitioning} className="computer-fields">
          <div className="computer-fields__pair"><Field label="运行环境"><Select label="云电脑驱动" value={draft.driver} onChange={(value) => patch({ driver: value as typeof draft.driver })} options={[{ value: 'instabox', label: 'InstaBox', hint: '真实云电脑' }, { value: 'mock', label: '演示模式', hint: '本地模拟，不连接云主机' }]} /></Field><Field label="环境模板"><Select label="云电脑模板" value={draft.templateId} onChange={(value) => patch({ templateId: value })} options={[{ value: 'agent-browser', label: 'agent-browser', hint: '桌面与 Chromium' }, { value: 'universal', label: 'universal', hint: '轻量环境，无桌面' }]} /></Field></div>
          <Field label="机器名称"><input className="input" aria-label="云电脑机器名" value={draft.machineName} onChange={(e) => patch({ machineName: e.target.value })} /></Field>
          <Field label="API 地址"><input className="input mono" aria-label="云电脑 API 地址" value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} spellCheck={false} /></Field>
          <Field label="InstaBox API Key" hint={secrets.cloudKey ? '留空保留已保存密钥。' : '演示模式无需填写，密钥在本机独立保存。'}><input className="input mono" aria-label="云电脑 API Key" autoComplete="new-password" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={secrets.cloudKey ? '••••••••••••••••' : 'ibk_…'} /></Field>
        </fieldset></section>
        <section className="computer-card"><header><Icon name="moon" size={16} /><h4>运行策略</h4><span>按需运行</span></header><div className="computer-policy">
          <Toggle checked={draft.wakeOnDemand} disabled={saving || acting || executing || transitioning} onChange={(value) => patch({ wakeOnDemand: value })} label="按需唤醒" hint="任务或绘图需要执行环境时，自动唤醒。" />
          <div className="computer-policy__row"><div><strong>本地空闲休眠</strong><p>客户端的空闲保护</p></div><span>{draft.idleSuspendMinutes} 分钟</span></div><input className="range" aria-label="本地空闲休眠" type="range" min={1} max={30} step={1} disabled={saving || acting || executing || transitioning} value={draft.idleSuspendMinutes} onChange={(e) => patch({ idleSuspendMinutes: Number(e.target.value) })} />
          <div className="computer-policy__row"><div><strong>服务端空闲休眠</strong><p>由云主机自动保存运行现场</p></div></div><Select label="空闲休眠" disabled={saving || acting || executing || transitioning} value={String(draft.autoSuspendAfterSeconds)} options={IDLE_OPTIONS} onChange={(value) => patch({ autoSuspendAfterSeconds: Number(value) })} />
          <p className="computer-policy__note"><Icon name="folder" size={13} />休眠保留工作文件，唤醒后继续使用。</p>
        </div></section>
        <div className="computer-workspace"><Icon name="folder" size={14} /><span>云端工作目录<strong title={settings.cloud.remoteWorkspaceDir ?? '/data/moyubot'}>{settings.cloud.remoteWorkspaceDir ?? '/data/moyubot'}</strong></span><small>可在通用设置中修改</small></div>
      </div>
      <section id="computer-panel-terminal" role="tabpanel" aria-labelledby="computer-tab-terminal" hidden={tab !== 'terminal'} className="computer-terminal">
        <header><div><span className="computer-terminal__lights"><i /><i /><i /></span><span>云终端</span><small>{settings.cloud.driver === 'mock' ? '演示环境 · 模拟输出' : 'InstaBox · 远程执行'}</small></div><Button size="sm" variant="ghost" icon="trash" disabled={executing || !lines.length} onClick={() => setLines([])}>清空</Button></header>
        <div className="computer-terminal__output" ref={output} role="log" aria-live="polite" aria-label="云终端输出">{lines.length ? lines.map((line, index) => <pre key={index} className={`computer-terminal__line computer-terminal__line--${line.kind}`}>{line.kind === 'cmd' ? <span>$ </span> : null}{line.text}</pre>) : <div className="computer-terminal__empty"><Icon name="terminal" size={26} /><strong>{awake ? '环境已就绪' : '唤醒后开始工作'}</strong><p>{settings.cloud.driver === 'mock' ? '演示模式返回模拟结果，可先体验命令流程。' : '在共享云电脑执行命令，结果显示在这里。'}</p></div>}{executing ? <p className="computer-terminal__running"><span className="spinner" />正在执行…</p> : null}</div>
        <TerminalCommand className="computer-terminal__command" command={command} onChange={setCommand} onRun={() => void run()} local={false} running={executing} disabled={!awake || saving || dirty} label="云终端命令" runLabel="运行" />
        <p className="computer-terminal__hint">{dirty ? '请先保存配置，再执行命令。' : !awake ? '先在上方唤醒电脑，再运行命令。' : '命令在共享云电脑执行，所有 Bot 共用这个环境。'}</p>
      </section>
    </div>
    <footer className="computer-savebar"><span><Icon name={dirty ? 'edit' : 'check'} size={13} />{dirty ? '有未保存的更改' : '配置已保存'}<small>{dirty ? '保存后应用到共享云电脑' : '纯聊天无需唤醒云电脑'}</small></span><div>{dirty ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(connection(settings.cloud)); setApiKey(''); }}>还原</Button> : null}<Button variant="primary" size="sm" icon="check" disabled={saving || !dirty || acting || executing || transitioning} loading={saving} onClick={() => void persist()}>保存设置</Button></div></footer>
  </div>;
}
