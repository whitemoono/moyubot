import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Bot } from '@moyu/core';

interface PinTransition {
  id: string;
  pinned: boolean;
  rect: DOMRect;
  clone: HTMLElement;
  padding: string;
  rows: Map<string, DOMRect>;
}

/** Keep the moving card above both layouts while the remaining rows settle into place. */
export function useSidebarMotion(root: RefObject<HTMLElement | null>, bots: Bot[], reduceMotion: boolean) {
  const pending = useRef<PinTransition | null>(null);
  const animations = useRef(new Set<Animation>());
  const ghosts = useRef(new Set<HTMLElement>());
  const reduced = useCallback(() => reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches, [reduceMotion]);
  const cancel = useCallback(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    ghosts.current.forEach((ghost) => ghost.remove());
    ghosts.current.clear();
  }, []);
  const capture = useCallback((id: string, pinned: boolean) => {
    cancel();
    pending.current = null;
    if (reduced()) return;
    const source = root.current?.querySelector<HTMLElement>(`[data-bot-id="${CSS.escape(id)}"]`);
    if (!source) return;
    const rows = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>('[data-bot-id]').forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.height && rect.width) rows.set(row.dataset.botId!, rect);
    });
    pending.current = { id, pinned, rect: source.getBoundingClientRect(), clone: source.cloneNode(true) as HTMLElement, padding: getComputedStyle(source).padding, rows };
  }, [cancel, reduced, root]);

  useLayoutEffect(() => {
    const move = pending.current;
    if (!move || bots.find((item) => item.id === move.id)?.sidebar?.pinned !== move.pinned) return;
    pending.current = null;
    if (reduced()) return;
    const target = root.current?.querySelector<HTMLElement>(`[data-bot-id="${CSS.escape(move.id)}"]`);
    if (!target) return;
    const play = (element: Element, frames: Keyframe[], duration = 680, easing = 'cubic-bezier(.22, 1, .36, 1)') => {
      const animation = element.animate(frames, { duration, easing });
      animations.current.add(animation);
      animation.finished.then(() => animations.current.delete(animation), () => animations.current.delete(animation));
      return animation;
    };
    root.current?.querySelectorAll<HTMLElement>('[data-bot-id]').forEach((row) => {
      if (row === target) return;
      const before = move.rows.get(row.dataset.botId!);
      if (!before) return;
      const after = row.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      play(row, [
        { transform: `translate(${dx}px, ${dy}px) scale(1)` },
        { transform: `translate(0, ${-dy * .05}px) scale(1.025, .96)`, offset: .7 },
        { transform: 'translate(0, 2px) scale(.99, 1.015)', offset: .87 },
        { transform: 'translate(0, 0) scale(1)' },
      ]);
    });
    const list = root.current?.querySelector('.messenger-bots');
    if (list) play(list, [{ transform: 'scale(1)' }, { transform: 'scale(.985, 1.025)', offset: .3 }, { transform: 'scale(1.012, .985)', offset: .65 }, { transform: 'scale(1)' }]);

    if (!move.pinned) {
      play(target, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1.03, .97)', offset: .65 }, { transform: 'scale(1)' }]);
      return;
    }
    const destination = (target.querySelector('.bot-avatar') ?? target).getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'sidebar--messenger bot-pin-flight';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    const card = move.clone;
    card.removeAttribute('data-bot-id');
    card.removeAttribute('aria-current');
    card.tabIndex = -1;
    Object.assign(card.style, { width: '100%', height: '100%', minHeight: '0', margin: '0', padding: '0', borderRadius: 'inherit' });
    Object.assign(ghost.style, { left: `${move.rect.left}px`, top: `${move.rect.top}px`, width: `${move.rect.width}px`, height: `${move.rect.height}px`, padding: move.padding });
    ghost.append(card);
    document.body.append(ghost);
    ghosts.current.add(ghost);
    const text = card.querySelector('.messenger-bot__text');
    if (text) { (text as HTMLElement).style.opacity = '0'; play(text, [{ opacity: 1 }, { opacity: 0 }], 140); }
    const flight = play(ghost, [
      { left: `${move.rect.left}px`, top: `${move.rect.top}px`, width: `${move.rect.width}px`, height: `${move.rect.height}px`, padding: move.padding, borderRadius: '13px', transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.04, .9)', offset: .16 },
      { left: `${destination.left - 3}px`, top: `${destination.top + 3}px`, width: `${destination.width + 6}px`, height: `${destination.height - 4}px`, padding: '0px', borderRadius: '24px', transform: 'scale(1.12, .87)', opacity: 1, offset: .7 },
      { transform: 'scale(.93, 1.1)', offset: .86 },
      { left: `${destination.left}px`, top: `${destination.top}px`, width: `${destination.width}px`, height: `${destination.height}px`, padding: '0px', borderRadius: '24px', transform: 'scale(1)', opacity: 0 },
    ], 680, 'linear');
    const removeGhost = () => { ghost.remove(); ghosts.current.delete(ghost); };
    flight.finished.then(removeGhost, removeGhost);
    play(target, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 0, offset: .62 }, { opacity: 1, transform: 'scale(1.08, .94)', offset: .84 }, { opacity: 1, transform: 'scale(1)' }], 680, 'linear');
  }, [bots, reduced, root]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (reduceMotion || media.matches) { pending.current = null; cancel(); } };
    stop();
    media.addEventListener('change', stop);
    return () => { media.removeEventListener('change', stop); cancel(); };
  }, [reduceMotion, cancel]);

  return { capture, discard: () => { pending.current = null; } };
}
