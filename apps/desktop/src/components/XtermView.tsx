import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { moyu } from '../lib/bridge';

/**
 * A real interactive terminal backed by xterm.js.
 *
 * Backend is either a local shell (PowerShell) or a cloud PTY (E2B sandbox) —
 * selected by `kind`. Keystrokes are forwarded to the main process and terminal
 * output is streamed back over `moyu:pty:data`.
 */
export function XtermView({ kind, className = '', onReady }: { kind: 'local' | 'cloud'; className?: string; onReady?: (api: { fit: () => void }) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const idRef = useRef<string>('');
  const openedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const id = `pty_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    idRef.current = id;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0b0d12', foreground: '#e6e9ef', cursor: '#7aa2ff', selectionBackground: '#2a3550' },
      convertEol: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* host not laid out yet */ }

    let disposed = false;
    const offData = moyu().onPtyData(({ id: sid, data }) => { if (sid === id && !disposed) term.write(data); });
    const offExit = moyu().onPtyExit(({ id: sid, exitCode }) => {
      if (sid === id && !disposed) term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
    });

    term.onData((data) => { void moyu().ptyInput(id, data); });
    term.onBinary((data) => { void moyu().ptyInput(id, data); });

    (async () => {
      try {
        await moyu().ptyOpen(id, kind, term.cols, term.rows);
        openedRef.current = true;
      } catch (error) {
        term.write(`\r\n\x1b[31m无法启动终端：${(error as Error).message}\x1b[0m\r\n`);
      }
    })();

    onReady?.({ fit: () => { try { fit.fit(); } catch { /* ignore */ } } });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { return; }
      if (openedRef.current) void moyu().ptyResize(id, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      if (openedRef.current) void moyu().ptyClose(id);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return <div ref={hostRef} className={`xterm-host ${className}`.trim()} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
}
