import { InstaBoxClient, InstaBoxError } from './instabox';
import type { ExecRequest, ExecResult, MachineSummary, OperationSummary } from './instabox';
import { E2BClient, E2BError } from './e2b';
import type { PtySession } from './e2b';
import type { CloudHostSettings, CloudState, CloudStatus, InstaBoxMachineState } from './types';
import { newId, normalizeRemoteDirectory, shellQuote, sleep } from './util';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComputerControl } from './computer-control';
import type { DesktopStatus, DesktopStream } from './instabox';

export interface CloudDriver {
  readonly kind: 'instabox' | 'mock' | 'e2b';
  hasCredential(): boolean;
  listMachines(): Promise<MachineSummary[]>;
  getMachine(id: string): Promise<MachineSummary>;
  updateMachine(id: string, patch: Record<string, unknown>): Promise<MachineSummary>;
  createMachine(body: Record<string, unknown>): Promise<{ machine?: MachineSummary; operationId?: string }>;
  act(id: string, action: 'start' | 'stop' | 'suspend' | 'resume' | 'wake' | 'delete'): Promise<OperationSummary>;
  waitOperation(id: string, options?: { timeoutMs?: number; onPhase?: (phase: string) => void }): Promise<OperationSummary>;
  waitForState(
    id: string,
    accept: InstaBoxMachineState[],
    options?: { timeoutMs?: number; onState?: (machine: MachineSummary) => void },
  ): Promise<MachineSummary>;
  exec(
    id: string,
    req: ExecRequest,
    handlers?: { onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; signal?: AbortSignal },
  ): Promise<ExecResult>;
  writeFile(id: string, path: string, content: string | Uint8Array): Promise<void>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  desktopStart?(id: string): Promise<DesktopStatus>;
  desktopStream?(id: string, viewOnly: boolean): Promise<DesktopStream>;
  desktopRevoke?(id: string): Promise<void>;
  /** Open an interactive PTY shell in the sandbox (optional per backend). */
  openPty?(id: string, cols: number, rows: number, onData: (data: string) => void, opts?: { cwd?: string }): Promise<PtySession>;
}

export class InstaBoxDriver implements CloudDriver {
  readonly kind = 'instabox' as const;
  private readonly client: InstaBoxClient;

  constructor(apiKey: string, baseUrl: string) {
    this.client = new InstaBoxClient({ apiKey, baseUrl });
  }

  hasCredential(): boolean {
    return this.client.hasKey();
  }

  listMachines() {
    return this.client.listMachines();
  }

  getMachine(id: string) {
    return this.client.getMachine(id);
  }

  updateMachine(id: string, patch: Record<string, unknown>) {
    return this.client.updateMachine(id, patch);
  }

  createMachine(body: Record<string, unknown>) {
    return this.client.createMachine(body);
  }

  act(id: string, action: 'start' | 'stop' | 'suspend' | 'resume' | 'wake' | 'delete') {
    return this.client.act(id, action);
  }

  waitOperation(id: string, options?: { timeoutMs?: number; onPhase?: (phase: string) => void }) {
    return this.client.waitOperation(id, options);
  }

  waitForState(
    id: string,
    accept: InstaBoxMachineState[],
    options?: { timeoutMs?: number; onState?: (machine: MachineSummary) => void },
  ) {
    return this.client.waitForState(id, accept, options);
  }

  exec(id: string, req: ExecRequest, handlers?: Parameters<CloudDriver['exec']>[2]) {
    return this.client.exec(id, req, handlers);
  }

  writeFile(id: string, path: string, content: string | Uint8Array) {
    return this.client.writeFile(id, path, content);
  }

  readFile(id: string, path: string) {
    return this.client.readFile(id, path);
  }
  desktopStart(id: string) { return this.client.desktopStart(id); }
  desktopStream(id: string, viewOnly: boolean) { return this.client.desktopStream(id, viewOnly); }
  desktopRevoke(id: string) { return this.client.desktopRevoke(id); }
}

/**
 * E2B cloud sandbox driver. Works for the official cloud AND a self-hosted
 * deployment — the only difference is the `apiUrl` / `domain` in settings.
 *
 * E2B has no GUI desktop stream in its default self-hosted offering, so the
 * desktop* methods are intentionally omitted; a workspace that picks `e2b`
 * uses the self-hosted Webtop (or any noVNC endpoint) for the live desktop.
 */
export class E2BDriver implements CloudDriver {
  readonly kind = 'e2b' as const;
  private readonly client: E2BClient;

  constructor(apiKey: string, baseUrl?: string, domain?: string) {
    this.client = new E2BClient({ apiKey, apiUrl: baseUrl, domain });
  }

  hasCredential(): boolean {
    return this.client.hasKey();
  }

  listMachines() {
    return this.client.listMachines();
  }

  getMachine(id: string) {
    return this.client.getMachine(id);
  }

  async updateMachine(_id: string, _patch: Record<string, unknown>): Promise<MachineSummary> {
    // E2B has no per-machine auto-suspend knob via this API; CloudHost's own
    // idle timer still applies locally. Return current state unchanged.
    return this.getMachine(_id);
  }

  async createMachine(body: Record<string, unknown>): Promise<{ machine?: MachineSummary; operationId?: string }> {
    const created = await this.client.createMachine({
      templateId: typeof body.templateId === 'string' ? body.templateId : undefined,
      timeoutMs: typeof body.maxRunMinutes === 'number' ? body.maxRunMinutes * 60_000 : undefined,
      metadata: body.name ? { name: String(body.name) } : undefined,
    });
    return { machine: created.machine };
  }

