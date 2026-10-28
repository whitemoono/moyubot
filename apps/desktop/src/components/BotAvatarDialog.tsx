import { useRef, useState } from 'react';
import type { Bot } from '@moyu/core';
import { readAvatar } from '../lib/avatar-image';
import { useMoyu } from '../state';
import { AvatarPicker } from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import { Button, Sheet } from './Glass';

export function BotAvatarDialog({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { saveBot, toast } = useMoyu();
  const [avatar, setAvatar] = useState(bot.avatar);
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const imageDataUrl = await readAvatar(file);
      setAvatar((current) => ({ ...current, imageDataUrl }));
    } catch (error) { toast((error as Error).message || '图片读取失败，请换一张试试', 'error'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try { await saveBot({ ...bot, avatar }, { stayInSettings: true }); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return <Sheet open title="修改 Bot 头像" onClose={() => { if (!busy) onClose(); }} className="bot-avatar-dialog" footer={<>
    <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
    <Button variant="primary" size="sm" disabled={busy} loading={busy} onClick={() => void save()}>保存头像</Button>
  </>}>
    <div className="bot-avatar-dialog__preview"><BotAvatar bot={{ ...bot, id: `avatar-preview-${bot.id}`, avatar }} size="xl" /><div><strong>{bot.name}</strong><p>{avatar.imageDataUrl ? '自定义图片头像' : '内置动态头像'}</p><Button icon="image" size="sm" disabled={busy} onClick={() => uploadRef.current?.click()}>上传头像</Button></div></div>
    <fieldset disabled={busy} className="bot-avatar-dialog__choices"><legend>内置头像</legend><AvatarPicker value={avatar} onChange={setAvatar} /></fieldset>
    <p className="bot-avatar-dialog__hint">支持 PNG、JPG、WebP、GIF，最大 8 MB，自动居中裁剪。</p>
    <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传 Bot 头像" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
  </Sheet>;
}
