import { useEffect, useRef } from 'react';
import { useMoyu } from '../state';
import { Button, IconButton } from './Glass';
import { Icon } from './Icon';
import { XtermView } from './XtermView';

/**
 * Bottom-drawer interactive terminal. Uses a real PTY shell (xterm.js):
 *  - local  → PowerShell (node-pty)
 *  - cloud  → E2B sandbox PTY
 * For backends without PTY support (InstaBox / mock) it falls back to a notice.
 */
export function WorkspaceTerminal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeWorkspace, cloud, cloudAction, settings } = useMoyu();
  const fitRef = useRef<{ fit: () => void } | undefined>(undefined);
  const workspaceId = activeWorkspace?.id ?? 'workspace_cloud';
  const isLocal = activeWorkspace?.kind === 'local';
  const awake = isLocal || cloud.state === 'ready' || cloud.state === 'busy';
  const sleeping = ['off', 'stopped', 'suspended'].includes(cloud.state);
  // E2B cloud exposes a real PTY; InstaBox / mock do not.
  const ptySupported = isLocal || settings.cloud.driver === 'e2b';

  // Re-fit xterm when the drawer opens or the window resizes.
  useEffect(() => {
    if (!open || !awake || !ptySupported) return;
    const timer = window.setTimeout(() => fitRef.current?.fit(), 120);
    const onResize = () => fitRef.current?.fit();
    window.addEventListener('resize', onResize);
    return () => { window.clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, [open, awake, ptySupported, workspaceId]);

  return <section className="workspace-terminal" hidden={!open} aria-label={`${isLocal ? '本机' : '云电脑'}终端`}>
    <header><Icon name="terminal" size={15} /><strong>{isLocal ? '本机 PowerShell' : '云电脑终端'}</strong><span>{activeWorkspace?.name}</span><i className={awake ? 'is-online' : ''} /><small>{awake ? '在线 · 交互式' : sleeping ? '休眠中' : cloud.state === 'waking' ? '唤醒中' : cloud.state === 'unconfigured' ? '未配置' : '连接异常'}</small><IconButton name="close" label="收起终端" onClick={onClose} /></header>
    {awake && ptySupported
      ? <div className="workspace-terminal__xterm" style={{ height: '320px' }}><XtermView kind={isLocal ? 'local' : 'cloud'} className="" onReady={(api) => { fitRef.current = api; }} /></div>
      : <div className="workspace-terminal__output" role="log" aria-live="polite"><p>{!ptySupported ? '当前云电脑驱动不支持交互终端，请在设置中改用 E2B，或使用「云电脑」页面。' : sleeping ? '云电脑正在休眠，唤醒后即可打开交互终端。' : cloud.lastError ?? '请先在电脑设置中完成连接。'}</p></div>}
    {!awake ? <div className="workspace-terminal__offline"><Button size="sm" icon={sleeping ? 'power' : 'settings'} disabled={cloud.state === 'waking'} onClick={() => { if (sleeping) void cloudAction('wake'); else void cloudAction('refresh'); }}>{sleeping ? '唤醒云电脑' : '刷新连接状态'}</Button></div> : null}
  </section>;
}