  /**
   * E2B lifecycle:
   * - start/wake/resume → if paused, `connect` resumes it; if stopped/deleted we
   *   cannot revive it, so report a clear error via getMachine (CloudHost re-creates).
   * - suspend → pause()
   * - stop/delete → kill()
   */
  async act(id: string, action: 'start' | 'stop' | 'suspend' | 'resume' | 'wake' | 'delete'): Promise<OperationSummary> {
    try {
      if (action === 'suspend') {
        await this.client.pause(id);
      } else if (action === 'stop' || action === 'delete') {
        await this.client.kill(id);
      } else {
        // start/resume/wake: attach (resumes a paused sandbox).
        await this.client.connect(id);
      }
      return { id: `e2b_${action}_${id}`, state: 'succeeded', machineId: id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { id: `e2b_${action}_${id}`, state: 'failed', machineId: id, error: { code: 'e2b_act_failed', message } };
    }
  }

  async waitOperation(_id: string, _options?: { timeoutMs?: number; onPhase?: (phase: string) => void }): Promise<OperationSummary> {
    // E2B actions (pause/kill/connect) resolve synchronously above; nothing to poll.
    return { id: _id, state: 'succeeded' };
  }

  async waitForState(
    id: string,
    accept: InstaBoxMachineState[],
    options?: { timeoutMs?: number; onState?: (machine: MachineSummary) => void },
  ): Promise<MachineSummary> {
    const deadline = Date.now() + (options?.timeoutMs ?? 120_000);
    for (;;) {
      const machine = await this.getMachine(id);
      options?.onState?.(machine);
      if (accept.includes(machine.state)) return machine;
      if (Date.now() > deadline) throw new E2BError({ code: 'timeout', message: `E2B 状态等待超时（${machine.state}）` });
      await sleep(800);
    }
  }

  exec(id: string, req: ExecRequest, handlers?: Parameters<CloudDriver['exec']>[2]) {
    return this.client.exec(id, req, { onStdout: handlers?.onStdout, onStderr: handlers?.onStderr });
  }

  writeFile(id: string, path: string, content: string | Uint8Array) {
    return this.client.writeFile(id, path, content);
  }

  readFile(id: string, path: string) {
    return this.client.readFile(id, path);
  }

  // Desktop (computer-use). Requires the workspace to use an E2B desktop template.
  desktopStart(id: string): Promise<DesktopStatus> {
    return this.client.desktopStatus(id);
  }
  desktopStream(id: string, viewOnly: boolean): Promise<DesktopStream> {
    return this.client.desktopStream(id, viewOnly);
  }
  desktopRevoke(id: string): Promise<void> {
    return this.client.desktopRevoke(id);
  }

  /** Native desktop control (screenshot / click / type / …) for E2B desktop templates. */
  desktopAction(id: string, args: Record<string, unknown>): Promise<{ text: string; screenshot?: Uint8Array }> {
    return this.client.desktopAction(id, args);
  }

  openPty(id: string, cols: number, rows: number, onData: (data: string) => void, opts?: { cwd?: string }): Promise<PtySession> {
    return this.client.openPty(id, cols, rows, onData, opts);
  }
}

/**
 * Offline driver used before an InstaBox key is configured (and by the demo/screenshots).
 * It mimics the same state machine, wake latency and exec semantics as the real API.
 */
export class MockDriver implements CloudDriver {
  readonly kind = 'mock' as const;
  private machine: MachineSummary = {
    id: `mock_${newId('m')}`,
    name: 'moyubot-shared',
    state: 'suspended',
    autoSuspendAfterSeconds: 600,
    updatedAt: new Date().toISOString(),
    spec: { vcpus: 4, memMiB: 8192 },
  };
  private operations = new Map<string, OperationSummary>();

  hasCredential(): boolean {
    return true;
  }

  async listMachines(): Promise<MachineSummary[]> {
    return [this.machine];
  }

  async getMachine(id: string): Promise<MachineSummary> {
    if (id !== this.machine.id) throw new InstaBoxError({ status: 404, code: 'not_found', message: 'mock machine not found' });
    return { ...this.machine, updatedAt: new Date().toISOString() };
  }

  async updateMachine(_id: string, patch: Record<string, unknown>): Promise<MachineSummary> {
    if (patch.autoSuspendAfterSeconds !== undefined) {
      this.machine = { ...this.machine, autoSuspendAfterSeconds: Number(patch.autoSuspendAfterSeconds) };
    }
    return { ...this.machine };
  }

  async createMachine(body: Record<string, unknown>): Promise<{ machine?: MachineSummary; operationId?: string }> {
    this.machine = {
      ...this.machine,
      name: String(body.name ?? this.machine.name),
      state: 'starting',
      autoSuspendAfterSeconds: Number(body.autoSuspendAfterSeconds ?? 600),
      updatedAt: new Date().toISOString(),
    };
    const operationId = newId('op');
    this.operations.set(operationId, { id: operationId, state: 'running', phase: 'booting', machineId: this.machine.id });
    void (async () => {
      await sleep(2400);
      this.machine = { ...this.machine, state: 'running', updatedAt: new Date().toISOString() };
      this.operations.set(operationId, { id: operationId, state: 'succeeded', phase: 'done', machineId: this.machine.id });
    })();
    return { machine: { ...this.machine }, operationId };
  }

