import type { CloudHost } from './cloud';

export interface DesktopSession {
  mode: 'view' | 'manual';
  machineId: string;
  url: string;
  expiresAt: string;
}

/** Serializes desktop ownership and revokes control links before resuming Bots. */
export class DesktopSessions {
  private queue: Promise<unknown> = Promise.resolve();
  private session?: DesktopSession;
  private controlledMachine?: string;
  private holdingTask = false;
  private leaseAt = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(private host: CloudHost, private pending: (machineId?: string) => void = () => {}, recoveryMachine?: string) {
    this.controlledMachine = recoveryMachine;
    if (recoveryMachine) this.host.control.block();
    this.timer = setInterval(() => {
      if (this.controlledMachine && Date.now() - this.leaseAt > 45_000) void this.close().catch(() => {});
    }, 10_000);
    this.timer.unref?.();
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  heartbeat(): void { this.leaseAt = Date.now(); }
  get controlling(): boolean { return Boolean(this.controlledMachine); }

  private async revokeControl(): Promise<void> {
    if (!this.controlledMachine) return;
    const revoke = this.host.driver.desktopRevoke;
    if (!revoke) throw new Error('当前云电脑不支持撤销桌面控制');
    await revoke.call(this.host.driver, this.controlledMachine);
    // InstaBox closes existing viewers asynchronously. Do not resume automation early.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    this.pending(undefined);
    this.controlledMachine = undefined;
    this.session = undefined;
    if (this.holdingTask) { this.host.endTask(); this.holdingTask = false; }
    this.host.control.resume();
  }

  private async stream(machineId: string, mode: DesktopSession['mode']): Promise<DesktopSession> {
    const driver = this.host.driver;
    if (!driver.desktopStream) throw new Error('演示模式不提供真实远程桌面，请先配置 InstaBox');
    const stream = await driver.desktopStream(machineId, mode !== 'manual');
    if (new URL(stream.url).protocol !== 'https:') throw new Error('桌面服务返回了无效的连接');
    this.session = { ...stream, machineId, mode };
    return this.session;
  }

  open(): Promise<DesktopSession> {
    return this.serial(async () => {
      if (this.controlledMachine) await this.revokeControl();
      const status = this.host.status();
      if (!['ready', 'busy'].includes(status.state) || !status.machine) throw new Error('请先唤醒云电脑');
      if (this.session?.machineId === status.machine.id && Date.parse(this.session.expiresAt) > Date.now() + 30_000) return this.session;
      const driver = this.host.driver;
      if (!driver.desktopStart) throw new Error('演示模式不提供真实远程桌面，请先配置 InstaBox');
      const desktop = await driver.desktopStart(status.machine.id);
      if (!desktop.installed || !desktop.running) throw new Error('此模板尚未启动桌面，请在 InstaBox 使用 agent-browser 模板');
      return this.stream(status.machine.id, 'view');
    });
  }

  take(): Promise<DesktopSession> {
    this.heartbeat();
    return this.serial(async () => {
      if (this.session?.mode === 'manual') { this.heartbeat(); return this.session; }
      const machineId = this.session?.machineId;
      if (!machineId || !['ready', 'busy'].includes(this.host.status().state)) throw new Error('请先连接桌面预览');
      try { await this.host.control.drain(AbortSignal.timeout(30_000)); }
      catch { this.host.control.resume(); throw new Error('Bot 或终端仍在执行电脑操作，请等待结束后接管'); }
      try {
        this.controlledMachine = machineId;
        this.pending(machineId);
        this.host.beginTask('手动接管电脑'); this.holdingTask = true;
        await this.host.driver.desktopRevoke!(machineId);
        const session = await this.stream(machineId, 'manual');
        this.heartbeat();
        return session;
      } catch {
        await this.revokeControl();
        throw new Error('接管未完成，已交还 Bot，请重试');
      }
    });
  }

  release(): Promise<DesktopSession> {
    return this.serial(async () => {
      const machineId = this.controlledMachine ?? this.session?.machineId;
      await this.revokeControl();
      if (!machineId) throw new Error('桌面连接已关闭');
      return this.stream(machineId, 'view');
    });
  }

  close(): Promise<void> {
    return this.serial(async () => { await this.revokeControl(); this.session = undefined; });
  }

  async dispose(): Promise<void> { clearInterval(this.timer); await this.close(); }
}
