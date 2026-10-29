import { useEffect, useState } from 'react';
import { useMoyu } from '../state';
import { Button } from './Glass';

export function WorkspacePathSettings() {
  const { workspaces, settings, local, cloud, chooseLocalDirectory, saveSettings, toast } = useMoyu();
  const localDirectory = workspaces.find((item) => item.kind === 'local')?.directory ?? '';
  const remoteDirectory = settings.cloud.remoteWorkspaceDir ?? '/data/moyubot';
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
    if (!draft.trim().startsWith('/') || /[\\\x00\r\n]/.test(draft)) { toast('请填写 Linux 绝对路径，例如 /data/moyubot', 'warn'); return; }
    setSaving(true);
    try { await saveSettings({ cloud: { ...settings.cloud, remoteWorkspaceDir: draft.trim() } }); toast('云电脑工作路径已保存'); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  return <>
    <h3 className="settings-section-title">工作区路径</h3>
    <div className="settings-rows settings-workspace-paths">
      <div className="settings-row settings-path-row"><div><strong>本地工作区</strong><p>本机终端与 Bot 的默认工作目录。</p></div><div className="settings-path-control"><input className="input mono" aria-label="本地工作区路径" title={localDirectory} value={localDirectory} readOnly /><Button size="sm" icon="folder" loading={selecting} disabled={selecting || local.state === 'busy'} onClick={() => void choose()}>选择</Button></div></div>
      <div className="settings-row settings-path-row"><div><strong>云电脑工作区</strong><p>云端终端与 Bot 共用的 Linux 目录。</p></div><form className="settings-path-control" onSubmit={(event) => { event.preventDefault(); void save(); }}><input className="input mono" aria-label="云电脑工作路径" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="/data/moyubot" spellCheck={false} disabled={saving} /><Button type="submit" size="sm" icon="check" loading={saving} disabled={!dirty || saving || !draft.trim() || ['busy', 'waking', 'sleeping'].includes(cloud.state)}>保存</Button></form></div>
    </div>
    <p className="settings-path-note">云端目录在首次执行命令时自动创建。更换路径不会搬移原有文件。</p>
  </>;
}