  async act(id: string, action: 'start' | 'stop' | 'suspend' | 'resume' | 'wake' | 'delete'): Promise<OperationSummary> {
    if (id !== this.machine.id) throw new InstaBoxError({ status: 404, code: 'not_found', message: 'mock machine not found' });
    if (action === 'suspend' || action === 'resume' || action === 'wake' || action === 'start' || action === 'stop') {
      this.machine = {
        ...this.machine,
        state: action === 'suspend' ? 'suspending' : action === 'stop' ? 'stopping' : action === 'start' ? 'starting' : 'resuming',
        updatedAt: new Date().toISOString(),
      };
      const operationId = newId('op');
      this.operations.set(operationId, { id: operationId, state: 'running', phase: 'mock', machineId: id });
      void (async () => {
        await sleep(action === 'suspend' ? 900 : 1200);
        const next: InstaBoxMachineState = action === 'suspend' ? 'suspended' : action === 'stop' ? 'stopped' : 'running';
        this.machine = { ...this.machine, state: next, updatedAt: new Date().toISOString() };
        this.operations.set(operationId, { id: operationId, state: 'succeeded', phase: 'done', machineId: id });
      })();
      return { id: operationId, state: 'running', machineId: id };
    }
    return { id: newId('op'), state: 'succeeded', machineId: id };
  }

  async waitOperation(id: string, options?: { timeoutMs?: number; onPhase?: (phase: string) => void }): Promise<OperationSummary> {
    const deadline = Date.now() + (options?.timeoutMs ?? 120_000);
    for (;;) {
      const op = this.operations.get(id);
      if (op) {
        options?.onPhase?.(op.phase ?? '');
        if (op.state === 'succeeded' || op.state === 'failed') return op;
      }
      if (Date.now() > deadline) throw new InstaBoxError({ status: 0, code: 'timeout', message: 'mock operation timeout' });
      await sleep(300);
    }
  }

  async waitForState(
    id: string,
    accept: InstaBoxMachineState[],
    options?: { timeoutMs?: number; onState?: (machine: MachineSummary) => void },
  ): Promise<MachineSummary> {
    const deadline = Date.now() + (options?.timeoutMs ?? 120_000);
    for (;;) {
      const machine = await this.getMachine(id);
      options?.onState?.(machine);
      if (accept.includes(machine.state)) return machine;
      if (Date.now() > deadline) throw new InstaBoxError({ status: 0, code: 'timeout', message: `mock state ${machine.state}` });
      await sleep(300);
    }
  }

  async exec(id: string, req: ExecRequest, handlers?: { onStdout?: (chunk: string) => void }): Promise<ExecResult> {
    if (this.machine.state !== 'running') throw new InstaBoxError({ status: 409, code: 'machine_not_running', message: 'machine is not running' });
    const cmd = req.cmd ?? (req.argv ?? []).join(' ');
    await sleep(220);
    const now = new Date().toISOString();
    let stdout = '';
    if (/^\s*(uname|whoami|pwd|ls|cat|echo|python3? --version|df)/.test(cmd)) {
      if (cmd.includes('uname')) stdout = `Linux moyubot-shared 6.18.54-fc #1 SMP x86_64 GNU/Linux\n`;
      else if (cmd.includes('whoami')) stdout = `user\n`;
      else if (cmd.includes('pwd')) stdout = `${req.cwd ?? '/data/home'}\n`;
      else if (cmd.startsWith('ls')) stdout = `Desktop\nDocuments\nDownloads\nmoyubot\n`;
      else if (cmd.includes('--version')) stdout = `Python 3.13.5\n`;
      else if (cmd.includes('df')) stdout = `Filesystem      Size  Used Avail Use%\n/dev/vda1        16G  2.1G   13G  14% /data\n`;
      else stdout = '';
    }
    stdout += `[mock ${now}] ${cmd}\n`;
    handlers?.onStdout?.(stdout);
    return { stdout, stderr: '', exitCode: 0, timedOut: false, truncated: false };
  }

  async writeFile(_id: string, _path: string, _content: string | Uint8Array): Promise<void> {
    await sleep(120);
  }

