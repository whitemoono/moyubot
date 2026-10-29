import { useEffect, useRef, useState } from 'react';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Button, IconButton } from './Glass';
import { Icon } from './Icon';

interface TerminalState { command: string; lines: { kind: string; text: string }[]; running: boolean; requestId?: string }
export function WorkspaceTerminal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeWorkspace, cloud, cloudAction } = useMoyu();
  const [sessions, setSessions] = useState<Record<string, TerminalState>>({});
  const output = useRef<HTMLDivElement>(null);
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const isLocal = activeWorkspace?.kind === 'local';
  const session = sessions[workspaceId] ?? { command: '', lines: [], running: false };
  const awake = isLocal || cloud.state === 'ready' || cloud.state === 'busy';
  const sleeping = ['off', 'stopped', 'suspended'].includes(cloud.state);
  const update = (id: string, fn: (current: TerminalState) => TerminalState) => setSessions((previous) => ({ ...previous, [id]: fn(previous[id] ?? { command: '', lines: [], running: false }) }));
  useEffect(() => { if (output.current) output.current.scrollTop = output.current.scrollHeight; }, [session.lines, open, workspaceId]);
  const run = async () => {
    const cmd = session.command.trim(); if (!cmd || session.running || !awake) return;
    // Capture the destination before awaiting: switching the UI cannot reroute a command.
    const id = workspaceId, local = isLocal, requestId = crypto.randomUUID();
    update(id, (current) => ({ ...current, running: true, requestId, command: '', lines: [...current.lines.slice(-150), { kind: 'cmd', text: `${local ? 'PS>' : '$'} ${cmd}` }] }));
    try {
      const result = await (local ? moyu().localExec(cmd, requestId) : moyu().cloudExec(cmd, requestId));
      update(id, (current) => ({ ...current, lines: [...current.lines, ...[{ kind: 'out', text: result.stdout }, { kind: 'err', text: result.stderr }, { kind: 'err', text: result.timedOut ? '命令执行超时' : result.exitCode ? `退出码 ${result.exitCode}` : '' }].filter((line) => line.text)] }));
    } catch (error) { update(id, (current) => ({ ...current, lines: [...current.lines, { kind: 'err', text: (error as Error).message }] })); }
    finally { update(id, (current) => ({ ...current, running: false, requestId: undefined })); }
  };
  const stop = async () => {
    const id = workspaceId, requestId = session.requestId;
    if (!requestId) return;
    try { await moyu().stopTerminal(requestId); }
    catch (error) { update(id, (current) => ({ ...current, lines: [...current.lines, { kind: 'err', text: (error as Error).message }] })); }
  };
  return <section className="workspace-terminal" hidden={!open} aria-label={`${isLocal ? '本机' : '云电脑'}终端`}>
    <header><Icon name="terminal" size={15} /><strong>{isLocal ? '本机 PowerShell' : '云电脑终端'}</strong><span>{activeWorkspace?.name}</span><i className={awake ? 'is-online' : ''} /><small>{awake ? '在线' : sleeping ? '休眠中' : cloud.state === 'waking' ? '唤醒中' : cloud.state === 'unconfigured' ? '未配置' : '连接异常'}</small><IconButton name="trash" label="清空终端" disabled={session.running} onClick={() => update(workspaceId, (current) => ({ ...current, lines: [] }))} /><IconButton name="close" label="收起终端" onClick={onClose} /></header>
    <div ref={output} className="workspace-terminal__output" role="log" aria-live="polite">{!session.lines.length ? <p>{awake ? '输入命令开始工作。每条命令独立执行，工作目录为当前工作区。' : sleeping ? '云电脑正在休眠，唤醒后即可执行命令。' : cloud.lastError ?? '请先在电脑设置中完成连接。'}</p> : session.lines.map((line, index) => <pre key={index} className={`is-${line.kind}`}>{line.text}</pre>)}{session.running ? <p><span className="spinner" /> 正在执行…</p> : null}</div>
    {!awake ? <div className="workspace-terminal__offline"><Button size="sm" icon={sleeping ? 'power' : 'settings'} disabled={cloud.state === 'waking'} onClick={() => { if (sleeping) void cloudAction('wake'); else void cloudAction('refresh'); }}>{sleeping ? '唤醒云电脑' : '刷新连接状态'}</Button></div> : null}
    <form onSubmit={(event) => { event.preventDefault(); void run(); }}><span>{isLocal ? 'PS>' : '$'}</span><input aria-label="工作区终端命令" value={session.command} disabled={session.running || !awake} onChange={(event) => update(workspaceId, (current) => ({ ...current, command: event.target.value }))} placeholder={isLocal ? '在本机 Windows 执行命令' : '在云电脑执行命令'} spellCheck={false} />{session.running ? <Button type="button" size="sm" variant="danger" icon="stop" aria-label="停止终端命令" onClick={() => void stop()}>停止</Button> : <Button type="submit" size="sm" disabled={!awake || !session.command.trim()}>执行</Button>}</form>
  </section>;
}
