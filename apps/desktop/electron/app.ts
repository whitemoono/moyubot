import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, ipcMain, safeStorage, shell } from 'electron';
import { AgentRuntime, CloudHost, ScheduleRunner, Store, TelegramGateway, resolveArtifact } from '@mesh/core';
import type {
  AgentEvent,
  AppSettings,
  ApprovalDecision,
  ApprovalRequest,
  Bot,
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
} from '@mesh/core';
import { createChatProvider } from '@mesh/core';

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

export class MeshApp {
  readonly store: Store;
  readonly cloud: CloudHost;
  readonly runtime: AgentRuntime;
  readonly scheduler: ScheduleRunner;
  private telegram: TelegramGateway | undefined;
  private win: BrowserWindow | undefined;
  private approvals = new Map<string, PendingApproval>();
  private version: string;

  constructor(dataDir: string, version: string) {
    this.version = version;
    const secrets = new SafeSecretBox(dataDir);
    this.store = new Store(dataDir, secrets);
    const workspaceDir = this.store.getSettings().cloud.workspaceDir;
    fs.mkdirSync(workspaceDir, { recursive: true });

    this.cloud = new CloudHost({
      settings: this.store.getSettings().cloud,
      apiKey: () => this.store.secrets.get('cloud:instabox') ?? '',
      onStatus: (status) => {
        this.send('mesh:cloud', status);
        this.send('mesh:event', { type: 'cloud', status } satisfies AgentEvent);
      },
      onLog: (level, text) => {
        this.send('mesh:event', { type: 'log', level, text } satisfies AgentEvent);
      },
    });

    this.runtime = new AgentRuntime({
      store: this.store,
      cloud: this.cloud,
      emit: (event) => this.send('mesh:event', event),
      requestApproval: (request) => this.waitForApproval(request),
    });

    this.scheduler = new ScheduleRunner({
      store: this.store,
      runtime: this.runtime,
      onLog: (level, text) => this.send('mesh:event', { type: 'log', level, text } satisfies AgentEvent),
    });
  }

