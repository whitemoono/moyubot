/**
 * E2B cloud sandbox client wrapper.
 *
 * One implementation covers BOTH modes, because E2B's SDK talks to the
 * official cloud and to a self-hosted deployment through the exact same
 * protocol — only the connection options differ:
 *
 *   - Official cloud : omit `apiUrl` / `domain`  → defaults to api.e2b.app
 *   - Self-hosted    : pass your server's `apiUrl` and `domain`
 *
 * Docs: https://e2b.dev/docs  ·  Self-hosting: https://github.com/e2b-dev/infra
 *
 * This module deliberately keeps the *shape* of the InstaBox client so the
 * higher-level CloudHost orchestrator can treat either backend identically.
 */
import { Sandbox } from 'e2b';
import { Sandbox as DesktopSandbox } from '@e2b/desktop';
import type { InstaBoxMachineState } from './types';
import type { ExecRequest, ExecResult, MachineSummary, OperationSummary, DesktopStatus, DesktopStream } from './instabox';
import { newId } from './util';

export interface E2BConnectOptions {
  apiKey: string;
  /** API base URL. Empty → official cloud. For self-hosted use e.g. https://api.yourdomain.com */
  apiUrl?: string;
  /** Sandbox ingress domain. Empty → official cloud. For self-hosted use e.g. yourdomain.com */
  domain?: string;
}

/** A live pseudo-terminal attached to a sandbox process. */
export interface PtySession {
  readonly pid: number;
  /** Send user keystrokes / pasted text into the PTY. */
  write(data: string): Promise<void>;
  /** Notify the remote PTY of a new window size. Most backends are best-effort. */
  resize(cols: number, rows: number): void;
  /** Ask the application to redraw (used on xterm resize). Optional. */
  close(): Promise<void>;
}

function cleanOpts(opts: E2BConnectOptions): { apiKey: string; apiUrl?: string; domain?: string } {
  const out: { apiKey: string; apiUrl?: string; domain?: string } = { apiKey: opts.apiKey };
  if (opts.apiUrl && opts.apiUrl.trim()) out.apiUrl = opts.apiUrl.trim();
  if (opts.domain && opts.domain.trim()) out.domain = opts.domain.trim();
  return out;
}

/** Map an E2B sandbox state string to the InstaBox state vocabulary CloudHost understands. */
function mapState(state: string | undefined): InstaBoxMachineState {
  switch (state) {
    case 'running':
      return 'running';
    case 'paused':
    case 'suspended':
      return 'suspended';
    case 'stopped':
      return 'stopped';
    default:
      return 'running';
  }
}

export class E2BError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(input: { status?: number; code?: string; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'E2BError';
    this.status = input.status ?? 0;
    this.code = input.code ?? 'e2b_error';
    this.retryable = input.retryable ?? false;
  }
}

export class E2BClient {
  readonly apiUrl?: string;
  readonly domain?: string;
  private readonly apiKey: string;
  /** Cache of live desktop sandbox instances, keyed by sandbox id. */
  private readonly desktopCache = new Map<string, DesktopSandbox>();

  constructor(opts: E2BConnectOptions) {
    this.apiKey = opts.apiKey;
    this.apiUrl = opts.apiUrl?.trim() || undefined;
    this.domain = opts.domain?.trim() || undefined;
  }

  hasKey(): boolean {
    return this.apiKey.trim().length > 0;
  }

  private conn() {
    return cleanOpts({ apiKey: this.apiKey, apiUrl: this.apiUrl, domain: this.domain });
  }

  private static isDesktopTemplate(templateId?: string): boolean {
    return !templateId || /desktop|computer/i.test(templateId);
  }

  /** Attach to an existing, running sandbox. */
  async connect(sandboxId: string): Promise<Sandbox> {
    try {
      return await Sandbox.connect(sandboxId, this.conn());
    } catch (error) {
      throw this.wrap(error, 'connect');
    }
  }

