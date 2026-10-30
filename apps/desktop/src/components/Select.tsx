import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface SelectOption { value: string; label: string; hint?: string }

/** Shared keyboard-accessible picker; editable mode also accepts unlisted model IDs. */
export function Select({ value, options, onChange, label, placeholder = '请选择', allowCustom = false, disabled = false, className = '', menuMinWidth = 0, align = 'start', icon, iconOnly = false }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
  label: string; placeholder?: string; allowCustom?: boolean; disabled?: boolean;
  className?: string; menuMinWidth?: number; align?: 'start' | 'end'; icon?: IconName; iconOnly?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const filtered = options.filter((item) => `${item.label} ${item.value}`.toLowerCase().includes(filter.toLowerCase()));
  const choose = (next: string) => { onChange(next); setOpen(false); setFilter(''); };
  const show = () => { setFilter(''); setActive(Math.max(0, options.findIndex((item) => item.value === value))); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 12;
      const height = Math.min(248, Math.max(80, filtered.length * 38 + 12));
      const above = below < height && rect.top > below;
      const available = above ? rect.top - 12 : below;
      const width = Math.min(innerWidth - 16, Math.max(rect.width, menuMinWidth));
      const left = align === 'end' ? rect.right - width : rect.left;
      setPosition({ left: Math.max(8, Math.min(left, innerWidth - width - 8)), top: above ? rect.top - Math.min(height, available) - 5 : rect.bottom + 5, width, maxHeight: Math.min(248, available) });
    };
    place();
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false); };
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) place(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true); };
  }, [open, filtered.length, menuMinWidth, align]);
  useEffect(() => { if (open) popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  const selected = options.find((item) => item.value === value);
  const common = {
    role: 'combobox', 'aria-label': label, 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    'aria-activedescendant': open && filtered[active] ? `${id}-${active}` : undefined, disabled,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) show();
        else setActive((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      } else if (event.key === 'Enter' && open) { event.preventDefault(); if (filtered[active]) choose(filtered[active].value); else setOpen(false); }
      else if (open && !allowCustom && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : filtered.length - 1); }
      else if (event.key === 'Tab') setOpen(false);
    },
    onBlur: () => setOpen(false),
  };
  return <div className={`picker ${allowCustom ? 'picker--editable' : ''} ${className}`.trim()} ref={anchor} data-select-open={open}>
    {allowCustom ? <><input {...common} aria-autocomplete="list" className="input" value={value} placeholder={placeholder} onChange={(event) => { onChange(event.target.value); setFilter(event.target.value); setActive(0); setOpen(true); }} onClick={() => { if (!open) show(); }} /><button type="button" tabIndex={-1} disabled={disabled} aria-label={`展开${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { anchor.current?.querySelector('input')?.focus(); if (open) setOpen(false); else show(); }}><Icon name="chevron" size={13} /></button></>
      : <button type="button" {...common} className="picker__trigger" title={iconOnly ? `${label}：${selected?.label || value}` : `${selected?.label || value}${selected?.hint ? `（${selected.hint}）` : ''}`} onClick={() => open ? setOpen(false) : show()}>{icon ? <Icon name={icon} size={16} /> : null}{!iconOnly ? <><span>{selected?.label || value || placeholder}</span><Icon name="chevron" size={13} /></> : null}</button>}
    {open ? createPortal(<div ref={popup} id={id} role="listbox" aria-label={`${label}选项`} className="picker-menu" style={position} onMouseDown={(event) => event.preventDefault()}>
      {filtered.length ? filtered.map((item, index) => <div role="option" id={`${id}-${index}`} key={item.value} aria-selected={active === index} className={value === item.value ? 'is-current' : ''} onPointerMove={() => setActive(index)} onClick={() => choose(item.value)}><span><strong>{item.label}</strong>{item.hint ? <small>{item.hint}</small> : null}</span>{item.value === value ? <Icon name="check" size={14} /> : null}</div>) : <p>{allowCustom ? '使用输入的模型名称' : '暂无选项'}</p>}
    </div>, document.body) : null}
  </div>;
}