  start(): void {
    this.registerIpc();
    this.scheduler.start();
    void this.restartTelegram();
    void this.cloud.refresh();
  }

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  private send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  private waitForApproval(request: ApprovalRequest): Promise<boolean> {
    this.send('mesh:event', { type: 'approval', request } satisfies AgentEvent);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(request.id);
        this.send('mesh:event', { type: 'approval_done', requestId: request.id, approved: false } satisfies AgentEvent);
        resolve(false);
      }, 120_000);
      this.approvals.set(request.id, { resolve, timer });
    });
  }

  private registerIpc(): void {
    ipcMain.handle('mesh:bootstrap', (): BootstrapPayload => {
      const settings = this.store.getSettings();
      const providerKeys: Record<string, boolean> = {};
      for (const provider of settings.providers) {
        providerKeys[provider.id] = Boolean(this.store.secrets.get(this.store.providerSecretKey(provider.id)));
      }
      return {
        settings,
        cloud: this.cloud.status(),
        conversations: this.store.listConversations(),
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

    ipcMain.handle('mesh:settings:save', (_event, patch: Partial<AppSettings>): AppSettings => {
      const next = this.store.updateSettings(patch);
      if (patch.cloud) this.cloud.updateSettings(next.cloud);
      if (patch.telegram) void this.restartTelegram();
      return next;
    });

    ipcMain.handle('mesh:provider:key', (_event, input: { providerId: string; key: string }) => {
      this.store.secrets.set(this.store.providerSecretKey(input.providerId), input.key.trim());
    });

    ipcMain.handle('mesh:telegram:token', (_event, token: string) => {
      this.store.secrets.set('telegram:token', token.trim());
      void this.restartTelegram();
    });

    ipcMain.handle('mesh:provider:test', async (_event, providerId: string): Promise<ProviderTestResult> => {
      const config = this.store.getProvider(providerId);
      if (!config) return { ok: false, latencyMs: 0, message: '供应商不存在' };
      const key = this.store.secrets.get(this.store.providerSecretKey(providerId)) ?? '';
      const provider = createChatProvider(config, key);
      const startedAt = Date.now();
      try {
        const result = await provider.test();
        return { ok: result.ok, latencyMs: result.latencyMs, message: result.message };
      } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, message: (error as Error).message };
      }
    });

    ipcMain.handle('mesh:provider:models', async (_event, providerId: string): Promise<string[]> => {
      const config = this.store.getProvider(providerId);
      if (!config) return [];
      const key = this.store.secrets.get(this.store.providerSecretKey(providerId)) ?? '';
      return createChatProvider(config, key).listModels();
    });

    ipcMain.handle('mesh:bot:save', (_event, bot: Bot): Bot => {
      const next: Bot = { ...bot, updatedAt: Date.now(), createdAt: bot.createdAt || Date.now() };
      this.store.upsertBot(next);
      return next;
    });

    ipcMain.handle('mesh:bot:delete', (_event, botId: string) => {
      this.store.removeBot(botId);
    });

    ipcMain.handle('mesh:send', async (_event, input: SendMessageInput): Promise<SendMessageResult> => {
      return this.runtime.send(input);
    });

    ipcMain.handle('mesh:stop', (_event, conversationId: string): boolean => this.runtime.stop(conversationId));

    ipcMain.handle('mesh:approve', (_event, decision: ApprovalDecision) => {
      const pending = this.approvals.get(decision.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.approvals.delete(decision.requestId);
      pending.resolve(decision.approved);
      this.send('mesh:event', { type: 'approval_done', requestId: decision.requestId, approved: decision.approved } satisfies AgentEvent);
    });

    ipcMain.handle('mesh:conversations', (_event, botId?: string) => this.store.listConversations(botId));
    ipcMain.handle('mesh:conversation', (_event, id: string): Conversation | undefined => this.store.getConversation(id));
    ipcMain.handle('mesh:conversation:new', (_event, botId: string): Conversation => this.store.createConversation(botId));
    ipcMain.handle('mesh:conversation:delete', (_event, id: string) => this.store.deleteConversation(id));

    ipcMain.handle('mesh:cloud', (): CloudStatus => this.cloud.status());
    ipcMain.handle('mesh:cloud:action', async (_event, action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop'): Promise<CloudStatus> => {
      try {
        if (action === 'wake' || action === 'start') await this.cloud.ensureAwake('手动唤醒');
        else if (action === 'sleep' || action === 'stop') await this.cloud.suspend('手动休眠');
        else await this.cloud.refresh();
      } catch (error) {
        this.send('mesh:event', { type: 'log', level: 'error', text: (error as Error).message } satisfies AgentEvent);
      }
      return this.cloud.status();
    });

    ipcMain.handle('mesh:cloud:exec', async (_event, cmd: string): Promise<ExecResult> => {
      return this.cloud.exec(cmd, { timeoutSeconds: 60 });
    });

    ipcMain.handle('mesh:cloud:save', async (_event, input: { patch: Partial<AppSettings['cloud']>; apiKey?: string }): Promise<CloudStatus> => {
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

    ipcMain.handle('mesh:schedules', (): Schedule[] => this.store.listSchedules());
    ipcMain.handle('mesh:schedule:add', (_event, input: { botId: string; cron: string; prompt: string }): Schedule => {
      return this.scheduler.create(input.botId, input.cron, input.prompt);
    });
    ipcMain.handle('mesh:schedule:delete', (_event, id: string) => this.store.removeSchedule(id));
    ipcMain.handle('mesh:schedule:toggle', (_event, id: string): Schedule[] => {
      const schedule = this.store.listSchedules().find((item) => item.id === id);
      if (schedule) this.store.upsertSchedule({ ...schedule, enabled: !schedule.enabled });
      return this.store.listSchedules();
    });

    ipcMain.handle('mesh:memories', (_event, botId?: string): MemoryFact[] => this.store.listMemories(botId));
    ipcMain.handle('mesh:memory:add', (_event, input: { botId: string; text: string }): MemoryFact =>
      this.store.addMemory(input.botId, input.text.trim()),
    );
    ipcMain.handle('mesh:memory:delete', (_event, id: string) => this.store.removeMemory(id));

    ipcMain.handle('mesh:artifact:open', async (_event, relPath: string) => {
      const file = resolveArtifact(this.store.getSettings().cloud.workspaceDir, relPath);
      if (file) await shell.openPath(file);
    });

    ipcMain.handle('mesh:open-external', async (_event, url: string) => {
      if (/^https:\/\//i.test(url)) await shell.openExternal(url);
    });

    ipcMain.handle('mesh:win', (_event, action: 'minimize' | 'maximize' | 'close') => {
      const win = this.win;
      if (!win) return;
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      } else win.close();
    });
  }

  private async restartTelegram(): Promise<void> {
    this.telegram?.stop();
    this.telegram = undefined;
    const settings = this.store.getSettings().telegram;
    const token = this.store.secrets.get('telegram:token') ?? settings.token;
    if (!settings.enabled || !token) return;
    this.telegram = new TelegramGateway({
      store: this.store,
      runtime: this.runtime,
      token,
      onLog: (level, text) => this.send('mesh:event', { type: 'log', level, text } satisfies AgentEvent),
    });
    await this.telegram.start();
  }

  dispose(): void {
    this.telegram?.stop();
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