  async listMachines(): Promise<MachineSummary[]> {
    try {
      const out: MachineSummary[] = [];
      const paginator = Sandbox.list(this.conn());
      while (paginator.hasNext) {
        const page = await paginator.nextItems();
        for (const item of page) {
          const info = item as unknown as { sandboxId?: string; sandboxID?: string; name?: string; alias?: string; state?: string; templateId?: string; templateID?: string; startedAt?: Date; cpuCount?: number; memoryMB?: number; metadata?: Record<string, string> };
          const sid = info.sandboxId ?? info.sandboxID ?? '';
          out.push({
            id: sid,
            name: info.metadata?.name || info.name || info.alias || sid,
            state: mapState(info.state),
            autoSuspendAfterSeconds: null,
            template: { id: info.templateId ?? info.templateID },
            updatedAt: info.startedAt?.toISOString?.() ?? undefined,
            createdAt: info.startedAt?.toISOString?.() ?? undefined,
            spec: { vcpus: info.cpuCount, memMiB: info.memoryMB },
          });
        }
      }
      return out;
    } catch (error) {
      throw this.wrap(error, 'list');
    }
  }

  async getMachine(id: string): Promise<MachineSummary> {
    try {
      const info = await Sandbox.getInfo(id, this.conn());
      return {
        id: info.sandboxId,
        name: info.metadata?.name || info.name || info.sandboxId,
        state: mapState(info.state),
        autoSuspendAfterSeconds: null,
        template: { id: info.templateId },
        updatedAt: info.startedAt?.toISOString?.(),
        createdAt: info.startedAt?.toISOString?.(),
        spec: { vcpus: info.cpuCount, memMiB: info.memoryMB },
      };
    } catch (error) {
      throw this.wrap(error, 'get');
    }
  }

  async createMachine(body: { templateId?: string; metadata?: Record<string, string>; timeoutMs?: number }): Promise<{ machine: MachineSummary; operationId?: string }> {
    const desktop = E2BClient.isDesktopTemplate(body.templateId);
    // noVNC / dev servers are opened by a human in a browser, which cannot send the
    // e2b-traffic-access-token header — so public sandbox URLs must not require it.
    const network = { allowPublicTraffic: true };
    try {
      if (desktop) {
        // Desktop templates need @e2b/desktop's create(), which also starts Xvfb+Xfce.
        const sbx = await DesktopSandbox.create(body.templateId || 'desktop', {
          metadata: body.metadata,
          timeoutMs: body.timeoutMs,
          network,
          ...this.conn(),
        } as Parameters<typeof DesktopSandbox.create>[1]);
        this.desktopCache.set(sbx.sandboxId, sbx);
        return {
          machine: {
            id: sbx.sandboxId,
            name: body.metadata?.name || sbx.sandboxId,
            state: 'running',
            autoSuspendAfterSeconds: null,
            template: { id: body.templateId || 'desktop' },
            updatedAt: new Date().toISOString(),
          },
        };
      }
      const sandbox = await Sandbox.create({
        template: body.templateId || undefined,
        metadata: body.metadata,
        timeoutMs: body.timeoutMs,
        network,
        ...this.conn(),
      });
      return {
        machine: {
          id: sandbox.sandboxId,
          name: body.metadata?.name || sandbox.sandboxId,
          state: 'running',
          autoSuspendAfterSeconds: null,
          template: { id: body.templateId },
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw this.wrap(error, 'create');
    }
  }

  async pause(id: string): Promise<void> {
    try {
      await Sandbox.pause(id, this.conn());
    } catch (error) {
      throw this.wrap(error, 'pause');
    }
  }

  async kill(id: string): Promise<void> {
    this.desktopCache.delete(id);
    try {
      await Sandbox.kill(id, this.conn());
    } catch (error) {
      throw this.wrap(error, 'kill');
    }
  }

  async exec(id: string, req: ExecRequest, handlers?: { onStdout?: (c: string) => void; onStderr?: (c: string) => void }): Promise<ExecResult> {
    const sandbox = await this.connect(id);
    const cmd = req.cmd ?? (req.argv ?? []).join(' ');
    const timeoutMs = Math.max(1, Math.min(900, req.timeoutSeconds ?? 120)) * 1000;
    const started = Date.now();
    try {
      const result = await sandbox.commands.run(cmd, {
        cwd: req.cwd,
        envs: req.envs,
        timeoutMs,
        onStdout: handlers?.onStdout,
        onStderr: handlers?.onStderr,
      });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0,
        timedOut: false,
        truncated: false,
      };
    } catch (error) {
      // e2b throws CommandExitError on non-zero exit but carries the result.
      const anyErr = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof anyErr.exitCode === 'number') {
        return {
          stdout: anyErr.stdout ?? '',
          stderr: anyErr.stderr ?? anyErr.message ?? '',
          exitCode: anyErr.exitCode,
          timedOut: /timeout/i.test(anyErr.message ?? ''),
          truncated: false,
        };
      }
      // A timeout surfaces as a plain error after the deadline.
      return {
        stdout: '',
        stderr: anyErr.message ?? String(error),
        exitCode: 124,
        timedOut: Date.now() - started >= timeoutMs - 1000,
        truncated: false,
      };
    }
  }

