import { InstaBoxClient, InstaBoxError } from './instabox';
import type { ExecRequest, ExecResult, MachineSummary, OperationSummary } from './instabox';
import type { CloudHostSettings, CloudState, CloudStatus, InstaBoxMachineState } from './types';
import { newId, normalizeRemoteDirectory, shellQuote, sleep } from './util';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CloudDriver {
  readonly kind: 'instabox' | 'mock';
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

export type ComputerHost = Pick<CloudHost, 'getSettings' | 'status' | 'beginTask' | 'endTask' | 'touch' | 'armIdleIfNeeded' | 'ensureAwake' | 'exec' | 'readText' | 'readBytes' | 'writeText'>;

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
  async exec(command: string, options: { timeoutSeconds?: number; onStdout?: (chunk: string) => void; signal?: AbortSignal } = {}): Promise<ExecResult> {
    if (options.signal?.aborted) throw new Error('任务已停止');
    await fs.mkdir(this.settings.workspaceDir, { recursive: true });
    if (options.signal?.aborted) throw new Error('任务已停止');
    this.beginTask('在本机执行命令');
    try {
      return await new Promise<ExecResult>((resolve, reject) => {
        const script = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding;\n${command}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`;
        const child = process.platform === 'win32'
          ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: this.settings.workspaceDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          : spawn('/bin/sh', ['-c', command], { cwd: this.settings.workspaceDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  async readText(file: string): Promise<string> { return fs.readFile(await this.safePath(file), 'utf8'); }
  async readBytes(file: string): Promise<{ bytes: Uint8Array; machineId: string }> { return { bytes: new Uint8Array(await fs.readFile(await this.safePath(file))), machineId: 'local-windows' }; }
  async writeText(file: string, content: string): Promise<void> { const target = await this.safePath(file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8'); }
  async suspend(_reason: string): Promise<void> { /* no-op for local */ }
  dispose(): void { this.processes.forEach((stop) => stop()); }
  private async safePath(file: string): Promise<string> {
    const root = await fs.realpath(this.settings.workspaceDir); const target = path.resolve(root, file);
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
  private preparedDirectories = new Set<string>();
  private instabox: InstaBoxDriver | undefined;
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
    return this.settings.driver === 'mock' || Boolean(this.keyProvider()?.trim());
  }

  get driver(): CloudDriver {
    if (this.settings.driver === 'mock' || !this.isConfigured()) return this.mock;
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
        this.machine = await this.driver.getMachine(this.settings.machineId);
      }
      const state = resolveCloudState(this.machine, this.activeRuns > 0);
      this.setStatus({
        state,
        machine: this.machine
          ? {
              id: this.machine.id,
              name: this.machine.name,
              state: this.machine.state,
              autoSuspendAfterSeconds: this.machine.autoSuspendAfterSeconds,
              updatedAt: this.machine.updatedAt,
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
    if (this.machine?.state === 'running') {
      this.touch();
      return this.machine;
    }
    this.setStatus({ state: 'waking', pendingReason: reason }, `唤醒云主机：${reason}`);
    const startedAt = Date.now();
    try {
      let id = this.settings.machineId;
      if (!id) {
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
          await this.driver.waitOperation(created.operationId, {
            timeoutMs: 240_000,
            onPhase: (phase) => this.setStatus({ operationPhase: phase }),
          });
        }
      }
      if (!id) throw new Error('创建云主机后没有拿到 machine id');
      let machine = await this.driver.getMachine(id);
      this.machine = machine;
      if (machine.state === 'suspended') {
        const op = await this.driver.act(id, 'wake');
        if (op.id) await this.driver.waitOperation(op.id, { timeoutMs: 120_000 });
      } else if (machine.state === 'stopped' || machine.state === 'error') {
        const op = await this.driver.act(id, 'start');
        if (op.id) await this.driver.waitOperation(op.id, { timeoutMs: 240_000 });
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
          },
          lastError: undefined,
          lastWakeAt: Date.now(),
          wakeCount: this.statusValue.wakeCount + 1,
          awakeMs: 0,
        },
        `云主机已就绪（${Math.round((Date.now() - startedAt) / 1000)}s）`,
      );
      await this.applyAutoSuspend();
      return machine;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', lastError: message }, `唤醒失败：${message}`);
      throw error;
    }
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
      if (op.id) await this.driver.waitOperation(op.id, { timeoutMs: 90_000 });
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

  async exec(command: string, options: { timeoutSeconds?: number; onStdout?: (chunk: string) => void; signal?: AbortSignal } = {}): Promise<ExecResult> {
    const directory = normalizeRemoteDirectory(this.settings.remoteWorkspaceDir ?? '/data/moyubot');
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

  async readText(remotePath: string): Promise<string> {
    remotePath = path.posix.resolve(this.settings.remoteWorkspaceDir ?? '/data/moyubot', remotePath);
    const machine = await this.ensureAwake('读取云主机文件');
    const bytes = await this.driver.readFile(machine.id, remotePath);
    return new TextDecoder().decode(bytes);
  }

  async readBytes(remotePath: string): Promise<{ bytes: Uint8Array; machineId: string }> {
    remotePath = path.posix.resolve(this.settings.remoteWorkspaceDir ?? '/data/moyubot', remotePath);
    const machine = await this.ensureAwake('读取云主机文件');
    const bytes = await this.driver.readFile(machine.id, remotePath);
    return { bytes, machineId: machine.id };
  }

  async writeText(remotePath: string, content: string): Promise<void> {
    remotePath = path.posix.resolve(this.settings.remoteWorkspaceDir ?? '/data/moyubot', remotePath);
    const machine = await this.ensureAwake('写入云主机文件');
    await this.driver.writeFile(machine.id, remotePath, content);
    this.touch();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
