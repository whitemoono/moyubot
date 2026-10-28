import { useEffect, useRef, useState } from 'react';
import { deepSeekProvider, newBot } from '../lib/bots';
import { useMoyu } from '../state';
import { AvatarPicker } from './AvatarPicker';
import { BotAvatar } from './BotAvatar';
import { Button, Sheet } from './Glass';

export function CreateBotDialog({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings, saveBot, toast } = useMoyu();
  const [provider] = useState(() => deepSeekProvider(settings.providers));
  const [draft, setDraft] = useState(() => ({ ...newBot(provider), name: '' }));
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = nameRef.current?.closest('[role="dialog"]');
    nameRef.current?.focus();
    const trapFocus = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (!['Tab'].includes(keyEvent.key) || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter((node) => node.getClientRects().length);
      const first = controls[0]; const last = controls.at(-1);
      if (keyEvent.shiftKey && document.activeElement === first) { keyEvent.preventDefault(); last?.focus(); }
      else if (!keyEvent.shiftKey && document.activeElement === last) { keyEvent.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener('keydown', trapFocus);
    return () => { dialog?.removeEventListener('keydown', trapFocus); if (previous?.isConnected) previous.focus(); };
  }, []);
  const create = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      if (!settings.providers.some((item) => item.id === provider.id)) await saveSettings({ providers: [...settings.providers, provider] });
      const name = draft.name.trim();
      await saveBot({ ...draft, name, handle: `bot-${draft.id.slice(0, 8)}`, avatar: { ...draft.avatar, glyph: name[0]!.toUpperCase() }, updatedAt: Date.now() });
      onClose();
    } catch (error) { toast((error as Error).message, 'error'); setSaving(false); }
  };
  return <Sheet open title="创建新 Bot" className="sheet--create-bot" onClose={() => { if (!saving) onClose(); }} footer={<><span className="spacer" /><Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button><Button variant="primary" disabled={!draft.name.trim() || saving} loading={saving} onClick={() => void create()}>创建</Button></>}>
    <form className="create-bot-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <div className="create-bot-preview" style={{ backgroundColor: `${draft.avatar.from}0b` }}><BotAvatar bot={draft} size="xl" /></div>
      <input ref={nameRef} className="input create-bot-name" placeholder="给你的 Bot 起个名字" aria-label="Bot 名字" maxLength={60} value={draft.name} disabled={saving} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
      <AvatarPicker value={draft.avatar} onChange={(avatar) => setDraft((prev) => ({ ...prev, avatar }))} />
      <p className="create-bot-provider">DeepSeek · {provider.defaultModel}<span>创建后可在 Bot 管理中配置模型与 API Key</span></p>
    </form>
  </Sheet>;
}
