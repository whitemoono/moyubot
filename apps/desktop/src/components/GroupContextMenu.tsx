import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMoyu } from '../state';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { Button, Sheet } from './Glass';
import { Icon } from './Icon';

function GroupActionDialog({ name, action, onClose }: { name: string; action: 'rename' | 'delete'; onClose: () => void }) {
  const { updateBotGroup, toast } = useMoyu();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = () => { if (!busy) onClose(); };
  const stableClose = useRef(() => closeRef.current()).current;
  useDialogFocus(ref, stableClose);
  const submit = async () => {
    if (busy || (action === 'rename' && !value.trim())) return;
    setBusy(true);
    try { await updateBotGroup(name, action === 'rename' ? { type: 'rename', name: value } : { type: 'delete' }); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); setBusy(false); }
  };
  return createPortal(<div ref={ref}><Sheet open title={action === 'rename' ? '重命名分组' : `删除分组「${name}」？`} className="sheet--group-action sheet--bot-action" onClose={stableClose} footer={<><span className="spacer" /><Button variant="ghost" disabled={busy} onClick={stableClose}>取消</Button><Button variant={action === 'delete' ? 'danger' : 'primary'} loading={busy} disabled={busy || (action === 'rename' && !value.trim())} onClick={() => void submit()}>{action === 'delete' ? '删除' : '保存'}</Button></>}>
    {action === 'rename' ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><label className="field"><span className="field__label">分组名称</span><input className="input" aria-label="分组名称" value={value} maxLength={60} disabled={busy} onChange={(event) => setValue(event.target.value)} /></label></form> : <p className="bot-action-hint">分组内的 Bot 会回到「未分组」，对话和记忆保留。</p>}
  </Sheet></div>, document.body);
}

export function GroupContextMenu({ name, x, y, onClose }: { name: string; x: number; y: number; onClose: () => void }) {
  const { settings, updateBotGroup, toast } = useMoyu();
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);
  const namedGroups = settings.ui.botGroups ?? [];
  const groups = [...namedGroups];
  if (namedGroups.length && settings.bots.some((bot) => !bot.sidebar?.group && !bot.sidebar?.hidden && !bot.sidebar?.pinned)) groups.splice(Math.max(0, Math.min(namedGroups.length, settings.ui.ungroupedGroupIndex ?? namedGroups.length)), 0, { name: '' });
  const index = groups.findIndex((item) => item.name === name);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu) setPosition({ left: Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)), top: Math.max(40, Math.min(y, innerHeight - menu.offsetHeight - 8)) });
  }, [x, y]);
  useEffect(() => {
    if (dialog) return;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    const wheel = (event: WheelEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('wheel', wheel); };
  }, [dialog, onClose]);
  const move = async (direction: 'up' | 'down') => {
    if (busy) return;
    setBusy(true);
    try { await updateBotGroup(name, { type: 'move', direction }); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); setBusy(false); }
  };
  if (dialog) return <GroupActionDialog name={name} action={dialog} onClose={onClose} />;
  return createPortal(<div ref={ref} className="bot-context-menu group-context-menu" role="menu" aria-label={`${name || '未分组'} 分组菜单`} style={position} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); document.querySelector<HTMLElement>(`[data-bot-group="${CSS.escape(name)}"] .messenger-group__name[aria-haspopup="menu"]`)?.focus(); }
      onClose();
    }
  }}>
    {name ? <button role="menuitem" type="button" disabled={busy} onClick={() => setDialog('rename')}><Icon name="edit" size={16} /><span>重命名</span></button> : null}
    <button role="menuitem" type="button" disabled={busy || index <= 0} onClick={() => void move('up')}><Icon name="arrowUp" size={16} /><span>上移</span></button>
    <button role="menuitem" type="button" disabled={busy || index < 0 || index === groups.length - 1} onClick={() => void move('down')}><Icon name="arrowUp" size={16} className="group-menu-down" /><span>下移</span></button>
    {name ? <><div role="separator" /><button role="menuitem" type="button" disabled={busy} className="is-danger" onClick={() => setDialog('delete')}><Icon name="trash" size={16} /><span>删除</span></button></> : null}
  </div>, document.body);
}
