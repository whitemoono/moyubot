import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, app, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import { AgentRuntime, CloudHost, DesktopSessions, DiagnosticJournal, LocalHost, ScheduleRunner, Store, normalizeRemoteDirectory, resolveArtifact } from '@moyu/core';
import { checkForUpdates } from './updates';
import type {
  AgentEvent,
  AppSettings,
  ApprovalDecision,
  ApprovalRequest,
  Bot,
  BotMetadataPatch,
  BotGroupAction,
  BootstrapPayload,
  CloudStatus,
  Conversation,
  ExecResult,
  MemoryFact,
  ProviderTestResult,
  Schedule,
  SecretBox,
  SendMessageInput,
  SendMessageResult,
  ScheduleUpdate,
  UsageQuery,
} from '@moyu/core';
import { createChatProvider } from '@moyu/core';

class SafeSecretBox implements SecretBox {
  private data: Record<string, string> = {};
  private readonly file: string;
  private readonly available: boolean;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'secrets.bin.json');
    this.available = safeStorage.isEncryptionAvailable();
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>;
      } catch {
        this.data = {};
      }
    }
  }

  isEncrypted(): boolean {
    return this.available;
  }

  get(key: string): string | undefined {
    const stored = this.data[key];
    if (!stored) return undefined;
    if (!this.available) return stored;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string): void {
    if (!value) {
      this.delete(key);
      return;
    }
    this.data[key] = this.available ? safeStorage.encryptString(value).toString('base64') : value;
    this.flush();
  }

  delete(key: string): void {
    delete this.data[key];
    this.flush();
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export class MoyuApp {
  readonly store: Store;
  readonly diagnostics: DiagnosticJournal;
  private diagnosticCommands = new Map<string, string>();
  readonly cloud: CloudHost;
  readonly desktop: DesktopSessions;
  readonly local: LocalHost;
  readonly runtime: AgentRuntime;
  readonly scheduler: ScheduleRunner;
  private win: BrowserWindow | undefined;
  private approvals = new Map<string, PendingApproval>();
  private version: string;
  private offSchedules: () => void;
  private terminalRuns = new Map<string, AbortController>();

  constructor(dataDir: string, version: string, options?: { localDirectory?: string }) {
    this.version = version;
    const secrets = new SafeSecretBox(dataDir);
    this.store = new Store(dataDir, secrets, options);
    this.diagnostics = new DiagnosticJournal(dataDir, () => [
      secrets.get('cloud:instabox') ?? '', secrets.get('telegram:token') ?? '',
      ...this.store.getSettings().providers.flatMap((provider) => [secrets.get(this.store.providerSecretKey(provider.id)) ?? '', ...Object.values(provider.extraHeaders ?? {})]),
    ]);
    this.offSchedules = this.store.onSchedulesChanged((schedules) => this.send('moyu:event', { type: 'schedules', schedules } satisfies AgentEvent));
    const workspaceDir = this.store.getSettings().cloud.workspaceDir;
    fs.mkdirSync(workspaceDir, { recursive: true });
    const localSettings = { ...this.store.getSettings().cloud, workspaceDir: this.store.getSettings().workspaces.find((item) => item.kind === 'local')?.directory ?? path.join(dataDir, 'local-workspace'), machineName: '本机 Windows', driver: 'mock' as const };
    // A fresh install may be in a protected folder. The setup flow validates it
    // and allows selecting another directory before local execution begins.
    this.local = new LocalHost(localSettings, (status) => {
      this.send('moyu:local', status);
    });

    this.cloud = new CloudHost({
      settings: this.store.getSettings().cloud,
      apiKey: () => this.store.secrets.get('cloud:instabox') ?? '',
      onStatus: (status) => {
        this.send('moyu:cloud', status);
        this.send('moyu:event', { type: 'cloud', status } satisfies AgentEvent);
      },
      onLog: (level, text) => {
        this.send('moyu:event', { type: 'log', level, text } satisfies AgentEvent);
      },
    });

    const recoveryFile = path.join(dataDir, 'desktop-control.json');
    let recoveryMachine: string | undefined;
    if (fs.existsSync(recoveryFile)) {
      try { recoveryMachine = JSON.parse(fs.readFileSync(recoveryFile, 'utf8')).machineId; } catch { /* corrupt record */ }
    }
    this.desktop = new DesktopSessions(this.cloud, (machineId) => {
      if (machineId) fs.writeFileSync(recoveryFile, JSON.stringify({ machineId }), { mode: 0o600 });
      else if (fs.existsSync(recoveryFile)) fs.unlinkSync(recoveryFile);
    }, recoveryMachine);
    if (recoveryMachine) void this.desktop.close().catch(() => {
      this.send('moyu:event', { type: 'log', level: 'error', text: '上次桌面控制尚未撤销，云电脑自动操作暂缓，请连接桌面重试交还' } satisfies AgentEvent);
    });

    this.runtime = new AgentRuntime({
      store: this.store,
      cloud: this.cloud,
      computers: { workspace_cloud: this.cloud, workspace_local: this.local },
      emit: (event) => this.send('moyu:event', event),
      requestApproval: (request) => this.waitForApproval(request),
    });

    this.scheduler = new ScheduleRunner({
      store: this.store,
      runtime: this.runtime,
      onLog: (level, text) => this.send('moyu:event', { type: 'log', level, text } satisfies AgentEvent),
    });
  }

  start(): void {
    this.registerIpc();
    this.scheduler.start();
    void this.cloud.refresh();
  }

  setWindow(win: BrowserWindow): void {
    this.win = win;
    win.webContents.on('render-process-gone', (_event, details) => {
      this.diagnostics.record({ source: '界面进程', message: `界面退出：${details.reason}（${details.exitCode}）` });
      void this.desktop.close().catch(() => {});
    });
    win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) void this.desktop.close().catch(() => {});
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
  }

  private send(channel: string, payload: unknown): void {
    if (channel === 'moyu:event') this.recordDiagnosticEvent(payload as AgentEvent);
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private recordDiagnosticEvent(event: AgentEvent): void {
    if (event.type === 'tool_start' && typeof event.call.arguments.cmd === 'string') {
      this.diagnosticCommands.set(event.call.id, event.call.arguments.cmd);
      if (this.diagnosticCommands.size > 100) this.diagnosticCommands.delete(this.diagnosticCommands.keys().next().value!);
    }
    if (event.type === 'tool_end') {
      const command = this.diagnosticCommands.get(event.result.id);
      this.diagnosticCommands.delete(event.result.id);
      if (!event.result.ok && !/已拒绝|已停止/.test(event.result.summary)) this.diagnostics.record({ source: `Bot / ${event.result.name}`, message: event.result.summary, detail: event.result.detail, command });
    }
    if (event.type === 'run_end' && !event.ok && event.error && event.error !== '已停止') this.diagnostics.record({ source: 'Bot / 模型调用', message: event.error });
    if (event.type === 'log' && ['error', 'warn'].includes(event.level)) this.diagnostics.record({ source: '应用', message: event.text });
  }

  private waitForApproval(request: ApprovalRequest): Promise<boolean> {
    this.send('moyu:event', { type: 'approval', request } satisfies AgentEvent);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(request.id);
        this.send('moyu:event', { type: 'approval_done', requestId: request.id, approved: false } satisfies AgentEvent);
        resolve(false);
      }, 120_000);
      this.approvals.set(request.id, { resolve, timer });
    });
  }

  private registerIpc(): void {
    const handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
      ipcMain.handle(channel, async (event, ...args) => {
        try { return await listener(event, ...args); }
        catch (error) {
          if (!/已停止|任务已停止/.test((error as Error).message)) this.diagnostics.record({ source: channel.replace('moyu:', ''), message: (error as Error).message || '操作失败' });
          throw error;
        }
      });
    };
    const desktopCaller = (event: Electron.IpcMainInvokeEvent) => {
      if (!this.win || event.sender !== this.win.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('桌面控制仅允许应用主界面调用');
    };
    handle('moyu:app:check-updates', () => checkForUpdates(this.version));
    handle('moyu:setup:directory', (event, directory: string) => {
      desktopCaller(event);
      if (this.store.getSettings().onboarding?.completedAt) throw new Error('请通过通用设置更换本地工作目录');
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\x00-\x1f]/.test(directory)) throw new Error('请选择有效的本地绝对路径');
      const target = path.resolve(directory);
      try {
        fs.mkdirSync(target, { recursive: true });
        const probe = path.join(target, `.moyu-write-check-${randomUUID()}`);
        fs.writeFileSync(probe, '', { flag: 'wx' }); fs.unlinkSync(probe);
      } catch { throw new Error('这个目录无法写入，请选择文档目录或其他可写文件夹'); }
      const next = this.store.updateSettings({ workspaces: this.store.getSettings().workspaces.map((workspace) => workspace.kind === 'local' ? { ...workspace, directory: target } : workspace) });
      this.local.updateSettings({ ...this.local.getSettings(), workspaceDir: target });
      return next;
    });
    handle('moyu:setup:finish', (event, skipCloud: boolean) => {
      desktopCaller(event);
      const settings = this.store.getSettings();
      if (settings.onboarding?.completedAt) return settings;
      if (!settings.userName) throw new Error('请先设置用户名');
      const folder = settings.workspaces.find((workspace) => workspace.kind === 'local')?.directory;
      if (!folder) throw new Error('请先选择本地工作目录');
      try { fs.accessSync(folder, fs.constants.W_OK); } catch { throw new Error('本地工作目录不可写，请重新选择'); }
      if (!skipCloud && !this.store.secrets.get('cloud:instabox')) throw new Error('请配置云电脑或选择跳过');
      const activeWorkspaceId = skipCloud ? 'workspace_local' : 'workspace_cloud';
      if (skipCloud && !settings.bots.some((bot) => bot.workspaceId === 'workspace_local')) {
        const source = settings.bots[0]!;
        this.store.upsertBot({ ...source, id: `bot_local_${randomUUID()}`, workspaceId: 'workspace_local', name: '本地助手', approvalPolicy: 'ask', sidebar: undefined, image: { ...source.image, backend: 'api', wakeHost: false } });
      }
      const botId = this.store.getSettings().bots.find((bot) => bot.workspaceId === activeWorkspaceId)?.id;
      return this.store.updateSettings({ onboarding: { step: 2, completedAt: Date.now() }, activeWorkspaceId, activeBotId: botId, workspaces: this.store.getSettings().workspaces.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, activeBotId: botId } : workspace) });
    });
    handle('moyu:feedback:diagnostics', (event) => { desktopCaller(event); return this.diagnostics.list(); });
    handle('moyu:feedback:clear', (event) => { desktopCaller(event); this.diagnostics.clear(); });
    handle('moyu:feedback:copy', (event, text: string) => {
      desktopCaller(event);
      if (typeof text !== 'string' || text.length > 200_000) throw new Error('反馈内容过长');
      clipboard.writeText(text);
    });
    handle('moyu:local:directory', async () => {
      const running = () => this.local.status().state === 'busy' || this.store.listConversations().some((item) => item.workspaceId === 'workspace_local' && this.runtime.isRunning(item.id));
      if (running()) throw new Error('本机仍有任务运行，请完成后再更换目录');
      const result = await dialog.showOpenDialog({ title: '选择本地工作区目录', defaultPath: this.local.getSettings().workspaceDir, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled && result.filePaths[0]) {
        if (running()) throw new Error('本机有任务运行，暂时不能更换目录');
        const directory = result.filePaths[0];
        this.store.updateSettings({ workspaces: this.store.getSettings().workspaces.map((item) => item.kind === 'local' ? { ...item, directory } : item) });
        this.local.updateSettings({ ...this.local.getSettings(), workspaceDir: directory });
      }
      return this.store.getSettings();
    });
    handle('moyu:bootstrap', (): BootstrapPayload => {
      const settings = this.store.getSettings();
      const providerKeys: Record<string, boolean> = {};
      for (const provider of settings.providers) {
        providerKeys[provider.id] = Boolean(this.store.secrets.get(this.store.providerSecretKey(provider.id)));
      }
      return {
        settings,
        cloud: this.cloud.status(),
        conversations: this.store.listConversations(),
        runningConversations: this.store.listConversations().filter((item) => this.runtime.isRunning(item.id)).map((item) => item.id),
        schedules: this.store.listSchedules(),
        memories: this.store.listMemories(),
        secrets: {
          providerKeys,
          cloudKey: Boolean(this.store.secrets.get('cloud:instabox')),
          telegramToken: Boolean(this.store.secrets.get('telegram:token')),
          encrypted: this.store.secrets.isEncrypted(),
        },
        platform: process.platform,
        version: this.version,
      };
    });

    handle('moyu:settings:save', (_event, patch: Partial<AppSettings>): AppSettings => {
      this.checkCloudDirectoryChange(patch.cloud);
      const next = this.store.updateSettings(patch);
      if (patch.cloud) this.cloud.updateSettings(next.cloud);
      return next;
    });

    handle('moyu:provider:key', (_event, input: { providerId: string; key: string }) => {
      this.store.secrets.set(this.store.providerSecretKey(input.providerId), input.key.trim());
    });


    handle('moyu:provider:test', async (_event, providerId: string, draft?: AppSettings['providers'][number], draftKey?: string): Promise<ProviderTestResult> => {
      const config = draft ? { ...draft, id: providerId } : this.store.getProvider(providerId);
      if (!config) return { ok: false, latencyMs: 0, message: '供应商不存在' };
      const key = draftKey?.trim() || this.store.secrets.get(this.store.providerSecretKey(providerId)) || '';
      const provider = createChatProvider(config, key);
      const startedAt = Date.now();
      try {
        const result = await provider.test();
        if (!result.ok) this.diagnostics.record({ source: '供应商连接测试', message: result.message });
        return { ok: result.ok, latencyMs: result.latencyMs, message: result.message };
      } catch (error) {
        this.diagnostics.record({ source: '供应商连接测试', message: (error as Error).message });
        return { ok: false, latencyMs: Date.now() - startedAt, message: (error as Error).message };
      }
    });

    handle('moyu:provider:models', async (_event, providerId: string, draft?: AppSettings['providers'][number], draftKey?: string): Promise<string[]> => {
      const config = draft ? { ...draft, id: providerId } : this.store.getProvider(providerId);
      if (!config) return [];
      const key = draftKey?.trim() || this.store.secrets.get(this.store.providerSecretKey(providerId)) || '';
      return createChatProvider(config, key).listModels();
    });

    handle('moyu:bot:save', (_event, bot: Bot): Bot => {
      const next: Bot = { ...bot, updatedAt: Date.now(), createdAt: bot.createdAt || Date.now() };
      return this.store.upsertBot(next);
    });

    handle('moyu:bot:metadata', (_event, botId: string, patch: BotMetadataPatch) => this.store.updateBotMetadata(botId, patch));
    handle('moyu:bot-group:update', (_event, name: string, action: BotGroupAction, workspaceId?: string) => this.store.updateBotGroup(name, action, workspaceId));
    handle('moyu:bot:copy-conversation', (_event, botId: string) => {
      if (!this.store.getBot(botId)) throw new Error('Bot 不存在');
      const id = this.store.botConversation(botId).id;
      clipboard.writeText(id);
      return id;
    });

    handle('moyu:bot:delete', (_event, botId: string) => {
      this.store.removeBot(botId);
    });

    handle('moyu:send', async (_event, input: SendMessageInput): Promise<SendMessageResult> => {
      return this.runtime.send(input);
    });
    handle('moyu:group:create', (_event, title: string, memberBotIds: string[]) => this.store.createGroup(title, memberBotIds));

    handle('moyu:stop', (_event, conversationId: string): boolean => this.runtime.stop(conversationId));

    handle('moyu:approve', (_event, decision: ApprovalDecision) => {
      const pending = this.approvals.get(decision.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.approvals.delete(decision.requestId);
      pending.resolve(decision.approved);
      this.send('moyu:event', { type: 'approval_done', requestId: decision.requestId, approved: decision.approved } satisfies AgentEvent);
    });

    handle('moyu:usage', (_event, query: UsageQuery) => this.store.usage.query(query));
    handle('moyu:conversations', (_event, botId?: string) => this.store.listConversations(botId));
    handle('moyu:conversation', (_event, id: string): Conversation | undefined => this.store.getConversation(id));
    handle('moyu:conversation:bot', (_event, botId: string): Conversation => this.store.botConversation(botId));

    handle('moyu:cloud', (): CloudStatus => this.cloud.status());
    handle('moyu:desktop:open', (event) => { desktopCaller(event); return this.desktop.open(); });
    handle('moyu:desktop:take', (event) => { desktopCaller(event); return this.desktop.take(); });
    handle('moyu:desktop:release', (event) => { desktopCaller(event); return this.desktop.release(); });
    handle('moyu:desktop:close', (event) => { desktopCaller(event); return this.desktop.close(); });
    handle('moyu:desktop:heartbeat', (event) => { desktopCaller(event); this.desktop.heartbeat(); });
    handle('moyu:local', (): CloudStatus => this.local.status());
    handle('moyu:cloud:action', async (_event, action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop'): Promise<CloudStatus> => {
      try {
        if (this.desktop.controlling && action !== 'refresh') throw new Error('请先交还 Bot，再切换电脑电源');
        if (action === 'wake' || action === 'start') await this.cloud.ensureAwake('手动唤醒');
        else if (action === 'sleep' || action === 'stop') await this.cloud.suspend('手动休眠');
        else await this.cloud.refresh();
      } catch (error) {
        this.send('moyu:event', { type: 'log', level: 'error', text: (error as Error).message } satisfies AgentEvent);
      }
      return this.cloud.status();
    });

    handle('moyu:cloud:exec', async (_event, cmd: string, requestId?: string): Promise<ExecResult> => this.runTerminalCommand('cloud', cmd, requestId));
    handle('moyu:local:exec', async (_event, cmd: string, requestId?: string): Promise<ExecResult> => this.runTerminalCommand('local', cmd, requestId));
    handle('moyu:terminal:stop', (_event, requestId: string) => { this.terminalRuns.get(requestId)?.abort(); });

    handle('moyu:cloud:save', async (_event, input: { patch: Partial<AppSettings['cloud']>; apiKey?: string }): Promise<CloudStatus> => {
      await this.desktop.close();
      this.checkCloudDirectoryChange(input.patch);
      if (typeof input.apiKey === 'string') {
        const key = input.apiKey.trim();
        if (key) this.store.secrets.set('cloud:instabox', key);
        else this.store.secrets.delete('cloud:instabox');
        // A new key may belong to another account: forget the old machine.
        this.store.updateSettings({ cloud: { ...this.store.getSettings().cloud, ...input.patch, machineId: undefined } });
        this.cloud.updateSettings(this.store.getSettings().cloud);
        this.cloud.invalidateDriver();
      } else {
        const next = this.store.updateSettings({ cloud: input.patch });
        this.cloud.updateSettings(next.cloud);
        await this.cloud.refresh();
      }
      return this.cloud.status();
    });

    handle('moyu:schedules', (): Schedule[] => this.store.listSchedules());
    handle('moyu:schedule:add', (_event, input: { botId: string; cron: string; prompt: string }): Schedule => {
      return this.scheduler.create(input.botId, input.cron, input.prompt);
    });
    handle('moyu:schedule:delete', (_event, id: string) => this.store.removeSchedule(id));
    handle('moyu:schedule:toggle', (_event, id: string): Schedule[] => {
      const schedule = this.store.listSchedules().find((item) => item.id === id);
      if (!schedule) throw new Error('任务不存在');
      this.store.updateSchedule(schedule.botId, id, { action: schedule.enabled ? 'pause' : 'resume' });
      return this.store.listSchedules();
    });
    handle('moyu:schedule:update', (_event, botId: string, id: string, patch: ScheduleUpdate): Schedule => this.store.updateSchedule(botId, id, patch));

    handle('moyu:memories', (_event, botId?: string): MemoryFact[] => this.store.listMemories(botId));
    handle('moyu:memory:add', (_event, input: { botId: string; text: string }): MemoryFact =>
      this.store.addMemory(input.botId, input.text.trim()),
    );
    handle('moyu:memory:delete', (_event, id: string) => this.store.removeMemory(id));

    handle('moyu:artifact:open', async (_event, relPath: string) => {
      const file = this.resolveWorkspaceArtifact(relPath);
      if (file) await shell.openPath(file);
    });

    handle('moyu:open-external', async (_event, url: string) => {
      if (/^https:\/\//i.test(url)) await shell.openExternal(url);
    });

    handle('moyu:win', (_event, action: 'minimize' | 'maximize' | 'close') => {
      const win = this.win;
      if (!win) return;
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      } else win.close();
    });
  }

  resolveWorkspaceArtifact(relative: string): string | undefined {
    if (relative.startsWith('@workspace_local/')) return resolveArtifact(path.join(this.store.dataDir, 'local-artifacts'), relative.slice('@workspace_local/'.length));
    return resolveArtifact(this.store.getSettings().cloud.workspaceDir, relative);
  }

  private checkCloudDirectoryChange(patch?: Partial<AppSettings['cloud']>): void {
    if (patch && this.desktop.controlling) throw new Error('请先交还 Bot，再修改云电脑配置');
    if (patch?.remoteWorkspaceDir === undefined) return;
    const directory = normalizeRemoteDirectory(patch.remoteWorkspaceDir);
    if (directory === (this.store.getSettings().cloud.remoteWorkspaceDir ?? '/data/moyubot')) return;
    if (['busy', 'waking', 'sleeping'].includes(this.cloud.status().state) || this.store.listConversations().some((item) => (item.workspaceId ?? 'workspace_cloud') === 'workspace_cloud' && this.runtime.isRunning(item.id))) throw new Error('云电脑仍有任务运行或正在切换状态，请结束后再更换工作路径');
  }

  private async runTerminalCommand(kind: 'local' | 'cloud', cmd: string, requestId: string = randomUUID()): Promise<ExecResult> {
    if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 64000 || typeof requestId !== 'string' || requestId.length > 100) throw new Error('无效的终端命令');
    if (this.terminalRuns.has(requestId)) throw new Error('命令正在执行，请勿重复提交');
    const computer = kind === 'local' ? this.local : this.cloud;
    const controller = new AbortController(); this.terminalRuns.set(requestId, controller);
    let release: (() => void) | undefined;
    let started = false;
    try {
      if (kind === 'cloud') release = await this.cloud.control.acquire(controller.signal);
      computer.beginTask('终端命令'); started = true;
      const result = await computer.exec(cmd, { timeoutSeconds: 60, signal: controller.signal });
      if (result.exitCode !== 0 || result.timedOut) this.diagnostics.record({ source: kind === 'local' ? '本地终端' : '云端终端', message: result.timedOut ? '命令执行超时' : `命令退出码 ${result.exitCode}`, command: cmd, detail: result.stderr || result.stdout });
      return result;
    } catch (error) {
      if (!controller.signal.aborted) this.diagnostics.record({ source: kind === 'local' ? '本地终端' : '云端终端', message: (error as Error).message, command: cmd });
      throw error;
    } finally { if (started) computer.endTask(); release?.(); this.terminalRuns.delete(requestId); }
  }


  dispose(): void {
    this.terminalRuns.forEach((controller) => controller.abort());
    this.offSchedules();
    this.scheduler.stop();
    this.cloud.dispose();
    this.local.dispose();
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.approvals.clear();
  }

  static isPackaged(): boolean {
    return app.isPackaged;
  }
}
