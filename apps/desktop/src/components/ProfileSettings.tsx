import { useRef, useState } from 'react';
import type { UiSettings } from '@moyu/core';
import { useMoyu } from '../state';
import { AvatarPicker } from './AvatarPicker';
import { Button, Panel } from './Glass';
import { DEFAULT_USER_AVATAR, UserAvatar } from './UserAvatar';
import { readAvatar } from '../lib/avatar-image';

export function ProfileSettings({ hidden }: { hidden: boolean }) {
  const { settings, saveSettings, toast } = useMoyu();
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const avatar = settings.ui.userAvatar ?? DEFAULT_USER_AVATAR;
  const persist = async (next: NonNullable<UiSettings['userAvatar']>) => {
    await saveSettings({ ui: { ...settings.ui, userAvatar: next } });
  };
  const choose = async (next: NonNullable<UiSettings['userAvatar']>) => {
    if (busy) return;
    setBusy(true);
    try { await persist(next); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try { const imageDataUrl = await readAvatar(file); await persist({ ...avatar, imageDataUrl }); toast('头像已更新'); }
    catch (error) { toast((error as Error).message || '图片读取失败，请换一张试试', 'error'); }
    finally { setBusy(false); }
  };
  return <Panel className="settings-card profile-settings" hidden={hidden}>
    <div className="panel-head"><div><h3>用户头像</h3><p>选择一个喜欢的角色，或者上传自己的图片。</p></div></div>
    <div className="profile-settings__preview"><UserAvatar className="profile-settings__avatar" animated={!hidden} /><div><strong>本地用户</strong><p>显示在左侧底部，点击头像打开功能菜单。</p><Button icon="image" size="sm" loading={busy} disabled={busy} onClick={() => uploadRef.current?.click()}>上传头像</Button></div></div>
    <fieldset className="profile-settings__choices" disabled={busy}><legend>内置头像</legend>
      <AvatarPicker value={avatar.imageDataUrl ? { ...avatar, shape: 'custom' } : avatar} onChange={(next) => void choose({ ...next, shape: next.shape === 'custom' ? avatar.shape : next.shape, imageDataUrl: undefined })} />
    </fieldset>
    <div className="profile-settings__foot"><p>支持 PNG、JPG、WebP、GIF，最大 8 MB；图片居中裁剪，仅保存在本机。</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => void choose({ ...DEFAULT_USER_AVATAR })}>恢复默认头像</Button></div>
    <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传用户头像" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
  </Panel>;
}
