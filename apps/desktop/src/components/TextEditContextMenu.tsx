import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { moyu } from '../lib/bridge';

export interface TextEditMenuState {
  x: number;
  y: number;
}

/**
 * 输入框右键编辑菜单：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选。
 * 复用 .bot-context-menu 样式；命令通过 document.execCommand 作用于目标 textarea。
 */
export function TextEditContextMenu({ x, y, onClose, targetRef }: {
  x: number;
  y: number;
  onClose: () => void;
  targetRef: { current: HTMLTextAreaElement | null };
}) {
  const [position, setPosition] = useState({ left: x, top: y });
  const menuRef = useRef<HTMLDivElement>(null);
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu) {
      setPosition({
        left: Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)),
        top: Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)),
      });
    }
  }, [x, y]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const refresh = () => {
      const ta = targetRef.current;
      setUndoable(!!document.queryCommandEnabled?.('undo'));
      setRedoable(!!document.queryCommandEnabled?.('redo'));
      setHasSelection(!!ta && ta.selectionStart !== null && ta.selectionEnd !== null && ta.selectionStart !== ta.selectionEnd);
    };
    refresh();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('wheel', scroll, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', scroll);
    };
  }, [onClose, targetRef]);

  const run = (command: string) => {
    const ta = targetRef.current;
    if (ta) ta.focus();
    document.execCommand(command);
    onClose();
  };

  /** 把文本插入 textarea 光标处，并通过原生 input 事件驱动 React 受控组件更新。 */
  const insertText = (ta: HTMLTextAreaElement, text: string) => {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const next = ta.value.slice(0, start) + text + ta.value.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(ta, next);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** execCommand('paste') 会被 Chromium 剪切板权限拦截，走主进程 clipboard 模块读取系统剪贴板。 */
  const paste = async () => {
    const ta = targetRef.current;
    if (ta) ta.focus();
    try {
      const text = await moyu().readClipboardText();
      if (text && ta) insertText(ta, text);
      else document.execCommand('paste'); // 兜底（图片等非文本内容）
    } catch {
      document.execCommand('paste');
    }
    onClose();
  };

  const selectAll = () => {
    const ta = targetRef.current;
    if (ta) { ta.focus(); ta.select(); }
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="bot-context-menu text-context-menu"
      role="menu"
      aria-label="文本编辑菜单"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <button role="menuitem" type="button" disabled={!undoable} onClick={() => run('undo')}><Icon name="undo" size={16} /><span>撤销</span></button>
      <button role="menuitem" type="button" disabled={!redoable} onClick={() => run('redo')}><Icon name="redo" size={16} /><span>重做</span></button>
      <div role="separator" />
      <button role="menuitem" type="button" disabled={!hasSelection} onClick={() => run('cut')}><Icon name="cut" size={16} /><span>剪切</span></button>
      <button role="menuitem" type="button" disabled={!hasSelection} onClick={() => run('copy')}><Icon name="copy" size={16} /><span>复制</span></button>
      <button role="menuitem" type="button" onClick={() => void paste()}><Icon name="paste" size={16} /><span>粘贴</span></button>
      <div role="separator" />
      <button role="menuitem" type="button" onClick={selectAll}><Icon name="select-all" size={16} /><span>全选</span></button>
    </div>,
    document.body,
  );
}
