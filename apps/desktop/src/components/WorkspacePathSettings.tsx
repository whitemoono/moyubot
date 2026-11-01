import { useEffect, useState } from 'react';
import { useMoyu } from '../state';
import { Button } from './Glass';

export function WorkspacePathSettings() {
  const { workspaces, settings, local, cloud, chooseLocalDirectory, saveSettings, toast } = useMoyu();
  const driver = settings.cloud.driver;
  const isE2B = driver === 'e2b';
  // Each backend has a different writable root: E2B runs as an unprivileged user
  // (can't create /data → must use /home/user), InstaBox uses /data/moyubot.
  const defaultRemote = isE2B ? '/home/user/moyubot' : '/data/moyubot';
  const driverLabel = driver === 'e2b' ? 'E2B' : driver === 'mock' ? '演示' : 'InstaBox';
  const localDirectory = workspaces.find((item) => item.kind === 'local')?.directory ?? '';
  // The stored path may belong to the other backend (e.g. /home/user… after
  // switching from E2B to InstaBox, or /data… the other way). Treat a mismatched
  // stored value as "unset" so the input reflects this driver's correct default.
  const storedRemote = settings.cloud.remoteWorkspaceDir;
  const mismatch = isE2B ? !!storedRemote && storedRemote.startsWith('/data')
    : driver === 'instabox' ? !!storedRemote && storedRemote.startsWith('/home/user')
    : false;
  const remoteDirectory = (!storedRemote || mismatch) ? defaultRemote : storedRemote;
  const [draft, setDraft] = useState(remoteDirectory);
  const [selecting, setSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(remoteDirectory), [remoteDirectory]);
  const dirty = draft.trim() !== remoteDirectory;
  const choose = async () => {
    setSelecting(true);
    try { await chooseLocalDirectory(); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setSelecting(false); }
  };
  const save = async () => {
    if (!dirty || saving) return;
    if (!draft.trim().startsWith('/') || /[\\\x00\r\n]/.test(draft)) { toast(`请填写 Linux 绝对路径，例如 ${defaultRemote}`, 'warn'); return; }
    if (isE2B && draft.trim().startsWith('/data')) { toast('E2B 沙箱无法写入 /data，请使用 /home/user 下的路径', 'warn'); return; }
    setSaving(true);
    try { await saveSettings({ cloud: { ...settings.cloud, remoteWorkspaceDir: draft.trim() } }); toast('云电脑工作路径已保存'); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  return <>
    <h3 className="settings-section-title">工作区路径</h3>
    <div className="settings-rows settings-workspace-paths">
      <div className="settings-row settings-path-row"><div><strong>本地工作区</strong><p>本机终端与 Bot 的默认工作目录。</p></div><div className="settings-path-control"><input className="input mono" aria-label="本地工作区路径" title={localDirectory} value={localDirectory} readOnly /><Button size="sm" icon="folder" loading={selecting} disabled={selecting || local.state === 'busy'} onClick={() => void choose()}>选择</Button></div></div>
      <div className="settings-row settings-path-row"><div><strong>云电脑工作区 <span style={{ fontWeight: 400, opacity: 0.7 }}>· {driverLabel}</span></strong><p>{isE2B ? 'E2B 沙箱内可写的 Linux 目录（须在 /home/user 下）。' : '云端终端与 Bot 共用的 Linux 目录。'}</p></div><form className="settings-path-control" onSubmit={(event) => { event.preventDefault(); void save(); }}><input className="input mono" aria-label="云电脑工作路径" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={defaultRemote} spellCheck={false} disabled={saving} /><Button type="submit" size="sm" icon="check" loading={saving} disabled={!dirty || saving || !draft.trim() || ['busy', 'waking', 'sleeping'].includes(cloud.state)}>保存</Button></form></div>
    </div>
    <p className="settings-path-note">{isE2B ? 'E2B 沙箱以普通用户运行，工作目录须位于 /home/user 下（如 /home/user/moyubot）。' : '云端目录在首次执行命令时自动创建。更换路径不会搬移原有文件。'}</p>
  </>;
}
