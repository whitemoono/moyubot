import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';

export interface MessageSelectionMenuState {
  x: number;
  y: number;
  text: string;
}

/**
 * 消息气泡中选中文字后右键弹出的菜单，提供「复制」选项。
 * 复制走主进程 clipboard 模块（避免渲染层剪贴板权限拦截）。
 */
export function MessageContextMenu({ x, y, text, onClose }: { x: number; y: number; text: string; onClose: () => void }) {
  const { toast } = useMoyu();
  const [position, setPosition] = useState({ left: x, top: y });
  const menuRef = useRef<HTMLDivElement>(null);

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
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
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
  }, [onClose]);

  const copy = async () => {
    try {
      await moyu().writeClipboardText(text);
      toast('已复制');
    } catch (error) {
      toast((error as Error).message || '复制失败', 'error');
    }
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="bot-context-menu message-context-menu"
      role="menu"
      aria-label="选中文本菜单"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <button role="menuitem" type="button" onClick={() => void copy()}><Icon name="copy" size={16} /><span>复制</span></button>
    </div>,
    document.body,
  );
}