  /**
   * Open an interactive PTY (a real shell session with prompt, cwd state, etc.)
   * inside the sandbox. Data flows out through `onData`; user input goes back via
   * the returned session's `write()`.
   */
  async openPty(
    id: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    opts?: { cwd?: string; envs?: Record<string, string> },
  ): Promise<PtySession> {
    const sandbox = await this.connect(id);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const handle = await sandbox.pty.create({
      cols: Math.max(2, cols | 0),
      rows: Math.max(2, rows | 0),
      cwd: opts?.cwd,
      envs: opts?.envs,
      onData: (data: Uint8Array) => { onData(decoder.decode(data, { stream: true })); },
      // Long-lived interactive sessions: keep the PTY open for a long window.
      timeoutMs: 60 * 60 * 1000,
    });
    const pid = handle.pid;
    // A PTY's CommandHandle does not accept sendStdin — input must go through
    // sandbox.pty.sendInput(pid, bytes), and resizing through sandbox.pty.resize.
    let inputChain: Promise<void> = Promise.resolve();
    return {
      pid,
      write: (data: string) => {
        // Serialize inputs so keystrokes keep their order.
        inputChain = inputChain.then(() => sandbox.pty.sendInput(pid, encoder.encode(data))).catch(() => {});
        return inputChain;
      },
      resize: (c: number, r: number) => { void sandbox.pty.resize(pid, { cols: Math.max(2, c | 0), rows: Math.max(2, r | 0) }).catch(() => {}); },
      close: async () => { try { await handle.kill(); } catch { /* already gone */ } },
    };
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    const sandbox = await this.connect(id);
    try {
      const content = await sandbox.files.read(path);
      // e2b returns a string for text files; encode to bytes for our interface.
      return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    } catch (error) {
      throw this.wrap(error, 'readFile');
    }
  }

  async writeFile(id: string, path: string, content: string | Uint8Array): Promise<void> {
    const sandbox = await this.connect(id);
    try {
      const data = typeof content === 'string' ? content : new Uint8Array(content);
      await sandbox.files.write(path, data as unknown as string);
    } catch (error) {
      throw this.wrap(error, 'writeFile');
    }
  }

  // ---- Desktop (computer-use) via @e2b/desktop -------------------------

  /**
   * Attach to a sandbox as a desktop sandbox. `@e2b/desktop` only starts the
   * Xvfb + Xfce session inside `create()`, not in `connect()`, so we detect and
   * (re)start it idempotently here. This keeps `connect` cheap when the session
   * is already up.
   */
  private async connectDesktop(sandboxId: string): Promise<DesktopSandbox> {
    const cached = this.desktopCache.get(sandboxId);
    if (cached) return cached;
    try {
      const sbx = await DesktopSandbox.connect(sandboxId, this.conn());
      // Ensure the X display is up; desktop templates usually already run the
      // start command, so only start when the display is genuinely missing.
      const probe = await sbx.commands.run('xdpyinfo -display :0 >/dev/null 2>&1 && echo up || echo down');
      if (!probe.stdout.includes('up')) {
        const start = (sbx as unknown as { _start: (d?: string) => Promise<void> })._start;
        if (typeof start === 'function') await start.call(sbx, ':0');
      }
      this.desktopCache.set(sandboxId, sbx);
      return sbx;
    } catch (error) {
      throw this.wrap(error, 'connectDesktop');
    }
  }

  async desktopStatus(id: string): Promise<DesktopStatus> {
    const sbx = await this.connectDesktop(id);
    try {
      try { await sbx.stream.start(); } catch (error) { if (!/already running/i.test((error as Error)?.message ?? '')) throw error; }
      return { installed: true, running: true };
    } catch {
      return { installed: true, running: false };
    }
  }

