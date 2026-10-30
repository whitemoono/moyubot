import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Bot, ReasoningEffort } from '@moyu/core';
import { useMoyu } from '../state';
import { Icon } from './Icon';

const LEVELS: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: 'low', label: '低', description: '快速响应' },
  { value: 'medium', label: '中', description: '平衡速度与深度' },
  { value: 'high', label: '高', description: '更深入的推理' },
];
const indexOf = (value: ReasoningEffort) => Math.max(0, LEVELS.findIndex((level) => level.value === value));

/**
 * 推理强度弹层：外观与交互复刻给定的 reasoning-card 设计。
 * 按钮放在模型选择器旁；拖拽/键盘/点击选择，松手时持久化到 Bot。
 */
export function EffortPicker({ bot, disabled }: { bot: Bot; disabled?: boolean }) {
  const { saveBot, settings, toast } = useMoyu();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const provider = settings.providers.find((item) => item.id === bot.providerId);
  const control = provider?.modelSettings?.[bot.model]?.reasoningControl ?? 'default';
  const inherited = provider?.modelSettings?.[bot.model]?.reasoningEffort ?? 'medium';
  const effective: ReasoningEffort = bot.generation?.reasoningEffort ?? inherited;
  const [index, setIndex] = useState(() => indexOf(effective));
  const indexRef = useRef(index);
  useEffect(() => { indexRef.current = index; }, [index]);

  useEffect(() => { setIndex(indexOf(effective)); }, [effective]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // OpenAI-compatible relays accept reasoning_effort; also honour an explicit model setting.
  if (provider?.kind !== 'openai' && control !== 'openai-effort') return null;

  const commit = async (next: ReasoningEffort) => {
    if (saving || next === bot.generation?.reasoningEffort) return;
    setSaving(true);
    try { await saveBot({ ...bot, generation: { ...bot.generation, reasoningEffort: next } }, { stayInSettings: true }); }
    catch (error) { toast((error as Error).message, 'error'); setIndex(indexOf(effective)); }
    finally { setSaving(false); }
  };

  const pick = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const usable = Math.max(1, rect.width - 24);
    const ratio = (clientX - rect.left - 12) / usable;
    setIndex(Math.round(Math.max(0, Math.min(1, ratio)) * 2));
  };
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    pick(event.currentTarget, event.clientX);
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (dragging.current) pick(event.currentTarget, event.clientX); };
  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    void commit(LEVELS[indexRef.current]!.value);
  };

  const level = LEVELS[index]!;
  const ratio = index / 2;
  // Thumb centre runs 12px..width-12px, so at the high stop the knob's right edge sits
  // exactly on the track's right edge; the blue fill reaches the knob's right edge (the
  // knob paints on top), so no grey track peeks out beside the active side.
  const offsetFor = (value: number) => `calc(12px + (100% - 24px) * ${value})`;
  const fillFor = (value: number) => `calc(24px + (100% - 24px) * ${value})`;
  const offset = offsetFor(ratio);

  return (
    <div className="effort-picker" ref={rootRef}>
      <button
        type="button"
        className="effort-picker__trigger"
        disabled={disabled || saving}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`推理强度：${level.label}（${level.description}）`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="spark" size={12} />
        <span className="effort-picker__prefix">思考 </span>
        <span>{level.label}</span>
      </button>
      {open ? (
        <section className="reasoning-card" role="dialog" aria-label="推理强度设置">
          <div className="reasoning-current">
            <div className="reasoning-name">{level.label}</div>
            <div className="reasoning-desc">{level.description}<span className="reasoning-chevron">›</span></div>
          </div>
          <div
            className="reasoning-slider"
            role="slider"
            tabIndex={0}
            aria-label="推理强度"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={index}
            aria-valuetext={level.label}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => { dragging.current = false; }}
            onKeyDown={(event) => {
              const set = (next: number) => { setIndex(next); void commit(LEVELS[next]!.value); };
              if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); set(Math.min(2, index + 1)); }
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); set(Math.max(0, index - 1)); }
              else if (event.key === 'Home') { event.preventDefault(); set(0); }
              else if (event.key === 'End') { event.preventDefault(); set(2); }
            }}
          >
            <div className="reasoning-fill" style={{ width: fillFor(ratio) }} />
            <div className="reasoning-markers" aria-hidden="true">
              {[0, 0.5, 1].map((ratioAt, item) => <span key={item} className={`reasoning-marker ${item <= index ? 'is-active' : ''}`} style={{ left: offsetFor(ratioAt) }} />)}
            </div>
            <div className="reasoning-thumb" style={{ left: offset }} />
          </div>
          <div className="reasoning-choices" aria-hidden="true">{LEVELS.map((item) => <span key={item.value}>{item.label}</span>)}</div>
        </section>
      ) : null}
    </div>
  );
}