  async readFile(_id: string, _path: string): Promise<Uint8Array> {
    return new Uint8Array();
  }
}

export interface CloudHostDeps {
  settings: CloudHostSettings;
  /** API key, or a function so a key saved later is picked up without restarting. */
  apiKey?: string | (() => string | undefined);
  onStatus?: (status: CloudStatus) => void;
  onLog?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

export type ComputerHost = Pick<CloudHost, 'getSettings' | 'status' | 'beginTask' | 'endTask' | 'touch' | 'armIdleIfNeeded' | 'ensureAwake' | 'exec' | 'readText' | 'readBytes' | 'writeText' | 'writeBytes'> & { control?: ComputerControl; desktopAction?: CloudHost['desktopAction'] };

/** Local Windows execution environment. It deliberately exposes the same narrow
 * computer surface as CloudHost so the agent cannot care where a workspace runs. */
export class LocalHost {
  private settings: CloudHostSettings;
  private statusValue: CloudStatus;
  private onStatus?: (status: CloudStatus) => void;
  private activeTasks = 0;
  private processes = new Set<() => void>();
  constructor(settings: CloudHostSettings, onStatus?: (status: CloudStatus) => void) {
    this.settings = settings;
    this.onStatus = onStatus;
    this.statusValue = { state: 'ready', lastTransitionAt: Date.now(), awakeMs: 0, wakeCount: 0, machine: { id: 'local-windows', name: '本机 Windows', state: 'running', autoSuspendAfterSeconds: null } };
  }
  getSettings(): CloudHostSettings { return this.settings; }
  status(): CloudStatus { return this.statusValue; }
  updateSettings(settings: CloudHostSettings): void { this.settings = settings; }
  beginTask(reason: string): void { this.activeTasks++; this.statusValue = { ...this.statusValue, state: 'busy', pendingReason: reason, lastTransitionAt: Date.now() }; this.onStatus?.(this.statusValue); }
  endTask(): void { this.activeTasks = Math.max(0, this.activeTasks - 1); this.statusValue = { ...this.statusValue, state: this.activeTasks ? 'busy' : 'ready', pendingReason: this.activeTasks ? this.statusValue.pendingReason : undefined, lastTransitionAt: Date.now() }; this.onStatus?.(this.statusValue); }
  touch(): void { /* local hosts never auto-suspend */ }
  armIdleIfNeeded(): void { /* local hosts stay available */ }
  async ensureAwake(_reason: string): Promise<MachineSummary> { return { id: 'local-windows', name: '本机 Windows', state: 'running', autoSuspendAfterSeconds: null }; }
  async exec(command: string, options: { timeoutSeconds?: number; onStdout?: (chunk: string) => void; signal?: AbortSignal; subDirectory?: string } = {}): Promise<ExecResult> {
    if (options.signal?.aborted) throw new Error('任务已停止');
    const cwd = this.workspaceRoot(options.subDirectory);
    await fs.mkdir(cwd, { recursive: true });
    if (options.signal?.aborted) throw new Error('任务已停止');
    this.beginTask('在本机执行命令');
    try {
      return await new Promise<ExecResult>((resolve, reject) => {
        const script = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding;\n${command}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`;
        const child = process.platform === 'win32'
          ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          : spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', timedOut = false, truncated = false;
        const stop = () => {
          if (!child.pid) return;
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => child.kill());
            killer.on('exit', (code) => { if (code !== 0) child.kill(); });
          } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
        };
        this.processes.add(stop);
        const timeout = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, Math.min(900, options.timeoutSeconds ?? 120)) * 1000);
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted) stop();
        const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', stop); this.processes.delete(stop); };
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { if (stdout.length < 1024 * 1024) { stdout += chunk.slice(0, 1024 * 1024 - stdout.length); options.onStdout?.(chunk); } else truncated = true; });
        child.stderr.on('data', (chunk: string) => { if (stderr.length < 1024 * 1024) stderr += chunk.slice(0, 1024 * 1024 - stderr.length); else truncated = true; });
        child.on('error', (error) => { cleanup(); reject(error); });
        child.on('close', (code) => { cleanup(); if (options.signal?.aborted) reject(new Error('任务已停止')); else resolve({ stdout, stderr, exitCode: code ?? 1, timedOut, truncated }); });
      });
    } finally { this.endTask(); }
  }
  async readText(file: string, subDirectory?: string): Promise<string> { return fs.readFile(await this.safePath(file, subDirectory), 'utf8'); }
  async readBytes(file: string, subDirectory?: string): Promise<{ bytes: Uint8Array; machineId: string }> { return { bytes: new Uint8Array(await fs.readFile(await this.safePath(file, subDirectory))), machineId: 'local-windows' }; }
  async writeText(file: string, content: string, subDirectory?: string): Promise<void> { const target = await this.safePath(file, subDirectory); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8'); }
  async writeBytes(file: string, content: Uint8Array, subDirectory?: string): Promise<void> { const target = await this.safePath(file, subDirectory); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
  async suspend(_reason: string): Promise<void> { /* no-op for local */ }
  dispose(): void { this.processes.forEach((stop) => stop()); }
  /** botDir 锚点：子目录必须仍在本机工作区内（逃逸保护，非法子目录退回共享根）。 */
  private workspaceRoot(subDirectory?: string): string {
    if (!subDirectory) return this.settings.workspaceDir;
    // Bot 的 dirName 允许是绝对路径：一个 Bot 一个根，这里就是它自己的工作目录。
    // 越界保护不在这里，而在 safePath()（仍然只允许根内路径）。
    if (path.isAbsolute(subDirectory)) return path.resolve(subDirectory);
    const root = path.resolve(this.settings.workspaceDir);
    const target = path.resolve(root, subDirectory);
    const relative = path.relative(root, target);
    return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) ? target : root;
  }
  private async safePath(file: string, subDirectory?: string): Promise<string> {
    const base = this.workspaceRoot(subDirectory);
    await fs.mkdir(base, { recursive: true });
    const root = await fs.realpath(base);
    const target = path.resolve(root, file);
    const inside = (candidate: string) => { const relative = path.relative(root, candidate); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
    if (!inside(target)) throw new Error('路径必须位于本地工作区内');
    let existing = target;
    for (;;) {
      try { if (!inside(await fs.realpath(existing))) throw new Error('路径链接指向工作区外'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; existing = path.dirname(existing); }
    }
    return target;
  }
}

export function resolveCloudState(machine: MachineSummary | undefined, busy: boolean): CloudState {
  if (!machine) return 'unconfigured';
  switch (machine.state) {
    case 'running':
      return busy ? 'busy' : 'ready';
    case 'suspended':
      return 'suspended';
    case 'stopped':
      return 'stopped';
    case 'creating':
    case 'starting':
    case 'resuming':
      return 'waking';
    case 'suspending':
    case 'stopping':
      return 'sleeping';
    case 'error':
    case 'deleted':
      return 'error';
    default:
      return 'off';
  }
}

export class CloudHost {
  readonly control = new ComputerControl();
  private preparedDirectories = new Set<string>();
  private instabox: InstaBoxDriver | undefined;
  private e2b: E2BDriver | undefined;
  private readonly mock = new MockDriver();
  private readonly keyProvider: () => string | undefined;
  private settings: CloudHostSettings;
  private statusValue: CloudStatus;
  private wakePromise: Promise<MachineSummary> | null = null;
  private machine: MachineSummary | undefined;
  private activeRuns = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private lastActivityAt = Date.now();
  private awakeSince: number | undefined;
  private onStatus?: (status: CloudStatus) => void;
  private onLog?: (level: 'info' | 'warn' | 'error', text: string) => void;

  constructor(deps: CloudHostDeps) {
    this.settings = deps.settings;
    this.onStatus = deps.onStatus;
    this.onLog = deps.onLog;
    const apiKey = deps.apiKey;
    this.keyProvider = typeof apiKey === 'function' ? apiKey : () => apiKey;
    this.statusValue = {
      state: 'off',
      lastTransitionAt: Date.now(),
      awakeMs: 0,
      wakeCount: 0,
    };
    this.startPolling();
    void this.refresh();
  }

  isConfigured(): boolean {
    if (this.settings.driver === 'mock') return true;
    return Boolean(this.keyProvider()?.trim());
  }

  get driver(): CloudDriver {
    if (this.settings.driver === 'mock' || !this.isConfigured()) return this.mock;
    if (this.settings.driver === 'e2b') {
      if (!this.e2b) this.e2b = new E2BDriver(this.keyProvider() ?? '', this.settings.baseUrl, this.settings.e2bDomain);
      return this.e2b;
    }
    if (!this.instabox) {
      this.instabox = new InstaBoxDriver(this.keyProvider() ?? '', this.settings.baseUrl);
    }
    return this.instabox;
  }

  updateSettings(settings: CloudHostSettings): void {
    this.settings = settings;
    void this.refresh();
  }

  getSettings(): CloudHostSettings {
    return this.settings;
  }

  status(): CloudStatus {
    return this.statusValue;
  }

  setStatus(patch: Partial<CloudStatus>, note?: string): void {
    this.statusValue = { ...this.statusValue, ...patch, lastTransitionAt: Date.now() };
    if (this.statusValue.machine?.state === 'running' && !this.awakeSince) this.awakeSince = Date.now();
    if (this.statusValue.machine?.state !== 'running') {
      this.awakeSince = undefined;
      this.statusValue.awakeMs = 0;
    }
    this.onStatus?.(this.statusValue);
    if (note) this.onLog?.('info', note);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.statusValue.state === 'ready' || this.statusValue.state === 'suspended') void this.refresh();
    }, 20_000);
    this.pollTimer.unref?.();
  }

  /** Drop the cached client (e.g. after the API key changed). */
  invalidateDriver(): void {
    this.preparedDirectories.clear();
    this.instabox = undefined;
    this.e2b = undefined;
    this.machine = undefined;
    void this.refresh();
  }

  async refresh(): Promise<CloudStatus> {
    if (this.disposed) return this.statusValue;
    if (!this.isConfigured()) {
      this.statusValue = { ...this.statusValue, state: 'unconfigured' };
      this.onStatus?.(this.statusValue);
      return this.statusValue;
    }
    try {
      if (!this.settings.machineId) {
        const machines = await this.driver.listMachines();
        const match = machines.find((m) => m.name === this.settings.machineName) ?? machines[0];
        if (match) {
          this.machine = match;
          this.settings = { ...this.settings, machineId: match.id };
        }
      } else {
        try {
          this.machine = await this.driver.getMachine(this.settings.machineId);
        } catch (error) {
          // E2B sandbox may have been killed/paused away — drop the stale id so
          // the next wake recreates it instead of surfacing a hard error.
          if (this.settings.driver === 'e2b') {
            this.settings = { ...this.settings, machineId: undefined };
            this.machine = undefined;
          } else {
            throw error;
          }
        }
      }
      // Configured but no sandbox yet (e.g. E2B before first wake): show as "off"
      // so the wake button is enabled, instead of "unconfigured".
      const state = this.machine ? resolveCloudState(this.machine, this.activeRuns > 0) : 'off';
      this.setStatus({
        state,
        machine: this.machine
          ? {
              id: this.machine.id,
              name: this.machine.name,
              state: this.machine.state,
              autoSuspendAfterSeconds: this.machine.autoSuspendAfterSeconds,
              updatedAt: this.machine.updatedAt,
              spec: this.machine.spec,
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', lastError: message });
      this.onLog?.('warn', `同步云主机状态失败：${message}`);
    }
    return this.statusValue;
  }

  beginTask(reason: string): void {
    this.activeRuns += 1;
    this.lastActivityAt = Date.now();
    this.statusValue = { ...this.statusValue, pendingReason: reason };
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.machine?.state === 'running') this.setStatus({ state: 'busy' });
  }

  endTask(): void {
    this.activeRuns = Math.max(0, this.activeRuns - 1);
    this.lastActivityAt = Date.now();
    if (this.activeRuns === 0) {
      this.statusValue = { ...this.statusValue, pendingReason: undefined };
      if (this.machine?.state === 'running') this.setStatus({ state: 'ready' });
      this.armIdleTimer();
    }
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  /** Re-arm the local idle-suspend timer when nothing is running. */
  armIdleIfNeeded(): void {
    if (this.activeRuns === 0 && this.machine?.state === 'running') this.armIdleTimer();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.settings.idleSuspendMinutes <= 0) return;
    this.idleTimer = setTimeout(() => void this.sleepIfIdle(), this.settings.idleSuspendMinutes * 60_000);
    this.idleTimer.unref?.();
  }

  async sleepIfIdle(): Promise<boolean> {
    if (this.activeRuns > 0) return false;
    if (this.statusValue.state !== 'ready' && this.statusValue.state !== 'busy') return false;
    await this.suspend('空闲自动休眠');
    return true;
  }

  async ensureAwake(reason: string): Promise<MachineSummary> {
    if (this.wakePromise) return this.wakePromise;
    this.wakePromise = this.wake(reason).finally(() => {
      this.wakePromise = null;
    });
    return this.wakePromise;
  }

  private async wake(reason: string): Promise<MachineSummary> {
    if (!this.isConfigured()) {
      throw new Error('云主机尚未配置：请在设置里填入 InstaBox API Key');
    }
    const startedAt = Date.now();
    try {
      let id = this.settings.machineId;
      // E2B: a stored machineId may point to a killed sandbox. Validate by
      // fetching it — if gone, forget it and recreate below. We deliberately
      // do NOT compare template names here: `settings.templateId` is a template
      // alias (e.g. "desktop") while the sandbox reports its template id, so a
      // strict comparison would wrongly discard a perfectly good sandbox every
      // wake (causing endless recreate). Template changes are handled by the
      // user clearing the machine; a live sandbox is always reused.
      if (id && this.settings.driver === 'e2b') {
        try {
          await this.driver.getMachine(id);
        } catch {
          id = undefined;
        }
        this.settings = { ...this.settings, machineId: id };
      }
      // Startup discovery and server-side autosuspend can race a user action.
      // Always discover/refresh before deciding to create, resume or start.
      if (!id) {
        const machines = await this.driver.listMachines();
        const match = machines.find((m) => m.name === this.settings.machineName)
          ?? (this.settings.driver === 'e2b' ? undefined : machines[0]);
        if (match) {
          id = match.id;
          this.settings = { ...this.settings, machineId: id };
        }
      }
      if (!id) {
        this.setStatus({ state: 'waking', pendingReason: reason }, `创建云主机：${reason}`);
        const created = await this.driver.createMachine({
          name: this.settings.machineName,
          templateId: this.settings.templateId,
          autoSuspendAfterSeconds: this.settings.autoSuspendAfterSeconds,
          vcpus: this.settings.vcpus,
          memMiB: this.settings.memMiB,
          persistentDiskGiB: this.settings.persistentDiskGiB,
          maxRunMinutes: this.settings.maxRunMinutes,
        });
        if (created.machine?.id) {
          id = created.machine.id;
          this.machine = created.machine;
          this.settings = { ...this.settings, machineId: id };
          this.onLog?.('info', `创建云主机 ${created.machine.name}`);
        }
        if (created.operationId) {
          const operation = await this.driver.waitOperation(created.operationId, {
            timeoutMs: 240_000,
            onPhase: (phase) => this.setStatus({ operationPhase: phase }),
          });
          this.checkOperation(operation);
        }
      }
      if (!id) throw new Error('创建云主机后没有拿到 machine id');
      let machine = await this.driver.getMachine(id);
      this.machine = machine;
      if (machine.state !== 'running') {
        this.setStatus({ state: 'waking', pendingReason: reason }, `唤醒云主机：${reason}`);
        if (['creating', 'starting', 'resuming', 'suspending', 'stopping'].includes(machine.state)) {
          machine = await this.driver.waitForState(id, ['running', 'suspended', 'stopped', 'error'], { timeoutMs: 240_000 });
          this.machine = machine;
        }
      } else {
        this.touch();
        this.setStatus({ state: this.activeRuns > 0 ? 'busy' : 'ready', machine, lastError: undefined, pendingReason: undefined, operationPhase: undefined });
        return machine;
      }
      if (machine.state === 'suspended') {
        await this.finishOperation(await this.driver.act(id, 'resume'), 120_000);
      } else if (machine.state === 'stopped' || machine.state === 'error') {
        await this.finishOperation(await this.driver.act(id, 'start'), 240_000);
      }
      machine = await this.driver.waitForState(id, ['running'], {
        timeoutMs: 240_000,
        onState: (next) => {
          this.machine = next;
          this.setStatus({ operationPhase: next.state });
        },
      });
      this.machine = machine;
      this.setStatus(
        {
          state: this.activeRuns > 0 ? 'busy' : 'ready',
          machine: {
            id: machine.id,
            name: machine.name,
            state: machine.state,
            autoSuspendAfterSeconds: machine.autoSuspendAfterSeconds,
            updatedAt: machine.updatedAt,
            spec: machine.spec,
          },
          lastError: undefined,
          pendingReason: undefined,
          operationPhase: undefined,
          lastWakeAt: Date.now(),
          wakeCount: this.statusValue.wakeCount + 1,
          awakeMs: 0,
        },
        `云主机已就绪（${Math.round((Date.now() - startedAt) / 1000)}s）`,
      );
      this.touch();
      await this.applyAutoSuspend();
      return machine;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', lastError: message }, `唤醒失败：${message}`);
      throw error;
    }
  }

  private checkOperation(operation: OperationSummary): void {
    if (operation.state === 'failed') {
      throw new Error(operation.error?.message || `云电脑操作失败（${operation.error?.code ?? operation.id}）`);
    }
  }

  private async finishOperation(operation: OperationSummary, timeoutMs: number): Promise<void> {
    this.checkOperation(operation);
    if (operation.id) this.checkOperation(await this.driver.waitOperation(operation.id, {
      timeoutMs, onPhase: (phase) => this.setStatus({ operationPhase: phase }),
    }));
  }

  /** Keep the server-side idle timer aligned with the local setting. */
  private async applyAutoSuspend(): Promise<void> {
    if (this.driver.kind !== 'instabox' || !this.machine || !this.settings.machineId) return;
    const desired = this.settings.autoSuspendAfterSeconds;
    if (this.machine.autoSuspendAfterSeconds === desired) return;
    try {
      this.machine = await this.driver.updateMachine(this.settings.machineId, { autoSuspendAfterSeconds: desired });
    } catch (error) {
      this.onLog?.('warn', `同步休眠计时失败：${(error as Error).message}`);
    }
  }

  async suspend(reason: string): Promise<void> {
    if (!this.settings.machineId) return;
    if (this.activeRuns > 0) {
      this.onLog?.('warn', `仍有 ${this.activeRuns} 个任务在跑，跳过休眠`);
      return;
    }
    this.setStatus({ state: 'sleeping', pendingReason: reason }, `休眠云主机：${reason}`);
    try {
      const op = await this.driver.act(this.settings.machineId, 'suspend');
      await this.finishOperation(op, 90_000);
      await this.driver.getMachine(this.settings.machineId).then((machine) => {
        this.machine = machine;
        this.setStatus({
          state: 'suspended',
          machine: {
            id: machine.id,
            name: machine.name,
            state: machine.state,
            autoSuspendAfterSeconds: machine.autoSuspendAfterSeconds,
            updatedAt: machine.updatedAt,
            spec: machine.spec,
          },
          awakeMs: 0,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', lastError: message }, `休眠失败：${message}`);
      throw error;
    }
  }

  async exec(command: string, options: { timeoutSeconds?: number; onStdout?: (chunk: string) => void; signal?: AbortSignal; subDirectory?: string } = {}): Promise<ExecResult> {
    const directory = this.remoteDirectory(options.subDirectory);
    const machine = await this.ensureAwake('在云主机上执行命令');
    this.touch();
    this.setStatus({ state: 'busy' });
    try {
      options.signal?.throwIfAborted();
      const directoryKey = `${machine.id}:${directory}`;
      if (!this.preparedDirectories.has(directoryKey)) {
        const prepared = await this.driver.exec(machine.id, { cmd: `mkdir -p -- ${shellQuote(directory)}`, timeoutSeconds: options.timeoutSeconds ?? 120 }, { signal: options.signal });
        if (prepared.exitCode !== 0 || prepared.timedOut) throw new Error(`无法创建云电脑工作目录：${prepared.stderr || prepared.stdout || directory}`);
        this.preparedDirectories.add(directoryKey);
      }
      options.signal?.throwIfAborted();
      return await this.driver.exec(machine.id, { cmd: command, cwd: directory, timeoutSeconds: options.timeoutSeconds ?? 120 }, {
        onStdout: options.onStdout,
        signal: options.signal,
      });
    } finally {
      this.touch();
      if (this.activeRuns === 0) this.setStatus({ state: 'ready' });
    }
  }

  /**
   * Open an interactive PTY shell on the cloud machine. Only supported by drivers
   * that implement openPty (E2B). The machine is woken first.
   */
  async openCloudPty(cols: number, rows: number, onData: (data: string) => void, subDirectory?: string): Promise<PtySession> {
    const machine = await this.ensureAwake('打开云终端');
    const driver = this.driver;
    if (!driver.openPty) throw new Error('当前云电脑不支持交互终端');
    this.touch();
    // Try the configured remote workspace dir, but only use it as the shell cwd if
    // we can actually create it — otherwise fall back to the sandbox default home
    // (an invalid cwd makes the PTY fail with "does not exist").
    const wanted = this.remoteDirectory(subDirectory);
    let cwd: string | undefined;
    try {
      const r = await driver.exec(machine.id, { cmd: `mkdir -p -- ${shellQuote(wanted)} && test -d ${shellQuote(wanted)} && echo OK`, timeoutSeconds: 20 });
      if (r.exitCode === 0 && r.stdout.includes('OK')) cwd = wanted;
    } catch { /* ignore */ }
    return driver.openPty(machine.id, cols, rows, onData, { cwd });
  }
  private remoteDirectory(subDirectory?: string): string {
    // E2B sandboxes run as an unprivileged `user` and cannot create /data; their
    // writable home is /home/user. InstaBox uses /data/moyubot.
    const fallbackRoot = this.settings.driver === 'e2b' ? '/home/user/moyubot' : '/data/moyubot';
    const root = this.settings.remoteWorkspaceDir ?? fallbackRoot;
    if (!subDirectory) return normalizeRemoteDirectory(root);
    return normalizeRemoteDirectory(`${root.replace(/\/+$/, '')}/${subDirectory.replace(/^\/+|\/+$/g, '')}`);
  }

  async readText(remotePath: string, subDirectory?: string): Promise<string> {
    const resolved = path.posix.resolve(this.remoteDirectory(subDirectory), remotePath);
    const machine = await this.ensureAwake('读取云主机文件');
    const bytes = await this.driver.readFile(machine.id, resolved);
    return new TextDecoder().decode(bytes);
  }

  async desktopAction(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; screenshot?: Uint8Array }> {
    const machine = await this.ensureAwake('Bot 操作桌面');
    const driver = this.driver as CloudDriver & { desktopAction?: (id: string, a: Record<string, unknown>) => Promise<{ text: string; screenshot?: Uint8Array }> };
    // E2B desktop templates expose native screenshot/input; use it directly.
    if (typeof driver.desktopAction === 'function' && this.settings.driver === 'e2b') {
      signal?.throwIfAborted();
      const result = await driver.desktopAction(machine.id, args);
      this.touch();
      return result;
    }
    if (!driver.desktopStart) throw new Error('当前工作区不提供真实远程桌面');
    signal?.throwIfAborted();
    const status = await driver.desktopStart(machine.id);
    if (!status.running) throw new Error('云电脑桌面未运行，请使用 agent-browser 模板');
    const coordinate = (key: string) => {
      const value = args[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2560) throw new Error(`${key} 必须为有效的屏幕像素坐标`);
      return value;
    };
    const run = async (cmd: string) => {
      signal?.throwIfAborted();
      const result = await driver.exec(machine.id, { cmd: `export DISPLAY=:1; ${cmd}`, timeoutSeconds: 30 }, { signal });
      if (result.exitCode || result.timedOut) throw new Error(result.stderr || '桌面操作失败');
      return result;
    };
    switch (args.action) {
      case 'open': {
        const url = new URL(String(args.url ?? ''));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 http/https 网页');
        await run(`b=$(command -v chromium || command -v chromium-browser || command -v google-chrome); test -n "$b" || exit 127; setsid nohup "$b" --no-first-run --no-default-browser-check --password-store=basic ${shellQuote(url.href)} >/dev/null 2>&1 </dev/null &`);
        break;
      }
      case 'click': {
        const button = { left: 1, middle: 2, right: 3 }[String(args.button ?? 'left')];
        if (!button) throw new Error('鼠标按钮无效');
        await run(`xdotool mousemove ${coordinate('x')} ${coordinate('y')} click${args.double === true ? ' --repeat 2 --delay 80' : ''} ${button}`);
        break;
      }
      case 'type': {
        if (typeof args.text !== 'string' || args.text.length > 8000) throw new Error('输入文本过长或无效');
        await run(`xdotool type --clearmodifiers --delay 1 -- ${shellQuote(args.text)}`);
        break;
      }
      case 'press': {
        const keys = Array.isArray(args.keys) ? args.keys : [args.keys];
        if (!keys.length || keys.length > 6 || !keys.every((key) => typeof key === 'string' && /^[a-zA-Z0-9_]+$/.test(key))) throw new Error('按键名称无效，使用 Return、Escape、ctrl、l 等 X11 键名');
        await run(`xdotool key --clearmodifiers -- ${shellQuote(keys.join('+'))}`);
        break;
      }
      case 'scroll': {
        const button = { up: 4, down: 5, left: 6, right: 7 }[String(args.direction)];
        const amount = args.amount ?? 3;
        if (!button || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('滚动参数无效');
        await run(`xdotool click --repeat ${amount} --delay 30 ${button}`);
        break;
      }
      case 'screenshot': {
        const file = shellQuote(`/tmp/${newId('moyu-screen')}.png`);
        const result = await run(`scrot -o ${file} && base64 -w0 ${file}; result=$?; rm -f -- ${file}; exit "$result"`);
        if (result.truncated) throw new Error('截图超过命令输出上限，请缩小桌面后重试');
        const screenshot = Buffer.from(result.stdout.trim(), 'base64');
        if (screenshot.length < 8 || screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('桌面截图无效');
        return { text: '当前桌面截图（坐标以图片左上角为原点）', screenshot };
      }
      default: throw new Error('不支持的桌面操作');
    }
    this.touch();
    return { text: `桌面操作已完成：${args.action}。操作后先截图确认结果，再决定下一步。` };
  }

  async readBytes(remotePath: string, subDirectory?: string): Promise<{ bytes: Uint8Array; machineId: string }> {
    remotePath = path.posix.resolve(this.remoteDirectory(subDirectory), remotePath);
    const machine = await this.ensureAwake('读取云主机文件');
    const bytes = await this.driver.readFile(machine.id, remotePath);
    return { bytes, machineId: machine.id };
  }

  async writeText(remotePath: string, content: string, subDirectory?: string): Promise<void> {
    remotePath = path.posix.resolve(this.remoteDirectory(subDirectory), remotePath);
    const machine = await this.ensureAwake('写入云主机文件');
    await this.driver.writeFile(machine.id, remotePath, content);
    this.touch();
  }

  async writeBytes(remotePath: string, content: Uint8Array, subDirectory?: string): Promise<void> {
    remotePath = path.posix.resolve(this.remoteDirectory(subDirectory), remotePath);
    const machine = await this.ensureAwake('上传文件到云电脑');
    await this.driver.writeFile(machine.id, remotePath, content);
    this.touch();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
