import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  CloudHostSettings,
  Conversation,
  MemoryFact,
  Message,
  Schedule,
  TelegramSettings,
  UiSettings,
} from './types';
import { DEFAULT_CLOUD_COMMAND, DEFAULT_SYSTEM_PROMPT } from './types';
import { newId, safeJsonParse } from './util';

export interface SecretBox {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  isEncrypted(): boolean;
}

/** Plaintext fallback for tests / headless use. Never used by the desktop app. */
export class PlainSecretBox implements SecretBox {
  private readonly file: string;
  private data: Record<string, string> = {};

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'secrets.json');
    if (fs.existsSync(this.file)) {
      this.data = safeJsonParse<Record<string, string>>(fs.readFileSync(this.file, 'utf8'), {});
    }
  }

  get(key: string): string | undefined {
    return this.data[key];
  }

  set(key: string, value: string): void {
    this.data[key] = value;
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  delete(key: string): void {
    delete this.data[key];
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  isEncrypted(): boolean {
    return false;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function defaultSettings(dataDir: string): AppSettings {
  const now = Date.now();
  const providerId = 'openai-compatible';
  return {
    version: 1,
    providers: [
      {
        id: providerId,
        name: 'OpenAI 兼容',
        kind: 'openai',
        baseUrl: 'https://api.x.ai/v1',
        defaultModel: 'grok-4',
        models: ['grok-4', 'grok-4-fast', 'gpt-4.1', 'deepseek-chat'],
        imageModel: 'grok-2-image',
        createdAt: now,
      },
    ],
    bots: [
      {
        id: 'bot_default',
        name: 'Atlas',
        handle: 'atlas',
        avatar: { from: '#7aa2ff', to: '#c084fc', glyph: 'A' },
        providerId,
        model: 'grok-4',
        temperature: 0.7,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        approvalPolicy: 'never',
        tools: ['cloud_exec', 'cloud_read', 'cloud_write', 'generate_image', 'remember', 'recall', 'schedule_task'],
        image: {
          backend: 'api',
          cloudCommand: DEFAULT_CLOUD_COMMAND,
          cloudOutputPath: '/data/moyubot/out/{name}.png',
          aspect: '1:1',
          wakeHost: true,
        },
        wakeOnTask: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    cloud: {
      driver: 'instabox',
      baseUrl: 'https://api.instabox.sh',
      machineName: 'moyubot-shared',
      templateId: 'agent-browser',
      autoSuspendAfterSeconds: 600,
      idleSuspendMinutes: 3,
      workspaceDir: path.join(dataDir, 'workspace'),
      wakeOnDemand: true,
    },
    telegram: { enabled: false, token: '', allowedIds: [] },
    ui: {
      accent: '#7aa2ff',
      appearance: 'dark',
      reduceMotion: false,
      density: 'comfortable',
      glassIntensity: 0.6,
    },
    activeBotId: 'bot_default',
    activeView: 'chat',
  };
}

export interface ConversationSummary {
  id: string;
  botId: string;
  title: string;
  updatedAt: number;
  preview?: string;
}

export type SettingsPatch = Omit<Partial<AppSettings>, 'cloud' | 'ui' | 'telegram'> & {
  cloud?: Partial<CloudHostSettings>;
  ui?: Partial<UiSettings>;
  telegram?: Partial<TelegramSettings>;
};

export class Store {
  readonly dataDir: string;
  readonly secrets: SecretBox;
  settings: AppSettings;
  private conversations = new Map<string, Conversation>();
  private memories: MemoryFact[] = [];
  private scheduleList: Schedule[] = [];

  constructor(dataDir: string, secrets?: SecretBox) {
    this.dataDir = dataDir;
    this.secrets = secrets ?? new PlainSecretBox(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.dir('conversations'), { recursive: true });

    const settingsFile = path.join(dataDir, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      const parsed = safeJsonParse<Partial<AppSettings>>(fs.readFileSync(settingsFile, 'utf8'), {});
      const base = defaultSettings(dataDir);
      this.settings = {
        ...base,
        ...parsed,
        cloud: { ...base.cloud, ...parsed.cloud, workspaceDir: parsed.cloud?.workspaceDir || base.cloud.workspaceDir },
        ui: { ...base.ui, ...parsed.ui },
        telegram: { ...base.telegram, ...parsed.telegram },
        providers: parsed.providers?.length ? parsed.providers : base.providers,
        bots: parsed.bots?.length ? parsed.bots : base.bots,
      };
      // Backfill fields added after a user's settings.json was written.
      this.settings.bots = this.settings.bots.map((bot) => ({
        ...base.bots[0]!,
        ...bot,
        image: { ...base.bots[0]!.image, ...bot.image },
        avatar: { ...base.bots[0]!.avatar, ...bot.avatar },
      }));
    } else {
      this.settings = defaultSettings(dataDir);
      this.persistSettings();
    }

    this.loadConversations();
    this.loadMemories();
    this.loadSchedules();
  }

  private dir(name: string): string {
    return path.join(this.dataDir, name);
  }

  persistSettings(): void {
    writeJsonAtomic(path.join(this.dataDir, 'settings.json'), this.settings);
  }

  updateSettings(patch: SettingsPatch): AppSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      cloud: patch.cloud ? { ...this.settings.cloud, ...patch.cloud } : this.settings.cloud,
      ui: patch.ui ? { ...this.settings.ui, ...patch.ui } : this.settings.ui,
      telegram: patch.telegram ? { ...this.settings.telegram, ...patch.telegram } : this.settings.telegram,
    };
    this.persistSettings();
    return this.settings;
  }

  providerSecretKey(providerId: string): string {
    return `provider:${providerId}`;
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  getBot(botId: string) {
    return this.settings.bots.find((bot) => bot.id === botId);
  }

  upsertBot(bot: AppSettings['bots'][number]) {
    const index = this.settings.bots.findIndex((item) => item.id === bot.id);
    if (index >= 0) this.settings.bots[index] = bot;
    else this.settings.bots.push(bot);
    this.persistSettings();
    return bot;
  }

  removeBot(botId: string) {
    this.settings.bots = this.settings.bots.filter((bot) => bot.id !== botId);
    if (this.settings.activeBotId === botId) this.settings.activeBotId = this.settings.bots[0]?.id;
    this.persistSettings();
  }

  getProvider(providerId: string) {
    return this.settings.providers.find((provider) => provider.id === providerId);
  }

  // ----- conversations -----
  private loadConversations(): void {
    const dir = this.dir('conversations');
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const conv = safeJsonParse<Conversation | null>(fs.readFileSync(path.join(dir, entry), 'utf8'), null);
      if (conv?.id) this.conversations.set(conv.id, conv);
    }
  }

  listConversations(botId?: string): ConversationSummary[] {
    return [...this.conversations.values()]
      .filter((conv) => !botId || conv.botId === botId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((conv) => ({
        id: conv.id,
        botId: conv.botId,
        title: conv.title,
        updatedAt: conv.updatedAt,
        preview: conv.messages.at(-1)?.content.slice(0, 120),
      }));
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  createConversation(botId: string, title = '新对话'): Conversation {
    const conv: Conversation = {
      id: newId('conv'),
      botId,
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(conv.id, conv);
    this.saveConversation(conv.id);
    return conv;
  }

  appendMessage(conversationId: string, message: Message): Conversation {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`conversation ${conversationId} not found`);
    const existing = conv.messages.findIndex((m) => m.id === message.id);
    if (existing >= 0) conv.messages[existing] = message;
    else conv.messages.push(message);
    conv.updatedAt = Date.now();
    if (conv.title === '新对话' && message.role === 'user') {
      conv.title = message.content.replace(/\s+/g, ' ').trim().slice(0, 32) || '新对话';
    }
    this.saveConversation(conversationId);
    return conv;
  }

  saveConversation(id: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;
    writeJsonAtomic(path.join(this.dir('conversations'), `${id}.json`), conv);
  }

  deleteConversation(id: string): void {
    this.conversations.delete(id);
    const file = path.join(this.dir('conversations'), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // ----- memories -----
  private loadMemories(): void {
    const file = path.join(this.dataDir, 'memories.json');
    if (!fs.existsSync(file)) return;
    this.memories = safeJsonParse<MemoryFact[]>(fs.readFileSync(file, 'utf8'), []);
  }

  listMemories(botId?: string): MemoryFact[] {
    return this.memories.filter((fact) => !botId || fact.botId === botId);
  }

  addMemory(botId: string, text: string, pinned = false): MemoryFact {
    const normalized = text.trim();
    const existing = this.memories.find((fact) => fact.botId === botId && fact.text.trim() === normalized);
    if (existing) {
      if (pinned && !existing.pinned) {
        existing.pinned = true;
        writeJsonAtomic(path.join(this.dataDir, 'memories.json'), this.memories);
      }
      return existing;
    }
    const fact: MemoryFact = { id: newId('mem'), botId, text: normalized, pinned, createdAt: Date.now() };
    this.memories.push(fact);
    writeJsonAtomic(path.join(this.dataDir, 'memories.json'), this.memories);
    return fact;
  }

  removeMemory(id: string): void {
    this.memories = this.memories.filter((fact) => fact.id !== id);
    writeJsonAtomic(path.join(this.dataDir, 'memories.json'), this.memories);
  }

  // ----- schedules -----
  private loadSchedules(): void {
    const file = path.join(this.dataDir, 'schedules.json');
    if (!fs.existsSync(file)) return;
    this.scheduleList = safeJsonParse<Schedule[]>(fs.readFileSync(file, 'utf8'), []);
  }

  listSchedules(): Schedule[] {
    return [...this.scheduleList];
  }

  upsertSchedule(schedule: Schedule): Schedule {
    const index = this.scheduleList.findIndex((item) => item.id === schedule.id);
    if (index >= 0) this.scheduleList[index] = schedule;
    else this.scheduleList.push(schedule);
    writeJsonAtomic(path.join(this.dataDir, 'schedules.json'), this.scheduleList);
    return schedule;
  }

  removeSchedule(id: string): void {
    this.scheduleList = this.scheduleList.filter((item) => item.id !== id);
    writeJsonAtomic(path.join(this.dataDir, 'schedules.json'), this.scheduleList);
  }
}