  async desktopStream(id: string, viewOnly: boolean): Promise<DesktopStream> {
    const sbx = await this.connectDesktop(id);
    try {
      // The VNC server may already be running (e.g. after a desktopStatus check);
      // starting it again throws "Stream is already running", which is harmless.
      try { await sbx.stream.start(); } catch (error) { if (!/already running/i.test((error as Error)?.message ?? '')) throw error; }
      let url: string;
      try {
        url = sbx.stream.getUrl({ autoConnect: true, viewOnly, resize: 'scale' });
      } catch {
        // When VNC was already running, start() short-circuits and never sets the
        // internal url, so getUrl() throws "Server is not running". Build it from
        // the sandbox host directly (noVNC listens on 6080).
        const host = (sbx as unknown as { getHost?: (port: number) => string }).getHost;
        if (typeof host !== 'function') throw new Error('无法获取桌面地址');
        const u = new URL(`https://${host.call(sbx, 6080)}/vnc.html`);
        u.searchParams.set('autoconnect', 'true');
        if (viewOnly) u.searchParams.set('view_only', 'true');
        u.searchParams.set('resize', 'scale');
        url = u.toString();
      }
      // e2b stream URLs are short-lived; expose a conservative 10-minute window.
      return { url, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    } catch (error) {
      throw this.wrap(error, 'desktopStream');
    }
  }

  /**
   * Native desktop action via @e2b/desktop, mapping the same action vocabulary
   * the InstaBox path uses. Returns a screenshot (Uint8Array) for the
   * 'screenshot' action; other actions just perform the input.
   */
  async desktopAction(id: string, args: Record<string, unknown>): Promise<{ text: string; screenshot?: Uint8Array }> {
    const sbx = await this.connectDesktop(id);
    try {
      const action = String(args.action ?? '');
      switch (action) {
        case 'open': {
          const url = new URL(String(args.url ?? ''));
          if (!['http:', 'https:'].includes(url.protocol)) throw new E2BError({ code: 'bad_url', message: '只支持 http/https 网页' });
          await sbx.open(url.href);
          break;
        }
        case 'click': {
          const x = Number(args.x), y = Number(args.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) throw new E2BError({ code: 'bad_coord', message: 'click 需要有效坐标' });
          if (args.double === true) await sbx.doubleClick(x, y);
          else if (String(args.button ?? 'left') === 'right') await sbx.rightClick(x, y);
          else await sbx.leftClick(x, y);
          break;
        }
        case 'type': {
          if (typeof args.text !== 'string' || args.text.length > 8000) throw new E2BError({ code: 'bad_text', message: '输入文本无效' });
          await sbx.write(args.text);
          break;
        }
        case 'press': {
          const keys = Array.isArray(args.keys) ? args.keys : [args.keys];
          if (!keys.length || keys.some((k) => typeof k !== 'string')) throw new E2BError({ code: 'bad_keys', message: '按键无效' });
          await sbx.press(keys as string[]);
          break;
        }
        case 'scroll': {
          const dir = String(args.direction ?? 'down') === 'up' ? 'up' : 'down';
          const amount = Number(args.amount ?? 3);
          await sbx.scroll(dir, Number.isFinite(amount) ? amount : 3);
          break;
        }
        case 'screenshot': {
          const shot = await sbx.screenshot();
          return { text: '当前桌面截图（坐标以图片左上角为原点）', screenshot: shot };
        }
        default:
          throw new E2BError({ code: 'bad_action', message: `不支持的桌面操作：${action}` });
      }
      return { text: `桌面操作已完成：${action}。操作后可再截图确认结果。` };
    } catch (error) {
      if (error instanceof E2BError) throw error;
      throw this.wrap(error, 'desktopAction');
    }
  }

  async desktopRevoke(id: string): Promise<void> {
    const sbx = await this.connectDesktop(id);
    try {
      await sbx.stream.stop();
    } catch {
      // best-effort: revoking a stream that never started is harmless.
    }
  }

  private wrap(error: unknown, op: string): E2BError {
    if (error instanceof E2BError) return error;
    const anyErr = error as { status?: number; message?: string; name?: string };
    return new E2BError({
      status: anyErr.status ?? 0,
      code: anyErr.name ?? `e2b_${op}_failed`,
      message: anyErr.message ?? `E2B ${op} 失败`,
      retryable: /timeout|network|ECONN|fetch failed/i.test(anyErr.message ?? ''),
    });
  }
}

/** Small helper: turn an E2BClient into the resolved OperationSummary shape. */
export function immediateOperation(id: string, machineId?: string): OperationSummary {
  return { id: id || newId('op'), state: 'succeeded', machineId };
}
