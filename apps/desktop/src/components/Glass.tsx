import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { useDialogFocus } from '../lib/use-dialog-focus';

type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

export function Panel({ className = '', children, ...rest }: DivProps) {
  return (
    <div className={`glass ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'glass' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  loading?: boolean;
}

export function Button({ variant = 'glass', size = 'md', icon, loading, className = '', children, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${className}`.trim()} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  name,
  label,
  active,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { name: IconName; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={name} size={18} />
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch ${disabled ? 'is-disabled' : ''}`.trim()}>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint ? <span className="switch__hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch__track ${checked ? 'is-on' : ''}`.trim()}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  className = '',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose, open);

  if (!open) return null;
  return (
    createPortal(<div ref={dialog} className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <div className={`sheet glass ${wide ? 'sheet--wide' : ''} ${className}`.trim()} onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton name="close" label="关闭" onClick={onClose} />
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </div>, document.querySelector('.app') ?? document.body)
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function useAutoScroll<T extends HTMLElement>(conversationId?: string) {
  const ref = useRef<T | null>(null);
  const stickRef = useRef(true);

  const follow = () => {
    const node = ref.current;
    if (node && stickRef.current) node.scrollTo({ top: node.scrollHeight, behavior: 'instant' });
  };

  // The loading placeholder swaps in a new scroll container, so listeners and
  // observers are rebuilt per conversation and the new chat opens at its bottom.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    stickRef.current = true;
    follow();
    const onScroll = () => {
      stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    // Images, tool cards and the composer change height after the first layout.
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => { node.removeEventListener('scroll', onScroll); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Streaming text grows the last message between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(follow);

  return ref;
}
