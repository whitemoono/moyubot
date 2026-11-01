/**
 * Interactive PTY manager for the terminal UI.
 *
 * Two backends:
 *  - local  : node-pty spawning PowerShell (Windows) / the login shell, a real
 *             console with prompt, cwd state, colors.
 *  - cloud   : forwards to CloudHost.openCloudPty (E2B sandbox PTY).
 *
 * Sessions are keyed by an id the renderer generates. Output is streamed to the
 * window over the `moyu:pty:data` channel; the renderer sends input/resize/close
 * via IPC handlers wired in app.ts.
 */
import os from 'node:os';
import type { CloudHost } from '@moyu/core';

interface PtyLike {
  write(data: string): void | Promise<void>;
  resize(cols: number, rows: number): void;
  close(): void | Promise<void>;
}

interface LocalPty {
  kind: 'local';
  proc: import('node-pty').IPty;
}
interface CloudPty {
  kind: 'cloud';
  session: { pid: number; write(d: string): Promise<void>; resize(c: number, r: number): void; close(): Promise<void> };
}
type Session = (LocalPty | CloudPty) & { dispose: () => void };

export class PtyManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly cloud: () => CloudHost,
    private readonly emit: (id: string, data: string) => void,
    private readonly emitExit: (id: string, exitCode: number) => void,
  ) {}

  /** Open a PTY. `kind` selects the backend. Returns the session id. */
  async open(id: string, kind: 'local' | 'cloud', cols: number, rows: number): Promise<{ pid: number }> {
    if (this.sessions.has(id)) await this.close(id);
    if (kind === 'local') return this.openLocal(id, cols, rows);
    return this.openCloud(id, cols, rows);
  }

  private async openLocal(id: string, cols: number, rows: number): Promise<{ pid: number }> {
    // Lazy require so the native module only loads in the Electron main process.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pty = require('node-pty') as typeof import('node-pty');
    const shell = process.platform === 'win32'
      ? (process.env.COMSPEC && /pwsh|powershell/i.test(process.env.COMSPEC) ? process.env.COMSPEC : 'powershell.exe')
      : (process.env.SHELL || '/bin/bash');
    const args = process.platform === 'win32' ? ['-NoLogo'] : [];
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols | 0),
      rows: Math.max(2, rows | 0),
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });
    proc.onData((data) => this.emit(id, data));
    proc.onExit(({ exitCode }) => { this.sessions.delete(id); this.emitExit(id, exitCode); });
    this.sessions.set(id, {
      kind: 'local',
      proc,
      dispose: () => { try { proc.kill(); } catch { /* gone */ } },
    });
    return { pid: proc.pid };
  }

  private async openCloud(id: string, cols: number, rows: number): Promise<{ pid: number }> {
    const host = this.cloud();
    const session = await host.openCloudPty(cols, rows, (data) => this.emit(id, data));
    this.sessions.set(id, {
      kind: 'cloud',
      session,
      dispose: () => { void session.close().catch(() => {}); },
    });
    return { pid: session.pid };
  }

  async input(id: string, data: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.kind === 'local') s.proc.write(data);
    else await s.session.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.kind === 'local') { try { s.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)); } catch { /* ignore */ } }
    else s.session.resize(cols, rows);
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    try { await s.dispose(); } catch { /* ignore */ }
  }

  dispose(): void {
    for (const [id, s] of this.sessions) { try { void s.dispose(); } catch { /* ignore */ } this.sessions.delete(id); }
  }
}
