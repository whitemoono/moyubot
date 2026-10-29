import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  BotMetadataPatch,
  BotGroupAction,
  SidebarBotGroup,
  CloudHostSettings,
  Conversation,
  MemoryFact,
  Message,
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
  TelegramSettings,
  UiSettings,
} from './types';
import { DEFAULT_CLOUD_COMMAND, DEFAULT_SYSTEM_PROMPT } from './types';
import { newId, safeJsonParse } from './util';
import { UsageLedger } from './usage';
import { nextCronTime } from './scheduler';

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
        workspaceId: 'workspace_cloud',
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
    workspaces: [
      { id: 'workspace_cloud', name: '云电脑工作区', kind: 'cloud', computerName: '共享云电脑', createdAt: now },
      { id: 'workspace_local', name: '本地工作区', kind: 'local', computerName: '本机 Windows', directory: path.join(dataDir, 'local-workspace'), createdAt: now },
    ],
    activeWorkspaceId: 'workspace_cloud',
    ui: {
      accent: '#f5f5f5',
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
  workspaceId?: string;
  botId: string;
  group?: Conversation['group'];
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
  readonly usage: UsageLedger;
  readonly dataDir: string;
  readonly secrets: SecretBox;
  settings: AppSettings;
  private conversations = new Map<string, Conversation>();
  private memories: MemoryFact[] = [];
  private scheduleList: Schedule[] = [];
  private scheduleListeners = new Set<(schedules: Schedule[]) => void>();

  constructor(dataDir: string, secrets?: SecretBox) {
    this.dataDir = dataDir;
    this.secrets = secrets ?? new PlainSecretBox(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.dir('conversations'), { recursive: true });

    const settingsFile = path.join(dataDir, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      const parsed = safeJsonParse<Partial<AppSettings>>(fs.readFileSync(settingsFile, 'utf8'), {});
      // Preserve all original data before the first workspace migration.
      if (!parsed.workspaces && !fs.existsSync(path.join(dataDir, 'backup-before-workspaces'))) {
        const backup = path.join(dataDir, 'backup-before-workspaces');
        fs.mkdirSync(backup, { recursive: true });
        for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
          if (['settings.json', 'conversations', 'memories.json', 'schedules.json', 'usage.jsonl'].includes(entry.name)) fs.cpSync(path.join(dataDir, entry.name), path.join(backup, entry.name), { recursive: true });
        }
      }
      const base = defaultSettings(dataDir);
      this.settings = {
        ...base,
        ...parsed,
        cloud: { ...base.cloud, ...parsed.cloud, workspaceDir: parsed.cloud?.workspaceDir || base.cloud.workspaceDir },
        ui: { ...base.ui, ...parsed.ui },
        telegram: { ...base.telegram, ...parsed.telegram },
        providers: parsed.providers?.length ? parsed.providers : base.providers,
        bots: parsed.bots?.length ? parsed.bots : base.bots,
        workspaces: parsed.workspaces?.length ? parsed.workspaces : base.workspaces,
        activeWorkspaceId: parsed.activeWorkspaceId ?? base.activeWorkspaceId,
      };
      // Backfill fields added after a user's settings.json was written.
      this.settings.bots = this.settings.bots.map((bot) => ({
        ...base.bots[0]!,
        ...bot,
        image: { ...base.bots[0]!.image, ...bot.image },
        avatar: { ...base.bots[0]!.avatar, ...bot.avatar },
        workspaceId: bot.workspaceId || 'workspace_cloud',
      }));
    } else {
      this.settings = defaultSettings(dataDir);
      this.persistSettings();
    }

    this.settings.ui.botGroups = this.listBotGroups();
    for (const workspace of this.settings.workspaces) {
      if (workspace.kind === 'cloud' && !workspace.botGroups) workspace.botGroups = this.settings.ui.botGroups;
      if (workspace.kind === 'local' && !workspace.directory) workspace.directory = path.join(dataDir, 'local-workspace');
    }
    if (!this.settings.workspaces.some((item) => item.id === this.settings.activeWorkspaceId)) this.settings.activeWorkspaceId = this.settings.workspaces[0]?.id;
    this.persistSettings();
    this.loadConversations();
    for (const bot of this.settings.bots) this.botConversation(bot.id);
    this.usage = new UsageLedger(dataDir);
    this.usage.backfill(this.conversations.values(), this.settings.bots);
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
    this.settings.ui.botGroups = this.listBotGroups();
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
    const existing = this.getBot(bot.id);
    bot = { ...bot, workspaceId: bot.workspaceId ?? existing?.workspaceId ?? 'workspace_cloud' };
    if (!this.settings.workspaces.some((item) => item.id === bot.workspaceId)) throw new Error('工作区不存在');
    if (existing && (existing.workspaceId ?? 'workspace_cloud') !== bot.workspaceId) throw new Error('现有 Bot 不能直接转移工作区，请创建独立 Bot');
    const index = this.settings.bots.findIndex((item) => item.id === bot.id);
    if (index >= 0) this.settings.bots[index] = bot;
    else this.settings.bots.push(bot);
    this.settings.ui.botGroups = this.listBotGroups();
    this.persistSettings();
    return bot;
  }

  updateBotMetadata(botId: string, patch: BotMetadataPatch) {
    const bot = this.getBot(botId);
    if (!bot) throw new Error('Bot 不存在');
    const name = patch.name === undefined ? bot.name : patch.name.trim();
    if (!name || name.length > 60) throw new Error('Bot 名字需要 1–60 个字符');
    const next = { ...bot, name, sidebar: { ...bot.sidebar, ...patch.sidebar }, updatedAt: Date.now() };
    this.upsertBot(next);
    return next;
  }

  listBotGroups(workspaceId?: string): SidebarBotGroup[] {
    const groups = new Map<string, SidebarBotGroup>();
    const workspace = this.settings.workspaces.find((item) => item.id === workspaceId);
    for (const group of (workspaceId ? workspace?.botGroups ?? (workspaceId === 'workspace_cloud' ? this.settings.ui.botGroups : []) : this.settings.ui.botGroups) ?? []) {
      if (group.name && !groups.has(group.name)) groups.set(group.name, { name: group.name, collapsed: !!group.collapsed });
    }
    for (const bot of this.settings.bots) {
      if (workspaceId && (bot.workspaceId ?? 'workspace_cloud') !== workspaceId) continue;
      const name = bot.sidebar?.group;
      if (name && !groups.has(name)) groups.set(name, { name, collapsed: false });
    }
    return [...groups.values()];
  }

  updateBotGroup(name: string, action: BotGroupAction, workspaceId = 'workspace_cloud'): AppSettings {
    const groups = this.listBotGroups(workspaceId);
    const index = groups.findIndex((group) => group.name === name);
    const inWorkspace = (bot: AppSettings['bots'][number]) => (bot.workspaceId ?? 'workspace_cloud') === workspaceId;
    const hasUngrouped = groups.length > 0 && this.settings.bots.some((bot) => inWorkspace(bot) && !bot.sidebar?.group && !bot.sidebar?.hidden && !bot.sidebar?.pinned);
    if (name === '' && action.type !== 'move') throw new Error('未分组仅支持上移和下移');
    if (index < 0 && !(name === '' && hasUngrouped)) throw new Error('分组不存在');
    let ungroupedGroupIndex = this.settings.workspaces.find((item) => item.id === workspaceId)?.ungroupedGroupIndex ?? (workspaceId === 'workspace_cloud' ? this.settings.ui.ungroupedGroupIndex : undefined);
    let bots = this.settings.bots;
    if (action.type === 'rename') {
      const nextName = action.name.trim();
      if (!nextName || nextName.length > 60) throw new Error('分组名称需要 1–60 个字符');
      if (groups.some((group, i) => i !== index && group.name === nextName)) throw new Error('已存在同名分组，请换一个名字');
      groups[index] = { ...groups[index]!, name: nextName };
      bots = bots.map((bot) => inWorkspace(bot) && bot.sidebar?.group === name ? { ...bot, sidebar: { ...bot.sidebar, group: nextName }, updatedAt: Date.now() } : bot);
    } else if (action.type === 'delete') {
      groups.splice(index, 1);
      if (ungroupedGroupIndex !== undefined && index < ungroupedGroupIndex) ungroupedGroupIndex = Math.max(0, ungroupedGroupIndex - 1);
      bots = bots.map((bot) => inWorkspace(bot) && bot.sidebar?.group === name ? { ...bot, sidebar: { ...bot.sidebar, group: '' }, updatedAt: Date.now() } : bot);
    } else if (action.type === 'collapse') {
      groups[index] = { ...groups[index]!, collapsed: action.collapsed };
    } else if (action.type === 'move') {
      const ordered = [...groups];
      if (hasUngrouped) ordered.splice(Math.max(0, Math.min(groups.length, ungroupedGroupIndex ?? groups.length)), 0, { name: '' });
      const current = ordered.findIndex((group) => group.name === name);
      const target = current + (action.direction === 'up' ? -1 : 1);
      if (target >= 0 && target < ordered.length) [ordered[current], ordered[target]] = [ordered[target]!, ordered[current]!];
      if (hasUngrouped) {
        const position = ordered.findIndex((group) => group.name === '');
        ungroupedGroupIndex = position === groups.length ? undefined : position;
      }
      groups.splice(0, groups.length, ...ordered.filter((group) => group.name !== ''));
    } else throw new Error('不支持的分组操作');
    const previous = this.settings;
    try { return this.updateSettings({ bots, ...(workspaceId === 'workspace_cloud' ? { ui: { botGroups: groups, ungroupedGroupIndex } } : {}), workspaces: this.settings.workspaces.map((item) => item.id === workspaceId ? { ...item, botGroups: groups, ungroupedGroupIndex } : item) }); }
    catch (error) { this.settings = previous; throw error; }
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
      if (conv?.id) this.conversations.set(conv.id, { ...conv, workspaceId: conv.workspaceId ?? this.getBot(conv.group?.memberBotIds[0] ?? conv.botId)?.workspaceId ?? 'workspace_cloud' });
    }
  }

  listConversations(botId?: string): ConversationSummary[] {
    return [...this.conversations.values()]
      .filter((conv) => !conv.mergedInto && (!botId || conv.botId === botId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((conv) => ({
        id: conv.id,
        botId: conv.botId,
        workspaceId: conv.workspaceId ?? this.getBot(conv.botId)?.workspaceId ?? 'workspace_cloud',
        group: conv.group,
        title: conv.title,
        updatedAt: conv.updatedAt,
        preview: [...conv.messages].reverse().find((message) => message.content.trim())?.content.slice(0, 120),
      }));
  }

  getConversation(id: string): Conversation | undefined {
    const conv = this.conversations.get(id);
    return conv?.mergedInto ? this.conversations.get(conv.mergedInto) : conv;
  }

  createGroup(title: string, memberBotIds: string[]): Conversation {
    const ids = [...new Set(memberBotIds)];
    if (ids.length < 2 || ids.length > 12) throw new Error('请选择 2–12 个 Bot');
    if (ids.some((id) => !this.getBot(id))) throw new Error('群成员中的 Bot 不存在');
    const workspaceId = this.getBot(ids[0]!)!.workspaceId ?? 'workspace_cloud';
    if (ids.some((id) => (this.getBot(id)!.workspaceId ?? 'workspace_cloud') !== workspaceId)) throw new Error('不能跨工作区创建群聊');
    const name = title.trim();
    if (name.length > 60) throw new Error('群聊名字最多 60 个字符');
    const id = newId('group');
    const conv: Conversation = { id, botId: id, workspaceId, group: { memberBotIds: ids }, title: name || ids.map((id) => this.getBot(id)!.name).join('、').slice(0, 60), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.conversations.set(id, conv);
    this.saveConversation(id);
    return conv;
  }

  botConversation(botId: string): Conversation {
    if (!this.getBot(botId)) throw new Error('Bot 不存在');
    const existing = [...this.conversations.values()]
      .filter((conv) => conv.botId === botId && !conv.mergedInto)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const canonical = existing[0];
    if (canonical) {
      if (existing.length > 1) {
        const messages = new Map<string, Message>();
        for (const conv of existing) for (const message of conv.messages) messages.set(message.id, message);
        canonical.messages = [...messages.values()].sort((a, b) => a.createdAt - b.createdAt);
        canonical.updatedAt = Math.max(...existing.map((conv) => conv.updatedAt));
        // Rebuild the summary against the merged transcript on the next run.
        canonical.context = undefined;
        this.saveConversation(canonical.id);
        for (const previous of existing.slice(1)) {
          previous.mergedInto = canonical.id;
          this.saveConversation(previous.id);
        }
      }
      return canonical;
    }
    const conv: Conversation = {
      id: newId('conv'),
      botId,
      workspaceId: this.getBot(botId)!.workspaceId ?? 'workspace_cloud',
      title: this.getBot(botId)!.name,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(conv.id, conv);
    this.saveConversation(conv.id);
    return conv;
  }

  /** Compatibility for older scripts: opening a conversation always returns the same one. */
  createConversation(botId: string, _title?: string): Conversation {
    return this.botConversation(botId);
  }

  appendMessage(conversationId: string, message: Message): Conversation {
    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error(`conversation ${conversationId} not found`);
    const existing = conv.messages.findIndex((m) => m.id === message.id);
    if (existing >= 0) conv.messages[existing] = message;
    else conv.messages.push(message);
    conv.updatedAt = Date.now();
    conv.title = this.getBot(conv.botId)?.name ?? conv.title;
    this.saveConversation(conv.id);
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

  addMemory(botId: string, text: string, pinned = false, source: MemoryFact['source'] = 'manual'): MemoryFact {
    const normalized = text.trim();
    const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s。.!！]+/gu, '');
    const existing = this.memories.find((fact) => fact.botId === botId && key(fact.text) === key(normalized));
    if (existing) {
      if (pinned && !existing.pinned) {
        existing.pinned = true;
        writeJsonAtomic(path.join(this.dataDir, 'memories.json'), this.memories);
      }
      return existing;
    }
    const fact: MemoryFact = { id: newId('mem'), botId, text: normalized, pinned, source, createdAt: Date.now() };
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
    if (this.scheduleList.some((task) => task.lastStatus === 'running')) {
      this.persistSchedules(this.scheduleList.map((task) => task.lastStatus !== 'running' ? task : {
        ...task, lastStatus: 'error', lastError: '上次执行因应用退出而中断，请确认聊天中的结果后再安排。',
        ...(task.kind === 'once' ? { enabled: false, completedAt: Date.now(), nextRunAt: undefined } : {}),
      }));
    }
  }

  listSchedules(): Schedule[] {
    return this.scheduleList.map((schedule) => ({ ...schedule }));
  }

  onSchedulesChanged(listener: (schedules: Schedule[]) => void): () => void {
    this.scheduleListeners.add(listener);
    return () => { this.scheduleListeners.delete(listener); };
  }

  private persistSchedules(next: Schedule[]): void {
    writeJsonAtomic(path.join(this.dataDir, 'schedules.json'), next);
    this.scheduleList = next;
    for (const listener of this.scheduleListeners) listener(this.listSchedules());
  }

  private scheduleTiming(input: { cron?: string; runAt?: number }): Pick<Schedule, 'kind' | 'cron' | 'runAt' | 'nextRunAt'> {
    if (input.cron !== undefined && input.runAt !== undefined) throw new Error('重复任务和一次性任务只能选择一种时间');
    if (input.runAt !== undefined) {
      if (!Number.isFinite(input.runAt) || input.runAt <= Date.now() || input.runAt > 8640000000000000) throw new Error('一次性任务需要有效的未来时间');
      return { kind: 'once', cron: '', runAt: input.runAt, nextRunAt: input.runAt };
    }
    if (typeof input.cron !== 'string' || !input.cron.trim()) throw new Error('请提供 cron 或一次性执行时间');
    const next = nextCronTime(input.cron);
    if (!next) throw new Error('这个重复时间在未来一年内没有可执行日期');
    return { kind: 'cron', cron: input.cron.trim(), runAt: undefined, nextRunAt: next.getTime() };
  }

  createSchedule(botId: string, input: ScheduleInput): Schedule {
    if (!this.getBot(botId)) throw new Error('Bot 不存在');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20000) throw new Error('任务指令不能为空且不能超过 20000 字符');
    if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 100)) throw new Error('任务名称不能超过 100 字符');
    const timing = this.scheduleTiming(input);
    const duplicate = this.scheduleList.find((item) => item.botId === botId && !item.closedAt && !item.completedAt && item.prompt === input.prompt.trim() && item.cron === timing.cron && item.runAt === timing.runAt);
    if (duplicate) return { ...duplicate };
    return this.upsertSchedule({ id: newId('sched'), botId, prompt: input.prompt.trim(), title: input.title?.trim(), ...timing, enabled: true, createdAt: Date.now(), updatedAt: Date.now() });
  }

  updateSchedule(botId: string, id: string, patch: ScheduleUpdate): Schedule {
    const current = this.scheduleList.find((item) => item.id === id && item.botId === botId);
    if (!current) throw new Error('找不到属于当前 Bot 的任务，请先查询任务列表');
    if (!patch || !['update', 'pause', 'resume', 'close'].includes(patch.action ?? 'update')) throw new Error('不支持的任务操作');
    if (current.closedAt || current.completedAt) throw new Error('任务已关闭或已完成，需要时请创建新任务');
    const next = { ...current, updatedAt: Date.now() };
    if (patch.prompt !== undefined) {
      if (typeof patch.prompt !== 'string' || !patch.prompt.trim() || patch.prompt.length > 20000) throw new Error('任务指令不能为空且不能超过 20000 字符');
      next.prompt = patch.prompt.trim();
    }
    if (patch.title !== undefined) {
      if (typeof patch.title !== 'string' || patch.title.length > 100) throw new Error('任务名称不能超过 100 字符');
      next.title = patch.title.trim();
    }
    if (patch.cron !== undefined || patch.runAt !== undefined) Object.assign(next, this.scheduleTiming(patch));
    if (patch.action === 'pause') { next.enabled = false; next.nextRunAt = undefined; }
    if (patch.action === 'close') { next.enabled = false; next.closedAt = Date.now(); next.nextRunAt = undefined; }
    if (patch.action === 'resume') {
      Object.assign(next, this.scheduleTiming(next.kind === 'once' ? { runAt: next.runAt } : { cron: next.cron }));
      next.enabled = true;
    }
    if (!next.enabled) next.nextRunAt = undefined;
    return this.upsertSchedule(next);
  }

  upsertSchedule(schedule: Schedule): Schedule {
    const index = this.scheduleList.findIndex((item) => item.id === schedule.id);
    const next = this.listSchedules();
    if (index >= 0) next[index] = { ...schedule };
    else next.push({ ...schedule });
    this.persistSchedules(next);
    return { ...schedule };
  }

  removeSchedule(id: string): void {
    this.persistSchedules(this.scheduleList.filter((item) => item.id !== id));
  }
}
