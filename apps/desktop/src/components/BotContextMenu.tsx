import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Bot } from '@moyu/core';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { Icon } from './Icon';
import { Button, Sheet } from './Glass';

type ActionDialog = 'rename' | 'group' | 'delete';

export function BotContextMenu({ bot, x, y, onClose, onTogglePin }: { bot: Bot; x: number; y: number; onClose: () => void; onTogglePin: () => Promise<void> }) {
  const { settings, updateBotMetadata, deleteBot, runningBotIds, toast } = useMoyu();
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });
  const menuRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const groups = (settings.ui.botGroups ?? []).map((group) => group.name);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu) setPosition({ left: Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)), top: Math.max(40, Math.min(y, innerHeight - menu.offsetHeight - 8)) });
  }, [x, y]);

  useEffect(() => {
    if (dialog) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    // Transcript auto-scroll must not dismiss a newly opened sidebar menu.
    window.addEventListener('wheel', scroll, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', scroll);
    };
  }, [dialog, onClose]);

  useEffect(() => {
    if (!dialog) return;
    const root = formRef.current?.closest('[role="dialog"]');
    (root?.querySelector<HTMLInputElement>('input') ?? root?.querySelector<HTMLButtonElement>('.sheet__foot button'))?.focus();
    const trap = (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key !== 'Tab' || !root) return;
      const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter((node) => node.getClientRects().length);
      if (key.shiftKey && document.activeElement === controls[0]) { key.preventDefault(); controls.at(-1)?.focus(); }
      else if (!key.shiftKey && document.activeElement === controls.at(-1)) { key.preventDefault(); controls[0]?.focus(); }
    };
    root?.addEventListener('keydown', trap);
    return () => root?.removeEventListener('keydown', trap);
  }, [dialog]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); setBusy(false); }
  };
  const openDialog = (action: ActionDialog) => {
    setValue(action === 'rename' ? bot.name : bot.sidebar?.group ?? '');
    setDialog(action);
  };
  const submit = () => run(async () => {
    if (dialog === 'delete') await deleteBot(bot.id);
    else if (dialog === 'rename') await updateBotMetadata(bot.id, { name: value.trim() });
    else await updateBotMetadata(bot.id, { sidebar: { group: value.trim() } });
  });
  const close = () => { if (!busy) onClose(); };

  if (dialog) return createPortal(<Sheet open title={dialog === 'rename' ? '重命名 Bot' : dialog === 'group' ? '移至分组' : `删除 ${bot.name}？`} className="sheet--bot-action" onClose={close} footer={<><span className="spacer" /><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button variant={dialog === 'delete' ? 'danger' : 'primary'} disabled={busy || (dialog === 'rename' && !value.trim())} loading={busy} onClick={() => void submit()}>{dialog === 'delete' ? '删除' : '保存'}</Button></>}>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); if (dialog !== 'rename' || value.trim()) void submit(); }}>
      {dialog === 'delete' ? <p className="bot-action-hint">将移除这个 Bot，本地对话记录和记忆会保留。</p> : <>
        <label className="field"><span className="field__label">{dialog === 'rename' ? 'Bot 名字' : '分组名称'}</span><input className="input" aria-label={dialog === 'rename' ? 'Bot 名字' : '分组名称'} maxLength={60} value={value} disabled={busy} placeholder={dialog === 'group' ? '输入新分组，或选择已有分组' : ''} onChange={(event) => setValue(event.target.value)} /></label>
        {dialog === 'group' ? <><div className="bot-group-choices">{groups.map((name) => <button type="button" key={name} aria-pressed={value === name} disabled={busy} onClick={() => setValue(name)}><Icon name="folder" size={14} />{name}</button>)}<button type="button" aria-pressed={!value} disabled={busy} onClick={() => setValue('')}>不分组</button></div><p className="bot-action-hint">相同名称的 Bot 会归入同一分组。</p></> : null}
      </>}
    </form>
  </Sheet>, document.body);

  return createPortal(<div ref={menuRef} className="bot-context-menu" role="menu" aria-label={`${bot.name} 的菜单`} style={position} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-bot-id="${CSS.escape(bot.id)}"]`)?.focus());
      }
      onClose();
    }
  }}>
    <button role="menuitem" type="button" disabled={busy} onClick={() => void run(onTogglePin)}><Icon name="pin" size={16} /><span>{bot.sidebar?.pinned ? '取消置顶' : '置顶'}</span></button>
    <button role="menuitem" type="button" disabled={busy} onClick={() => openDialog('group')}><Icon name="folder" size={16} /><span>移至新分组</span></button>
    <button role="menuitem" type="button" disabled={busy} onClick={() => void run(() => updateBotMetadata(bot.id, { sidebar: { unread: !bot.sidebar?.unread } }))}><Icon name="unread" size={16} /><span>{bot.sidebar?.unread ? '标为已读' : '标为未读'}</span></button>
    <div role="separator" />
    <button role="menuitem" type="button" disabled={busy} onClick={() => openDialog('rename')}><Icon name="edit" size={16} /><span>重命名 Bot</span></button>
    <div role="separator" />
    <button role="menuitem" type="button" disabled={busy} onClick={() => void run(async () => { await moyu().copyConversationId(bot.id); toast('已复制对话 ID'); })}><Icon name="copy" size={16} /><span>复制对话 ID</span></button>
    <div role="separator" />
    <button role="menuitem" type="button" disabled={busy} onClick={() => void run(() => updateBotMetadata(bot.id, { sidebar: { hidden: !bot.sidebar?.hidden, pinned: false } }))}><Icon name="hide" size={16} /><span>{bot.sidebar?.hidden ? '取消隐藏' : '从侧边栏隐藏'}</span></button>
    <button role="menuitem" type="button" className="is-danger" disabled={busy || runningBotIds.has(bot.id)} title={runningBotIds.has(bot.id) ? '请先停止任务，再删除 Bot' : undefined} onClick={() => openDialog('delete')}><Icon name="trash" size={16} /><span>删除</span></button>
  </div>, document.body);
}
