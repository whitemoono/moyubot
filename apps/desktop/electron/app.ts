import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, clipboard, ipcMain, safeStorage, shell } from 'electron';
import { AgentRuntime, CloudHost, ScheduleRunner, Store, resolveArtifact } from '@moyu/core';
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
  readonly cloud: CloudHost;
  readonly runtime: AgentRuntime;
  readonly scheduler: ScheduleRunner;
  private win: BrowserWindow | undefined;
  private approvals = new Map<string, PendingApproval>();
  private version: string;
  private offSchedules: () => void;

  constructor(dataDir: string, version: string) {
    this.version = version;
    const secrets = new SafeSecretBox(dataDir);
    this.store = new Store(dataDir, secrets);
    this.offSchedules = this.store.onSchedulesChanged((schedules) => this.send('moyu:event', { type: 'schedules', schedules } satisfies AgentEvent));
    const workspaceDir = this.store.getSettings().cloud.workspaceDir;
    fs.mkdirSync(workspaceDir, { recursive: true });

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

    this.runtime = new AgentRuntime({
      store: this.store,
      cloud: this.cloud,
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
  }

  private send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
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
    ipcMain.handle('moyu:app:check-updates', () => checkForUpdates(this.version));
    ipcMain.handle('moyu:bootstrap', (): BootstrapPayload => {
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

    ipcMain.handle('moyu:settings:save', (_event, patch: Partial<AppSettings>): AppSettings => {
      const next = this.store.updateSettings(patch);
      if (patch.cloud) this.cloud.updateSettings(next.cloud);
      return next;
    });

    ipcMain.handle('moyu:provider:key', (_event, input: { providerId: string; key: string }) => {
      this.store.secrets.set(this.store.providerSecretKey(input.providerId), input.key.trim());
    });


    ipcMain.handle('moyu:provider:test', async (_event, providerId: string, draft?: AppSettings['providers'][number], draftKey?: string): Promise<ProviderTestResult> => {
      const config = draft ? { ...draft, id: providerId } : this.store.getProvider(providerId);
      if (!config) return { ok: false, latencyMs: 0, message: '供应商不存在' };
      const key = draftKey?.trim() || this.store.secrets.get(this.store.providerSecretKey(providerId)) || '';
      const provider = createChatProvider(config, key);
      const startedAt = Date.now();
      try {
        const result = await provider.test();
        return { ok: result.ok, latencyMs: result.latencyMs, message: result.message };
      } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, message: (error as Error).message };
      }
    });

    ipcMain.handle('moyu:provider:models', async (_event, providerId: string, draft?: AppSettings['providers'][number], draftKey?: string): Promise<string[]> => {
      const config = draft ? { ...draft, id: providerId } : this.store.getProvider(providerId);
      if (!config) return [];
      const key = draftKey?.trim() || this.store.secrets.get(this.store.providerSecretKey(providerId)) || '';
      return createChatProvider(config, key).listModels();
    });

    ipcMain.handle('moyu:bot:save', (_event, bot: Bot): Bot => {
      const next: Bot = { ...bot, updatedAt: Date.now(), createdAt: bot.createdAt || Date.now() };
      this.store.upsertBot(next);
      return next;
    });

    ipcMain.handle('moyu:bot:metadata', (_event, botId: string, patch: BotMetadataPatch) => this.store.updateBotMetadata(botId, patch));
    ipcMain.handle('moyu:bot-group:update', (_event, name: string, action: BotGroupAction) => this.store.updateBotGroup(name, action));
    ipcMain.handle('moyu:bot:copy-conversation', (_event, botId: string) => {
      if (!this.store.getBot(botId)) throw new Error('Bot 不存在');
      const id = this.store.botConversation(botId).id;
      clipboard.writeText(id);
      return id;
    });

    ipcMain.handle('moyu:bot:delete', (_event, botId: string) => {
      this.store.removeBot(botId);
    });

    ipcMain.handle('moyu:send', async (_event, input: SendMessageInput): Promise<SendMessageResult> => {
      return this.runtime.send(input);
    });
    ipcMain.handle('moyu:group:create', (_event, title: string, memberBotIds: string[]) => this.store.createGroup(title, memberBotIds));

    ipcMain.handle('moyu:stop', (_event, conversationId: string): boolean => this.runtime.stop(conversationId));

    ipcMain.handle('moyu:approve', (_event, decision: ApprovalDecision) => {
      const pending = this.approvals.get(decision.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.approvals.delete(decision.requestId);
      pending.resolve(decision.approved);
      this.send('moyu:event', { type: 'approval_done', requestId: decision.requestId, approved: decision.approved } satisfies AgentEvent);
    });

    ipcMain.handle('moyu:usage', (_event, query: UsageQuery) => this.store.usage.query(query));
    ipcMain.handle('moyu:conversations', (_event, botId?: string) => this.store.listConversations(botId));
    ipcMain.handle('moyu:conversation', (_event, id: string): Conversation | undefined => this.store.getConversation(id));
    ipcMain.handle('moyu:conversation:bot', (_event, botId: string): Conversation => this.store.botConversation(botId));

    ipcMain.handle('moyu:cloud', (): CloudStatus => this.cloud.status());
    ipcMain.handle('moyu:cloud:action', async (_event, action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop'): Promise<CloudStatus> => {
      try {
        if (action === 'wake' || action === 'start') await this.cloud.ensureAwake('手动唤醒');
        else if (action === 'sleep' || action === 'stop') await this.cloud.suspend('手动休眠');
        else await this.cloud.refresh();
      } catch (error) {
        this.send('moyu:event', { type: 'log', level: 'error', text: (error as Error).message } satisfies AgentEvent);
      }
      return this.cloud.status();
    });

    ipcMain.handle('moyu:cloud:exec', async (_event, cmd: string): Promise<ExecResult> => {
      return this.cloud.exec(cmd, { timeoutSeconds: 60 });
    });

    ipcMain.handle('moyu:cloud:save', async (_event, input: { patch: Partial<AppSettings['cloud']>; apiKey?: string }): Promise<CloudStatus> => {
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

    ipcMain.handle('moyu:schedules', (): Schedule[] => this.store.listSchedules());
    ipcMain.handle('moyu:schedule:add', (_event, input: { botId: string; cron: string; prompt: string }): Schedule => {
      return this.scheduler.create(input.botId, input.cron, input.prompt);
    });
    ipcMain.handle('moyu:schedule:delete', (_event, id: string) => this.store.removeSchedule(id));
    ipcMain.handle('moyu:schedule:toggle', (_event, id: string): Schedule[] => {
      const schedule = this.store.listSchedules().find((item) => item.id === id);
      if (!schedule) throw new Error('任务不存在');
      this.store.updateSchedule(schedule.botId, id, { action: schedule.enabled ? 'pause' : 'resume' });
      return this.store.listSchedules();
    });
    ipcMain.handle('moyu:schedule:update', (_event, botId: string, id: string, patch: ScheduleUpdate): Schedule => this.store.updateSchedule(botId, id, patch));

    ipcMain.handle('moyu:memories', (_event, botId?: string): MemoryFact[] => this.store.listMemories(botId));
    ipcMain.handle('moyu:memory:add', (_event, input: { botId: string; text: string }): MemoryFact =>
      this.store.addMemory(input.botId, input.text.trim()),
    );
    ipcMain.handle('moyu:memory:delete', (_event, id: string) => this.store.removeMemory(id));

    ipcMain.handle('moyu:artifact:open', async (_event, relPath: string) => {
      const file = resolveArtifact(this.store.getSettings().cloud.workspaceDir, relPath);
      if (file) await shell.openPath(file);
    });

    ipcMain.handle('moyu:open-external', async (_event, url: string) => {
      if (/^https:\/\//i.test(url)) await shell.openExternal(url);
    });

    ipcMain.handle('moyu:win', (_event, action: 'minimize' | 'maximize' | 'close') => {
      const win = this.win;
      if (!win) return;
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      } else win.close();
    });
  }


  dispose(): void {
    this.offSchedules();
    this.scheduler.stop();
    this.cloud.dispose();
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
