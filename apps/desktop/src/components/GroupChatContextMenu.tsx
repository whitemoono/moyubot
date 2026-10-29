import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMoyu } from '../state';
import type { ConversationSummary } from '../lib/bridge';
import { Button, Sheet } from './Glass';
import { Icon } from './Icon';
import { CreateGroupDialog } from './CreateGroupDialog';

export function GroupChatContextMenu({ group, index, count, x, y, onClose }: { group: ConversationSummary; index: number; count: number; x: number; y: number; onClose: () => void }) {
  const { updateGroupChat, runningGroupIds, toast } = useMoyu();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);
  const running = runningGroupIds.has(group.id);
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
  const run = async (action: Parameters<typeof updateGroupChat>[1]) => {
    if (busy) return;
    setBusy(true);
    try { await updateGroupChat(group.id, action); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  if (dialog === 'edit') return <CreateGroupDialog initial={group} onClose={onClose} />;
  if (dialog === 'delete') return <Sheet open title={`删除群聊「${group.title}」？`} className="sheet--group-chat-delete sheet--bot-action" onClose={close} footer={<><span className="spacer" /><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button variant="danger" loading={busy} disabled={busy || running} onClick={() => void run({ type: 'delete' })}>删除群聊</Button></>}><p className="bot-action-hint">群聊会从列表移除，历史记录保留在本机，群员 Bot、私聊和记忆不受影响。</p>{running ? <p role="status">请先停止群聊任务。</p> : null}</Sheet>;
  return createPortal(<div ref={ref} className="bot-context-menu group-chat-context-menu" role="menu" aria-label={`${group.title} 群聊菜单`} style={position} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); document.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(group.id)}"]`)?.focus(); }
      onClose();
    }
  }}>
    <button type="button" role="menuitem" disabled={busy || running} title={running ? '请先停止群聊任务' : undefined} onClick={() => setDialog('edit')}><Icon name="edit" size={16} /><span>编辑群聊</span></button>
    <button type="button" role="menuitem" disabled={busy || index <= 0} onClick={() => void run({ type: 'move', direction: 'up' })}><Icon name="arrowUp" size={16} /><span>上移</span></button>
    <button type="button" role="menuitem" disabled={busy || index < 0 || index >= count - 1} onClick={() => void run({ type: 'move', direction: 'down' })}><Icon name="arrowUp" size={16} className="group-menu-down" /><span>下移</span></button>
    <div role="separator" />
    <button type="button" role="menuitem" className="is-danger" disabled={busy || running} title={running ? '请先停止群聊任务' : undefined} onClick={() => setDialog('delete')}><Icon name="trash" size={16} /><span>删除群聊</span></button>
  </div>, document.body);
}
