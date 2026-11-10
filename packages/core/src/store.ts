import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  ApprovalPolicy,
  BotMetadataPatch,
  BotGroupAction,
  GroupChatAction,
  SidebarBotGroup,
  BotMarketState,
  BotMarketSubmission,
  CloudHostSettings,
  Conversation,
  Goal,
  MemoryFact,
  MemoryScopeSummary,
  ProjectState,
  ProjectStore,
  TodoList,
  Message,
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
  TelegramSettings,
  UiSettings,
  SkillConfig,
} from './types';
import { DEFAULT_SYSTEM_PROMPT } from './types';
import { newId, normalizeRemoteDirectory, safeJsonParse, sanitizeDirName } from './util';
import { MemoryLibrary, scopeDirName } from './memory-library';
import { MemoryStore, cosineSimilarity } from './memory-store';
import { embedTexts } from './embedding';
import { HistorySearch } from './history-search';
import { UsageLedger } from './usage';
import { nextCronTime } from './scheduler';
import { modelSettings, validateGeneration, validateModelSettings } from './generation';
import { remoteModelCatalog } from './model-catalog';
import { syncValue, type SyncRecord } from './sync';

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
  // Windows 上 AV / 索引器偶发短暂锁住目标文件导致 rename 失败（EPERM）。
  // 重试几次，避免高频持久化（测试、群聊、定时任务）偶发丢写。
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (attempt >= 4) throw error;
      const wait = 40 + Math.floor(Math.random() * 40) * (attempt + 1);
      const until = Date.now() + wait;
      while (Date.now() < until) { /* busy-wait 很短，不引入异步 */ }
    }
  }
}

export function defaultSettings(dataDir: string, localDirectory = path.join(dataDir, 'local-workspace')): AppSettings {
  const now = Date.now();
  // 出厂不预置任何模型供应商：默认指向某个厂商（或本机网关）时，没有密钥或服务没起来，
  // 首次发言必定报错。用户首次进入「设置 → 供应商」自行连接。
  const providerId = '';
  return {
    version: 1,
    userName: '',
    onboarding: { step: 0 },
    providers: [],
    bots: [
      {
        id: 'bot_default',
        name: '大肥鱼',
        handle: 'dafeiyu',
        avatar: { from: '#7aa2ff', to: '#c084fc', glyph: '鱼' },
        providerId,
        model: '',
        temperature: 0.7,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        approvalPolicy: 'never',
        tools: [],
        image: {
          aspect: '1:1',
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
      autoSuspendAfterSeconds: 1800,
      idleSuspendMinutes: 3,
      workspaceDir: path.join(dataDir, 'workspace'),
      remoteWorkspaceDir: '/data/home/moyubot',
      wakeOnDemand: true,
    },
    github: {},
    telegram: { enabled: false, token: '', allowedIds: [] },
    embedding: { enabled: true, baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
    workspaces: [
      { id: 'workspace_cloud', name: '云电脑工作区', kind: 'cloud', computerName: '共享云电脑', createdAt: now },
      { id: 'workspace_local', name: '本地工作区', kind: 'local', computerName: '本机 Windows', directory: localDirectory, createdAt: now },
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
  /** 记忆持久层：单个 SQLite 数据库（memories.db），含检索向量。 */
  private memoryDb!: MemoryStore;
  /** 历史消息全文索引（可重建的派生库）。 */
  readonly historySearch: HistorySearch;
  /** 旧版 Markdown 记忆库，仅在启动迁移时读取。 */
  private markdownLibraryRef?: MemoryLibrary;
  /** 测试可注入的向量函数；生产路径走 embedTexts + 配置的在线向量模型。 */
  private embedder?: (texts: string[]) => Promise<Float32Array[] | null>;
  /** 串行化的向量回填队列：避免并发打爆向量服务。 */
  private embedChain: Promise<void> = Promise.resolve();
  private embedCooldownUntil = 0;
  /** 向量回填的延后计时器；close() 时清掉，避免测试结束时还挂着定时器。 */
  private embedBackfillTimer?: ReturnType<typeof setTimeout>;
  /** close() 之后不再做任何落盘动作。 */
  private closed = false;
  private queryVectorCache = new Map<string, Float32Array>();
  /** 增量记忆整理检查点（按会话）：throughMessageId 之前的内容已提炼过。 */
  private memoryCheckpoints: Record<string, { throughMessageId: string; updatedAt: number; failures?: number }> = {};
  private scheduleList: Schedule[] = [];
  /** Conversation-scoped goals, kept apart from schedules so "edit the goal" never reads as "edit a task". */
  private goalList: Goal[] = [];
  private todoLists: TodoList[] = [];
  /** 项目状态（L2）：按 botId -> 项目名 -> ProjectState。 */
  private projects: ProjectStore = {};
  /** 项目自动更新检查点，按 botId 存。 */
  private autoProjectCheckpoints: Record<string, { lastRound: number; failures?: number; lastActiveProject?: string }> = {};
  /** 三段上下文快照，按会话 id 存于 context-usage.json（界面重启后仍能显示上次值；压缩后自动变小）。 */
  private contextUsage: Record<string, import('./types').ContextUsageSnapshot> = {};
  private scheduleListeners = new Set<(schedules: Schedule[]) => void>();

  constructor(dataDir: string, secrets?: SecretBox, options?: { localDirectory?: string; embedder?: (texts: string[]) => Promise<Float32Array[] | null> }) {
    this.dataDir = dataDir;
    this.secrets = secrets ?? new PlainSecretBox(dataDir);
    this.embedder = options?.embedder;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.dir('conversations'), { recursive: true });
    // 读本地 models.dev 缓存并后台刷新，用于补全未识别模型的上下文窗口。
    remoteModelCatalog.init(dataDir);

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
      const base = defaultSettings(dataDir, options?.localDirectory);
      this.settings = {
        ...base,
        ...parsed,
        cloud: { ...base.cloud, ...parsed.cloud, workspaceDir: parsed.cloud?.workspaceDir || base.cloud.workspaceDir },
        ui: { ...base.ui, ...parsed.ui },
        telegram: { ...base.telegram, ...parsed.telegram },
        // 显式保存的空数组表示"用户删光了供应商"，不要用出厂默认覆盖回去。
        providers: parsed.providers ?? base.providers,
        bots: parsed.bots?.length ? parsed.bots : base.bots,
        workspaces: parsed.workspaces?.length ? parsed.workspaces : base.workspaces,
        activeWorkspaceId: parsed.activeWorkspaceId ?? base.activeWorkspaceId,
        // Existing installs retain their setup; they can edit the profile in Settings.
        onboarding: parsed.onboarding ?? { step: 2, completedAt: Date.now() },
      };
      // Backfill fields added after a user's settings.json was written.
      this.settings.bots = this.settings.bots.map((bot) => ({
        ...base.bots[0]!,
        ...bot,
        // Retain the image ratio and discard retired cloud-script settings.
        image: { aspect: bot.image?.aspect ?? base.bots[0]!.image.aspect },
        avatar: { ...base.bots[0]!.avatar, ...bot.avatar },
        workspaceId: bot.workspaceId || 'workspace_cloud',
        // 旧的「全部允许」和「自动执行」行为完全一样，合并为 never（存量数据归一）。
        approvalPolicy: (bot.approvalPolicy === 'ask' ? 'ask' : 'never') as ApprovalPolicy,
      }));
    } else {
      this.settings = defaultSettings(dataDir, options?.localDirectory);
      this.persistSettings();
    }

    this.settings.ui.botGroups = this.listBotGroups();
    for (const workspace of this.settings.workspaces) {
      if (workspace.kind === 'cloud' && !workspace.botGroups) workspace.botGroups = this.settings.ui.botGroups;
      if (workspace.kind === 'local' && !workspace.directory) workspace.directory = path.join(dataDir, 'local-workspace');
    }
    if (!this.settings.workspaces.some((item) => item.id === this.settings.activeWorkspaceId)) this.settings.activeWorkspaceId = this.settings.workspaces[0]?.id;
    this.persistSettings();
    // 迁移存量本地技能到各 Bot 家目录（幂等；不破坏已绑定）。
    this.migrateLocalSkills();
    // 历史索引派生库需在 loadConversations 之前就绪（后者会用它回填）
    this.historySearch = new HistorySearch(path.join(dataDir, 'history.db'));
    this.loadConversations();
    this.sweepInterruptedMessages();
    for (const bot of this.settings.bots) this.botConversation(bot.id);
    // 对已存在的历史做一次索引回填（增量，幂等）
    this.backfillHistoryIndex();
    this.usage = new UsageLedger(dataDir);
    this.usage.backfill(this.conversations.values(), this.settings.bots);
    this.memoryDb = new MemoryStore(path.join(dataDir, 'memories.db'));
    this.loadMemories();
    this.loadMemoryCheckpoints();
    this.scheduleEmbeddingBackfill();
    this.loadSchedules();
    this.loadGoals();
    this.loadTodos();
    this.loadProjects();
    this.loadContextUsage();
  }

  private dir(name: string): string {
    return path.join(this.dataDir, name);
  }

  persistSettings(): void {
    writeJsonAtomic(path.join(this.dataDir, 'settings.json'), this.settings);
  }

  updateSettings(patch: SettingsPatch): AppSettings {
    for (const provider of patch.providers ?? []) {
      validateModelSettings(provider, provider.kind);
      for (const name of Object.keys(provider.modelSettings ?? {})) validateModelSettings(modelSettings(provider, name), provider.kind);
    }
    for (const bot of patch.bots ?? []) validateGeneration(bot.generation);
    if (patch.userName !== undefined) {
      if (typeof patch.userName !== 'string' || !patch.userName.trim() || [...patch.userName.trim()].length > 40 || /[\x00-\x1f\x7f]/.test(patch.userName)) throw new Error('用户名需要 1–40 个字符，不能包含换行或控制字符');
      patch = { ...patch, userName: patch.userName.trim() };
    }
    if (patch.cloud?.remoteWorkspaceDir !== undefined) patch = { ...patch, cloud: { ...patch.cloud, remoteWorkspaceDir: normalizeRemoteDirectory(patch.cloud.remoteWorkspaceDir) } };
    const embeddingChanged = patch.embedding !== undefined;
    if (patch.embedding) {
      const embedding = { ...this.settings.embedding, ...patch.embedding };
      if (embedding.enabled) {
        if (!/^https?:\/\//i.test(embedding.baseUrl)) throw new Error('向量模型 Base URL 需要 http(s) 地址');
        if (!embedding.model.trim()) throw new Error('向量模型名称不能为空');
      }
      patch = { ...patch, embedding };
    }
    this.settings = {
      ...this.settings,
      ...patch,
      bots: patch.bots ? patch.bots.map((bot) => ({ ...bot, image: { aspect: bot.image?.aspect ?? '1:1' } })) : this.settings.bots,
      cloud: patch.cloud ? { ...this.settings.cloud, ...patch.cloud } : this.settings.cloud,
      ui: patch.ui ? { ...this.settings.ui, ...patch.ui } : this.settings.ui,
      telegram: patch.telegram ? { ...this.settings.telegram, ...patch.telegram } : this.settings.telegram,
      embedding: patch.embedding ? { ...this.settings.embedding, ...patch.embedding } : this.settings.embedding,
    };
    this.settings.ui.botGroups = this.listBotGroups();
    this.persistSettings();
    if (embeddingChanged) {
      // 配置变化（换模型/换地址/开关）后：清除冷却与查询缓存，重新回填向量。
      this.embedCooldownUntil = 0;
      this.queryVectorCache.clear();
      this.beginEmbeddingBackfill();
    }
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
    validateGeneration(bot.generation);
    const existing = this.getBot(bot.id);
    bot = { ...bot, image: { aspect: bot.image?.aspect ?? '1:1' }, workspaceId: bot.workspaceId ?? existing?.workspaceId ?? 'workspace_cloud' };
    if (!this.settings.workspaces.some((item) => item.id === bot.workspaceId)) throw new Error('工作区不存在');
    for (const id of bot.mcpServerIds ?? []) if (!this.settings.mcpServers?.some(s => s.id === id && s.workspaceId === bot.workspaceId)) throw new Error('MCP 服务不属于此 Bot 的工作区');
    for (const id of bot.skillIds ?? []) if (!this.settings.skills?.some(s => s.id === id && s.workspaceId === bot.workspaceId)) throw new Error('技能不属于此 Bot 的工作区');
    if (existing && (existing.workspaceId ?? 'workspace_cloud') !== bot.workspaceId) throw new Error('现有 Bot 不能直接转移工作区，请创建独立 Bot');
    const index = this.settings.bots.findIndex((item) => item.id === bot.id);
    if (index >= 0) this.settings.bots[index] = bot;
    else this.settings.bots.push(bot);
    this.settings.ui.botGroups = this.listBotGroups();
    this.persistSettings();
    return bot;
  }

  /** Bot 专属工作目录名（稳定、跨平台安全）：文件工具的相对路径与命令 cwd 都锚定在这里，
   *  实现 Bot 间文件隔离。首次调用推导并落盘；之后改名不影响目录。不在 settings 里的临时 Bot（子代理）只推导不落盘。 */
  botDirName(botId: string): string {
    const bot = this.settings.bots.find((item) => item.id === botId);
    if (bot?.dirName) return bot.dirName;
    const base = sanitizeDirName(bot?.name || botId);
    const taken = new Set<string>();
    for (const other of this.settings.bots) {
      if (other.id === botId) continue;
      taken.add(other.dirName ?? sanitizeDirName(other.name));
    }
    const suffix = botId.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'x';
    const name = taken.has(base) ? `${base}-${suffix}` : base;
    if (bot) this.upsertBot({ ...bot, dirName: name });
    return name;
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

  /** 我上传的模板记录（只记元信息，不存模板本体）。 */
  botMarket(): BotMarketState {
    return this.settings.botMarket ?? { submissions: [] };
  }

  /** 记录一次模板上传；同 handle 去重（保留最新版本）。 */
  recordTemplateSubmission(submission: BotMarketSubmission): BotMarketState {
    const current = this.botMarket();
    const rest = current.submissions.filter((item) => item.handle !== submission.handle);
    const next: BotMarketState = { submissions: [...rest, { ...submission, submittedAt: Date.now() }] };
    this.settings = { ...this.settings, botMarket: next };
    this.persistSettings();
    return next;
  }

  removeTemplateSubmission(handle: string): BotMarketState {
    const next: BotMarketState = { submissions: this.botMarket().submissions.filter((item) => item.handle !== handle) };
    this.settings = { ...this.settings, botMarket: next };
    this.persistSettings();
    return next;
  }

  /** 迁移存量本地技能：把仍在旧共享库 `dataDir/skills/<id>` 的技能，复制到拥有它的 Bot 的家目录 `local-artifacts/<botDir>/.moyu/skills/<name>`，
   *  并更新 `SkillConfig.directory`。复制而非移动：新位置就绪后指向它，旧目录保留以免误删。幂等。 */
  private migrateLocalSkills(): void {
    const oldRoot = path.join(this.dataDir, 'skills');
    if (!fs.existsSync(oldRoot)) return;
    const localDir = path.join(this.dataDir, 'local-artifacts');
    let changed = false;
    const migrated: SkillConfig[] = (this.settings.skills ?? []).map((skill) => {
      if (skill.workspaceId !== 'workspace_local') return skill;
      // 只迁移仍在旧共享库目录下的技能（已在新位置或第三方位置的跳过）。
      const oldDir = path.join(oldRoot, skill.id);
      if (skill.directory !== oldDir && !fs.existsSync(oldDir)) return skill;
      // 找第一个绑定该技能的 Bot 作为归属；无人绑定时保留共享库。
      const owner = this.settings.bots.find((bot) => (bot.skillIds ?? []).includes(skill.id) && (bot.workspaceId ?? 'workspace_cloud') === 'workspace_local');
      if (!owner) return skill;
      const botDir = this.botDirName(owner.id);
      const target = path.join(localDir, botDir, '.moyu', 'skills', skill.name);
      try {
        if (!fs.existsSync(target)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.cpSync(skill.directory, target, { recursive: true, dereference: false });
        }
        if (!fs.existsSync(path.join(target, 'SKILL.md'))) return skill; // 校验迁移完整
        changed = true;
        return { ...skill, directory: target };
      } catch {
        return skill; // 迁移失败保留原位置
      }
    });
    if (changed) {
      this.settings = { ...this.settings, skills: migrated };
      this.persistSettings();
    }
  }

  getProvider(providerId: string) {
    return this.settings.providers.find((provider) => provider.id === providerId);
  }

  // ----- conversations -----
  /** 启动清扫：上次运行被中断（进程退出/崩溃）留下的 streaming 消息不可能再有下文，
   *  统一标记为失败，避免界面永远显示"正在思考/正在回复"。 */
  private sweepInterruptedMessages(): void {
    for (const conversation of this.conversations.values()) {
      let dirty = false;
      for (const message of conversation.messages) {
        if (!message.streaming) continue;
        message.streaming = false;
        message.error = message.error ?? '上次运行被中断，此回复未完成';
        dirty = true;
      }
      if (dirty && !conversation.subagent) this.saveConversation(conversation.id);
    }
  }

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
      .filter((conv) => !conv.mergedInto && !conv.deletedAt && !conv.subagent && (!botId || conv.botId === botId))
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
    if (conv?.deletedAt) return undefined;
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

  setGroupChatsCollapsed(workspaceId: string, collapsed: boolean): AppSettings {
    if (typeof collapsed !== 'boolean') throw new Error('无效的折叠状态');
    if (!this.settings.workspaces.some((item) => item.id === workspaceId)) throw new Error('工作区不存在');
    const previous = this.settings;
    try { return this.updateSettings({ workspaces: this.settings.workspaces.map((item) => item.id === workspaceId ? { ...item, groupChatsCollapsed: collapsed } : item) }); }
    catch (error) { this.settings = previous; throw error; }
  }

  updateGroupChat(id: string, action: GroupChatAction): Conversation {
    const current = this.getConversation(id);
    if (!current?.group) throw new Error('群聊不存在');
    const workspaceId = current.workspaceId ?? 'workspace_cloud';
    if (action.type === 'move') {
      if (!['up', 'down'].includes(action.direction)) throw new Error('无效的移动方向');
      const workspace = this.settings.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) throw new Error('工作区不存在');
      const chats = this.listConversations().filter((item) => item.group && item.workspaceId === workspaceId);
      const existing = workspace.groupChatOrder ?? [];
      const order = [...new Set([...existing.filter((item) => chats.some((chat) => chat.id === item)), ...chats.map((item) => item.id)])];
      const index = order.indexOf(id), target = index + (action.direction === 'up' ? -1 : 1);
      if (target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      const previous = this.settings;
      try { this.updateSettings({ workspaces: this.settings.workspaces.map((item) => item.id === workspaceId ? { ...item, groupChatOrder: order } : item) }); }
      catch (error) { this.settings = previous; throw error; }
      return current;
    }
    let next: Conversation;
    if (action.type === 'edit') {
      const title = action.title.trim(), ids = [...new Set(action.memberBotIds)];
      if (!title || title.length > 60) throw new Error('群聊名字需要 1–60 个字符');
      if (ids.length < 2 || ids.length > 12) throw new Error('请选择 2–12 个 Bot');
      if (ids.some((member) => !this.getBot(member))) throw new Error('群成员中的 Bot 不存在');
      if (ids.some((member) => (this.getBot(member)!.workspaceId ?? 'workspace_cloud') !== workspaceId)) throw new Error('不能跨工作区添加群成员');
      next = { ...current, title, group: { ...current.group, memberBotIds: ids }, updatedAt: Date.now() };
    } else if (action.type === 'delete') {
      next = { ...current, deletedAt: Date.now() };
    } else throw new Error('无效的群聊操作');
    this.conversations.set(id, next);
    try { this.saveConversation(id); }
    catch (error) { this.conversations.set(id, current); throw error; }
    return next;
  }

  botConversation(botId: string): Conversation {
    if (!this.getBot(botId)) throw new Error('Bot 不存在');
    const existing = [...this.conversations.values()]
      // Sub-agent scratch threads share the bot's id but must never be merged into
      // the bot's single durable thread — that would push throwaway tool output
      // into the user's real chat history.
      .filter((conv) => conv.botId === botId && !conv.mergedInto && !conv.subagent)
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

  /**
   * Scratch conversation for a sub-agent. It is registered in memory only, so
   * appendMessage/getConversation work unchanged, while saveConversation,
   * listConversations and syncSnapshot all skip it. Nothing reaches disk or the
   * phone; the parent's tool result is the only durable trace.
   */
  createSubagentConversation(botId: string, task: string, depth: number, parentConversationId: string): Conversation {
    const bot = this.getBot(botId);
    if (!bot) throw new Error('Bot 不存在');
    const id = newId('sub');
    const conv: Conversation = {
      id,
      botId,
      workspaceId: bot.workspaceId ?? 'workspace_cloud',
      title: `子任务：${task.slice(0, 40)}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subagent: { task, depth, parentConversationId },
    };
    this.conversations.set(id, conv);
    this.saveConversation(id);
    // Bounded memory: keep the newest scratch threads for drill-in and drop the rest.
    // 16 instead of 8 so continued/forked sub-agents survive longer in-process.
    const scratch = [...this.conversations.values()].filter((item) => item.subagent).sort((a, b) => a.createdAt - b.createdAt);
    for (const stale of scratch.slice(0, Math.max(0, scratch.length - 16))) this.conversations.delete(stale.id);
    return conv;
  }

  /** 子代理会话清单（用于 tool-jobs 与续聊入口），按最近更新排序；不含已删除。 */
  listSubagents(parentConversationId?: string): Conversation[] {
    return [...this.conversations.values()]
      .filter((conv) => conv.subagent && !conv.deletedAt && (!parentConversationId || conv.subagent!.parentConversationId === parentConversationId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
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
    try { this.historySearch.indexMessage(message, conversationId); } catch { /* 索引失败不影响会话主流程 */ }
    return conv;
  }

  /**
   * Plan mode is conversation-scoped: two Bots, two independent modes, and the default
   * state is not written to disk at all (an absent `mode` means execute).
   */
  setConversationMode(id: string, mode: 'execute' | 'plan', plan?: Conversation['plan']): Conversation {
    const conv = this.getConversation(id);
    if (!conv) throw new Error('会话不存在');
    if (conv.subagent) throw new Error('子智能体的临时会话不支持切换模式');
    conv.mode = mode === 'plan' ? 'plan' : undefined;
    if (plan) conv.plan = plan;
    conv.updatedAt = Date.now();
    this.saveConversation(id);
    return conv;
  }

  setConversationAutonomy(id: string, autonomy: 'turn' | 'until_done'): Conversation {
    const conv = this.getConversation(id);
    if (!conv) throw new Error('会话不存在');
    if (conv.subagent) throw new Error('子智能体的临时会话不支持切换续航');
    conv.autonomy = autonomy === 'until_done' ? 'until_done' : undefined;
    conv.updatedAt = Date.now();
    this.saveConversation(id);
    return conv;
  }

  saveConversation(id: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;
    // Sub-agent threads persist to disk so they can be continued after a restart,
    // but sync/listConversations still exclude them (they are private scratch space).
    writeJsonAtomic(path.join(this.dir('conversations'), `${id}.json`), conv);
  }

  deleteConversation(id: string): void {
    this.conversations.delete(id);
    const file = path.join(this.dir('conversations'), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    try { this.historySearch.removeConversation(id); } catch { /* noop */ }
  }

  /** 对已存在的会话历史增量回填搜索索引（启动时调用，幂等）。 */
  private backfillHistoryIndex(): void {
    for (const [id, conv] of this.conversations) {
      if (conv.subagent) continue;
      for (const message of conv.messages) {
        try { this.historySearch.indexMessage(message, id); } catch { /* 忽略单条失败 */ }
      }
    }
  }

  /** 历史消息全文检索（Timeline）：查询过去真实发生过的对话。scopeId 为空则检索所有。 */
  searchHistory(query: string, options: { conversationId?: string; limit?: number; since?: number; before?: number } = {}): import('./history-search').HistoryHit[] {
    return this.historySearch.search(query, options);
  }

  // ----- memories -----
  /** Portable data only; importing data never executes agents or schedules. */
  syncSnapshot(): Omit<SyncRecord, 'revision'>[] {
    const records: Omit<SyncRecord, 'revision'>[] = [];
    const add = (collection: string, id: string, value: Record<string, any>) => records.push({ collection, id, value: syncValue(collection, value) });
    for (const bot of this.settings.bots) add('bots', bot.id, bot);
    for (const conv of this.conversations.values()) {
      if (conv.mergedInto || conv.subagent) continue; // 子智能体会话不外传：手机侧看不到、也不会写进对端历史
      add('conversations', conv.id, conv);
      for (const message of conv.messages) add('messages', message.id, { ...message, conversationId: conv.id });
    }
    for (const memory of this.memories) add('memories', memory.id, memory);
    for (const schedule of this.scheduleList) add('schedules', schedule.id, schedule);
    if (this.settings.userName) add('profile', 'user', { userName: this.settings.userName });
    return records;
  }

  applySyncRecords(records: SyncRecord[]): void {
    const valid = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(id);
    let settingsChanged = false;
    for (const record of [...records].sort((a,b) => (a.collection === 'messages' ? 1 : 0) - (b.collection === 'messages' ? 1 : 0))) {
      if (!valid(record.id)) continue;
      const value = syncValue(record.collection, record.value);
      if (record.collection === 'bots') {
        const previous = this.getBot(record.id);
        if (!value) { this.settings.bots = this.settings.bots.filter(b => b.id !== record.id); settingsChanged = true; continue; }
        if (typeof value.name !== 'string' || typeof value.model !== 'string') continue;
        const base = previous || { ...defaultSettings(this.dataDir).bots[0]!, id: record.id, tools: [], approvalPolicy: 'never' as const, wakeOnTask: false };
        const workspaceId = this.settings.workspaces.some(w => w.id === value.workspaceId) ? value.workspaceId : 'workspace_cloud';
        const next = { ...base, ...value, id: record.id, workspaceId, avatar: { ...base.avatar, ...value.avatar } } as AppSettings['bots'][number];
        this.settings.bots = [...this.settings.bots.filter(b => b.id !== record.id), next]; settingsChanged = true;
      } else if (record.collection === 'conversations') {
        if (!value) { this.deleteConversation(record.id); continue; }
        if (!valid(value.botId) || typeof value.title !== 'string' || !Number.isFinite(value.createdAt)) continue;
        const previous = this.conversations.get(record.id);
        // Active agents hold this object while awaiting model responses. Replacing
        // it here loses newly generated context and writes stale data on save.
        if (previous) Object.assign(previous, value, { id: record.id });
        else this.conversations.set(record.id, { ...value, id: record.id, messages: [] } as unknown as Conversation);
        this.saveConversation(record.id);
      } else if (record.collection === 'messages') {
        if (!value) {
          for (const conv of this.conversations.values()) if (conv.messages.some(m => m.id === record.id)) { conv.messages = conv.messages.filter(m => m.id !== record.id); this.saveConversation(conv.id); }
          continue;
        }
        if (!value || !valid(value.conversationId) || typeof value.content !== 'string' || !Number.isFinite(value.createdAt)) continue;
        const conv = this.conversations.get(value.conversationId); if (!conv) continue;
        const previous = conv.messages.find(m => m.id === record.id);
        const { conversationId: _unused, ...portable } = value;
        const next = { ...previous, ...portable, id: record.id } as Message;
        conv.messages = [...conv.messages.filter(m => m.id !== record.id), next].sort((a,b) => a.createdAt-b.createdAt || a.id.localeCompare(b.id));
        conv.updatedAt = Math.max(conv.updatedAt, next.createdAt); this.saveConversation(conv.id);
      } else if (record.collection === 'memories') {
        if (value && (typeof value.text !== 'string' || !valid(value.botId))) continue;
        const previous = this.memories.find(m => m.id === record.id);
        this.memories = this.memories.filter(m => m.id !== record.id);
        if (value) {
          const fact = { ...value, id: record.id, pinned: !!value.pinned, createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now() } as MemoryFact;
          this.memories.push(fact);
          this.memoryDb.upsert(fact);
          this.enqueueEmbedding([fact.id]);
        } else if (previous) this.memoryDb.remove(record.id);
      } else if (record.collection === 'profile' && typeof value?.userName === 'string' && value.userName.trim()) {
        this.settings.userName = value.userName.slice(0,40); settingsChanged = true;
      }
      // Mobile displays schedule status; this device remains the execution owner.
    }
    if (settingsChanged) this.persistSettings();
  }

  // ----- 长期记忆：SQLite 单库（memories.db）承载全部 Bot / 群聊记忆与检索向量 -----
  // 旧版「每条一个 Markdown 文件」的资料库与 memories.json 仅在首次迁移时读取，随后归档不再使用。

  private markdownLibrary(): MemoryLibrary {
    return (this.markdownLibraryRef ??= new MemoryLibrary(path.join(this.dataDir, 'memories')));
  }

  private memoryScopeTitle(scopeId: string): string {
    const bot = this.getBot(scopeId);
    if (bot) return `${bot.name} 的记忆`;
    const conversation = this.conversations.get(scopeId);
    if (conversation?.group) return `群聊「${conversation.title}」的记忆`;
    return `${scopeId} 的记忆`;
  }

  private loadMemories(): void {
    this.migrateLegacyMemories();
    this.memories = this.memoryDb.list();
  }

  // ----- 增量记忆整理检查点 -----
  private loadMemoryCheckpoints(): void {
    const file = path.join(this.dataDir, 'memory-checkpoints.json');
    if (!fs.existsSync(file)) return;
    this.memoryCheckpoints = safeJsonParse<Record<string, { throughMessageId: string; updatedAt: number; failures?: number }>>(fs.readFileSync(file, 'utf8'), {});
  }

  getMemoryCheckpoint(conversationId: string): { throughMessageId: string; updatedAt: number; failures?: number } | undefined {
    return this.memoryCheckpoints[conversationId];
  }

  setMemoryCheckpoint(conversationId: string, checkpoint: { throughMessageId: string; updatedAt: number; failures?: number }): void {
    this.memoryCheckpoints[conversationId] = checkpoint;
    writeJsonAtomic(path.join(this.dataDir, 'memory-checkpoints.json'), this.memoryCheckpoints);
  }

  /** 一次性把旧版 memories.json 与 Markdown 记忆库迁入 SQLite，之后旧目录改名归档。 */
  private migrateLegacyMemories(): void {
    if (this.memoryDb.count() > 0) return;
    const facts: MemoryFact[] = [];
    const seen = new Set<string>();
    const push = (fact: MemoryFact) => {
      if (!fact || typeof fact.id !== 'string' || typeof fact.botId !== 'string' || typeof fact.text !== 'string' || seen.has(fact.id)) return;
      seen.add(fact.id);
      facts.push({ ...fact, pinned: !!fact.pinned, createdAt: Number.isFinite(fact.createdAt) ? fact.createdAt : Date.now(), source: fact.source === 'automatic' ? 'automatic' : 'manual' });
    };
    const jsonPath = path.join(this.dataDir, 'memories.json');
    if (fs.existsSync(jsonPath)) {
      for (const fact of safeJsonParse<MemoryFact[]>(fs.readFileSync(jsonPath, 'utf8'), [])) push(fact);
      try { fs.renameSync(jsonPath, `${jsonPath}.migrated`); } catch { /* 改名失败只会导致下次启动重复导入相同内容 */ }
    }
    const library = this.markdownLibrary();
    for (const scopeId of library.listScopes()) {
      const { facts: scopeFacts, adopted } = library.loadScope(scopeId);
      // 手工放进目录、没有元数据的 Markdown 文件同样收编为正式记忆。
      for (const item of adopted) {
        try { fs.unlinkSync(item.file); } catch { /* 无碍 */ }
        scopeFacts.push(item.fact);
      }
      for (const fact of scopeFacts) push(fact);
    }
    if (!facts.length) return;
    for (const fact of facts) this.memoryDb.upsert(fact);
    this.memories = facts;
    const legacyDir = path.join(this.dataDir, 'memories');
    try { if (fs.existsSync(legacyDir)) fs.renameSync(legacyDir, path.join(this.dataDir, 'memories-md-archive')); } catch { /* 归档失败无碍：旧目录不再被读取 */ }
  }

  listMemories(botId?: string): MemoryFact[] {
    return this.memories.filter((fact) => !botId || fact.botId === botId);
  }

  /** 记忆查重的归一化键：全角半角、大小写、句末标点不影响判重。 */
  private memoryDedupKey(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s。.!！]+/gu, '');
  }

  addMemory(botId: string, text: string, pinned = false, source: MemoryFact['source'] = 'manual'): MemoryFact {
    const normalized = text.trim();
    const existing = this.memories.find((fact) => fact.botId === botId && this.memoryDedupKey(fact.text) === this.memoryDedupKey(normalized));
    if (existing) {
      if (pinned && !existing.pinned) {
        existing.pinned = true;
        this.memoryDb.upsert(existing);
      }
      return existing;
    }
    const fact: MemoryFact = { id: newId('mem'), botId, text: normalized, pinned, source, createdAt: Date.now() };
    this.memories.push(fact);
    this.memoryDb.upsert(fact);
    this.enqueueEmbedding([fact.id]);
    return fact;
  }

  /** 手动编辑正文或固定 / 取消固定。正文改动后旧向量作废，重新回填。 */
  updateMemory(id: string, patch: { text?: string; pinned?: boolean }): MemoryFact {
    const fact = this.memories.find((item) => item.id === id);
    if (!fact) throw new Error('这条记忆不存在或已被删除');
    const next: MemoryFact = { ...fact };
    if (patch.pinned !== undefined) next.pinned = !!patch.pinned;
    if (patch.text !== undefined) {
      const normalized = patch.text.trim();
      if (!normalized) throw new Error('记忆内容不能为空');
      const duplicate = this.memories.find((item) => item.id !== id && item.botId === fact.botId && this.memoryDedupKey(item.text) === this.memoryDedupKey(normalized));
      if (duplicate) throw new Error('这个范围里已有一条相同内容的记忆');
      next.text = normalized;
    }
    if (next.text === fact.text && next.pinned === fact.pinned) return fact;
    this.memories[this.memories.indexOf(fact)] = next;
    this.memoryDb.upsert(next);
    if (next.text !== fact.text) {
      this.memoryDb.clearEmbedding(next.id);
      this.enqueueEmbedding([next.id]);
    }
    return next;
  }

  /** 设置页记忆总览：每个 Bot（含没有记忆的）与有记忆的群聊一行统计；传 workspaceId 时按工作区过滤。 */
  memoryScopeSummaries(workspaceId?: string): MemoryScopeSummary[] {
    const stats = new Map<string, { total: number; pinned: number; latestAt: number }>();
    for (const fact of this.memories) {
      const entry = stats.get(fact.botId) ?? { total: 0, pinned: 0, latestAt: 0 };
      entry.total += 1;
      if (fact.pinned) entry.pinned += 1;
      entry.latestAt = Math.max(entry.latestAt, fact.createdAt);
      stats.set(fact.botId, entry);
    }
    const inWorkspace = (id: string | undefined) => !workspaceId || (id ?? 'workspace_cloud') === workspaceId;
    const summaries: MemoryScopeSummary[] = this.settings.bots
      .filter((bot) => inWorkspace(bot.workspaceId))
      .map((bot) => ({ scopeId: bot.id, title: bot.name, kind: 'bot' as const, ...(stats.get(bot.id) ?? { total: 0, pinned: 0, latestAt: 0 }) }));
    for (const conversation of this.conversations.values()) {
      const entry = conversation.group && stats.get(conversation.id);
      if (!entry || conversation.mergedInto || conversation.deletedAt || !inWorkspace(conversation.workspaceId)) continue;
      summaries.push({ scopeId: conversation.id, title: conversation.title, kind: 'group', ...entry });
    }
    if (!workspaceId) {
      // 只在全量视图里兜底展示"找不到归属"的范围（Bot 已删除等），避免数据不可见；工作区过滤视图跳过。
      for (const [scopeId, entry] of stats) {
        if (!summaries.some((item) => item.scopeId === scopeId)) summaries.push({ scopeId, title: scopeId, kind: 'bot', ...entry });
      }
    }
    return summaries.sort((a, b) => b.latestAt - a.latestAt || a.title.localeCompare(b.title, 'zh-CN'));
  }

  /** 记忆存储位置：单个 SQLite 数据库文件。 */
  memoryLibraryPath(): string {
    return path.join(this.dataDir, 'memories.db');
  }

  removeMemory(id: string): void {
    const fact = this.memories.find((item) => item.id === id);
    this.memories = this.memories.filter((item) => item.id !== id);
    if (!fact) return;
    this.memoryDb.remove(id);
  }

  // ----- 向量召回：回填 + 关键词 / 语义混合检索 -----

  private embeddingApiKey(): string {
    return this.secrets.get('embedding:key') ?? '';
  }

  private runEmbedder(texts: string[]): Promise<Float32Array[] | null> {
    if (this.embedder) return this.embedder(texts);
    return embedTexts(this.settings.embedding, this.embeddingApiKey(), texts).catch(() => null);
  }

  /** 立即为指定记忆生成向量；返回是否全部成功（失败进入 60 秒冷却）。 */
  private async embedNow(items: { id: string; text: string }[]): Promise<boolean> {
    try {
      const vectors = await this.runEmbedder(items.map((item) => item.text));
      if (!vectors) return false;
      const model = this.settings.embedding?.model ?? '';
      items.forEach((item, index) => {
        const vector = vectors[index];
        if (vector) this.memoryDb.setEmbedding(item.id, vector, model);
      });
      return true;
    } catch {
      this.embedCooldownUntil = Date.now() + 60_000;
      return false;
    }
  }

  private enqueueEmbedding(ids: string[]): void {
    const config = this.settings.embedding;
    if (!config?.enabled || (!this.embedder && !this.embeddingApiKey())) return;
    this.embedChain = this.embedChain.then(async () => {
      if (Date.now() < this.embedCooldownUntil) return;
      const items = ids
        .map((id) => this.memories.find((fact) => fact.id === id))
        .filter((fact): fact is MemoryFact => !!fact)
        .map((fact) => ({ id: fact.id, text: fact.text }));
      if (items.length) await this.embedNow(items);
    }).catch(() => {});
  }

  /** 启动后 / 配置变化后分批补算缺失向量；失败自动冷却，之后由下次触发续跑。返回队列以便测试等待。 */
  beginEmbeddingBackfill(): Promise<void> {
    this.embedChain = this.embedChain.then(async () => {
      const config = this.settings.embedding;
      if (!config?.enabled || (!this.embedder && !this.embeddingApiKey())) return;
      for (let batch = 0; batch < 128; batch++) {
        if (Date.now() < this.embedCooldownUntil) return;
        const pending = this.memoryDb.pendingEmbeddings(config.model, 16);
        if (!pending.length) return;
        if (!(await this.embedNow(pending))) return;
      }
    }).catch(() => {});
    return this.embedChain;
  }

  private scheduleEmbeddingBackfill(): void {
    this.embedBackfillTimer = setTimeout(() => { this.embedBackfillTimer = undefined; this.beginEmbeddingBackfill(); }, 3000);
    this.embedBackfillTimer.unref?.();
  }

  /**
   * 释放资源：关闭 SQLite 句柄、停掉后台计时器。
   * Windows 不允许删除仍被打开的 memories.db，所以测试/切换数据目录前必须先 close()。
   * 可重复调用。
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.embedBackfillTimer) { clearTimeout(this.embedBackfillTimer); this.embedBackfillTimer = undefined; }
    this.scheduleListeners.clear();
    // 每个 SQLite 句柄都要关：漏一个，Windows 上就删不掉对应的 .db 文件（测试会 EBUSY）。
    for (const db of [this.memoryDb, this.historySearch]) {
      try { db?.close(); } catch { /* 已经关闭过：忽略 */ }
    }
  }

  private async embedQuery(query: string): Promise<Float32Array | null> {
    const cached = this.queryVectorCache.get(query);
    if (cached) return cached;
    if (Date.now() < this.embedCooldownUntil) return null;
    const vectors = await this.runEmbedder([query]);
    if (!vectors?.[0]) return null;
    if (this.queryVectorCache.size > 64) this.queryVectorCache.clear();
    this.queryVectorCache.set(query, vectors[0]!);
    return vectors[0]!;
  }

  /**
   * 混合检索：关键词命中 ∪ 语义相似（余弦 ≥ 0.4），按 关键词×2 + 语义×4 排序。
   * 向量服务不可用时自动退化为纯关键词检索；两种方式都无命中则返回空。
   */
  async searchMemories(scopeId: string, query: string, limit = 8): Promise<string[]> {
    const facts = this.listMemories(scopeId);
    if (!facts.length) return [];
    const terms = query.trim().normalize('NFKC').toLowerCase().split(/[\s,，。.；;、!！?？]+/).filter(Boolean);
    const queryVector = await this.embedQuery(query);
    const vectors = queryVector ? this.memoryDb.embeddings(this.settings.embedding?.model ?? '') : null;
    const scored = facts.map((fact) => {
      const text = fact.text.normalize('NFKC').toLowerCase();
      const keywordHits = terms.filter((term) => text.includes(term)).length;
      const similarity = queryVector && vectors ? cosineSimilarity(queryVector, vectors.get(fact.id) ?? new Float32Array()) : 0;
      const semantic = similarity >= 0.4 ? similarity : 0;
      return { fact, score: keywordHits * 2 + semantic * 4 + (fact.pinned ? 0.2 : 0), matched: keywordHits > 0 || semantic > 0 };
    }).filter((item) => item.matched)
      .sort((a, b) => b.score - a.score || b.fact.createdAt - a.fact.createdAt)
      .slice(0, limit);
    if (scored.length) {
      const now = Date.now();
      for (const item of scored) this.memoryDb.setLastUsed(item.fact.id, now);
      return scored.map((item) => item.fact.text);
    }
    if (!queryVector || !vectors) return [];
    // 向量可用但阈值内无命中：放宽取最相近的 3 条，保证召回不至于空手而归
    return facts.map((fact) => ({ fact, similarity: cosineSimilarity(queryVector, vectors.get(fact.id) ?? new Float32Array()) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map((item) => item.fact.text);
  }

  /** 把当前全部记忆导出为每个范围一个 Markdown 文件，返回导出目录（人工浏览 / 备份用）。 */
  exportMemoriesMarkdown(): string {
    const dir = path.join(this.dataDir, 'memories-export');
    fs.mkdirSync(dir, { recursive: true });
    for (const scopeId of new Set(this.memories.map((fact) => fact.botId))) {
      const facts = this.listMemories(scopeId).sort((a, b) => a.createdAt - b.createdAt);
      const lines: string[] = [`# ${this.memoryScopeTitle(scopeId)}`, '', `导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${facts.length} 条`, ''];
      for (const fact of facts) {
        const firstLine = (fact.text.split(/\r?\n/, 1)[0] || '').slice(0, 40) || '未命名记忆';
        lines.push('---', '', `## ${fact.pinned ? '📌 ' : ''}${firstLine}`);
        lines.push(`> id: ${fact.id} · ${fact.source === 'automatic' ? '对话整理' : '主动记录'} · ${new Date(fact.createdAt).toLocaleString('zh-CN')}`, '', fact.text, '');
      }
      fs.writeFileSync(path.join(dir, `${scopeDirName(scopeId)}.md`), lines.join('\n'), 'utf8');
    }
    return dir;
  }

  // ----- cloud capability inventory (persisted so restarts show the last-known list instantly) -----
  readCloudInventory(): { at: number; servers: { id: string; name: string; transport: string; command?: string; url?: string; source: string }[]; skills: { id: string; name: string; path: string; source: string }[] } | undefined {
    const file = path.join(this.dataDir, 'cloud-inventory.json');
    if (!fs.existsSync(file)) return undefined;
    return safeJsonParse<ReturnType<Store['readCloudInventory']>>(fs.readFileSync(file, 'utf8'), undefined);
  }

  writeCloudInventory(inventory: NonNullable<ReturnType<Store['readCloudInventory']>>): void {
    writeJsonAtomic(path.join(this.dataDir, 'cloud-inventory.json'), inventory);
  }

  // ----- context usage (three-segment snapshot persisted per conversation) -----
  private loadContextUsage(): void {
    const file = path.join(this.dataDir, 'context-usage.json');
    if (!fs.existsSync(file)) return;
    this.contextUsage = safeJsonParse<Record<string, import('./types').ContextUsageSnapshot>>(fs.readFileSync(file, 'utf8'), {});
  }

  getContextUsage(conversationId: string): import('./types').ContextUsageSnapshot | undefined {
    return this.contextUsage[conversationId];
  }

  /** prepareContext 每步调用；值没实质变化就不写盘，压缩后历史段变小会自动覆盖。 */
  recordContextUsage(conversationId: string, usage: Omit<import('./types').ContextUsageSnapshot, 'updatedAt'>): void {
    const previous = this.contextUsage[conversationId];
    const stable = previous
      && previous.systemTokens === usage.systemTokens
      && previous.toolTokens === usage.toolTokens
      && previous.historyTokens === usage.historyTokens
      && previous.windowTokens === usage.windowTokens
      && previous.reserveTokens === usage.reserveTokens;
    if (stable) return;
    this.contextUsage = { ...this.contextUsage, [conversationId]: { ...usage, updatedAt: Date.now() } };
    // 用量快照只是界面展示缓存；写盘失败（并发下 Windows EPERM 等）绝不能拖垮整轮对话。
    try { writeJsonAtomic(path.join(this.dataDir, 'context-usage.json'), this.contextUsage); } catch { /* best-effort cache */ }
  }

  // ----- todos -----
  private loadTodos(): void {
    const file = path.join(this.dataDir, 'todos.json');
    if (!fs.existsSync(file)) return;
    this.todoLists = safeJsonParse<TodoList[]>(fs.readFileSync(file, 'utf8'), []);
  }

  listTodos(conversationId: string): TodoList | undefined {
    const list = this.todoLists.find((item) => item.conversationId === conversationId);
    return list ? { ...list, items: list.items.map((item) => ({ ...item })) } : undefined;
  }

  /** 模型每次提交完整清单（整体替换，不是追加）；空数组 = 清空。 */
  writeTodos(conversationId: string, botId: string, items: { content: string; done: boolean }[]): TodoList {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new Error('会话不存在');
    if (conversation.subagent) throw new Error('子智能体的临时会话不能维护任务清单');
    if (items.length > 20) throw new Error('任务清单最多 20 项');
    const cleaned = items.map((item) => {
      const content = String(item?.content ?? '').trim();
      if (!content) throw new Error('清单项不能为空');
      if (content.length > 200) throw new Error('单个清单项最多 200 字');
      return { content, done: item.done === true };
    });
    if (!cleaned.length) {
      this.persistTodos(this.todoLists.filter((item) => item.conversationId !== conversationId));
      this.notifyTodos(conversationId);
      return { conversationId, botId, items: [], updatedAt: Date.now() };
    }
    const record: TodoList = { conversationId, botId, items: cleaned, updatedAt: Date.now() };
    this.persistTodos([...this.todoLists.filter((item) => item.conversationId !== conversationId), record]);
    this.notifyTodos(conversationId);
    return { ...record, items: record.items.map((item) => ({ ...item })) };
  }

  private todoListeners = new Set<(conversationId: string) => void>();

  private notifyTodos(conversationId: string): void {
    for (const listener of this.todoListeners) {
      try { listener(conversationId); } catch { /* 监听器异常不影响持久化 */ }
    }
  }

  /** 任务清单变更（模型 todo_write）时通知，参数为受影响的会话 id。 */
  onTodosChanged(listener: (conversationId: string) => void): () => void {
    this.todoListeners.add(listener);
    return () => { this.todoListeners.delete(listener); };
  }

  private persistTodos(next: TodoList[]): void {
    writeJsonAtomic(path.join(this.dataDir, 'todos.json'), next);
    this.todoLists = next;
  }

  // ----- projects (L2 项目状态) -----
  private loadProjects(): void {
    const file = path.join(this.dataDir, 'projects.json');
    if (!fs.existsSync(file)) return;
    this.projects = safeJsonParse<ProjectStore>(fs.readFileSync(file, 'utf8'), {});
    const autoFile = path.join(this.dataDir, 'projects-auto.json');
    if (fs.existsSync(autoFile)) this.autoProjectCheckpoints = safeJsonParse<typeof this.autoProjectCheckpoints>(fs.readFileSync(autoFile, 'utf8'), {});
  }

  private persistProjects(): void {
    writeJsonAtomic(path.join(this.dataDir, 'projects.json'), this.projects);
  }

  /** 某 Bot 的全部项目（副本）。 */
  listProjects(botId: string): ProjectState[] {
    const map = this.projects[botId] ?? {};
    return Object.entries(map)
      .map(([name, project]) => ({ ...project, name }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按名称取项目（用于"继续上次的 XX 项目"）。 */
  getProject(botId: string, name: string): ProjectState | undefined {
    const project = this.projects[botId]?.[name];
    return project ? { ...project, name } : undefined;
  }

  /** 设当前活动项目（聚焦的）。旧的活动项目自动降为 paused。 */
  setActiveProject(botId: string, name: string): ProjectState | undefined {
    const map = this.projects[botId] ?? {};
    const target = map[name];
    if (!target) return undefined;
    for (const [key, project] of Object.entries(map)) {
      if (key !== name && project.status === 'active') map[key] = { ...project, status: 'paused', updatedAt: Date.now() };
    }
    map[name] = { ...target, status: 'active', updatedAt: Date.now() };
    this.projects[botId] = map;
    this.persistProjects();
    return { ...map[name]!, name };
  }

  /** 创建或更新一个项目。 */
  upsertProject(botId: string, patch: Partial<ProjectState> & { name: string }): ProjectState {
    const map = this.projects[botId] ?? {};
    const current = map[patch.name];
    const next: ProjectState = {
      name: patch.name,
      description: patch.description ?? current?.description,
      status: patch.status ?? current?.status ?? 'active',
      currentGoal: patch.currentGoal ?? current?.currentGoal,
      summary: patch.summary ?? current?.summary,
      decisions: patch.decisions ?? current?.decisions ?? [],
      nextActions: patch.nextActions ?? current?.nextActions ?? [],
      workspacePaths: patch.workspacePaths ?? current?.workspacePaths ?? [],
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    map[patch.name] = next;
    this.projects[botId] = map;
    this.persistProjects();
    return { ...next };
  }

  /** 删除项目。 */
  deleteProject(botId: string, name: string): void {
    const map = this.projects[botId];
    if (map?.[name]) { delete map[name]; this.persistProjects(); }
  }

  /** 项目自动更新的低频检查点（按 botId）。 */
  getAutoProjectCheckpoints(): Record<string, { lastRound: number; failures?: number; lastActiveProject?: string }> {
    return this.autoProjectCheckpoints;
  }

  setAutoProjectCheckpoints(all: Record<string, { lastRound: number; failures?: number; lastActiveProject?: string }>): void {
    this.autoProjectCheckpoints = all;
    writeJsonAtomic(path.join(this.dataDir, 'projects-auto.json'), all);
  }

  // ----- goals -----
  private loadGoals(): void {
    const file = path.join(this.dataDir, 'goals.json');
    if (!fs.existsSync(file)) return;
    this.goalList = safeJsonParse<Goal[]>(fs.readFileSync(file, 'utf8'), []);
  }

  private persistGoals(next: Goal[]): void {
    writeJsonAtomic(path.join(this.dataDir, 'goals.json'), next);
    this.goalList = next;
  }

  private goalListeners = new Set<(conversationId: string) => void>();

  private notifyGoals(conversationId: string): void {
    for (const listener of this.goalListeners) {
      try { listener(conversationId); } catch { /* 监听器异常不影响持久化 */ }
    }
  }

  /** 目标状态变更（set_goal / update_goal / resume）时通知，参数为受影响的会话 id。 */
  onGoalsChanged(listener: (conversationId: string) => void): () => void {
    this.goalListeners.add(listener);
    return () => { this.goalListeners.delete(listener); };
  }

  listGoals(conversationId?: string): Goal[] {
    return this.goalList
      .filter((goal) => !conversationId || goal.conversationId === conversationId)
      .map((goal) => ({ ...goal }));
  }

  /** 一本会话同时只有一个在推进的目标；新目标覆盖旧的活动目标，历史目标保留可查。 */
  activeGoal(conversationId: string): Goal | undefined {
    const goal = this.goalList.find((item) => item.conversationId === conversationId && item.status === 'active');
    return goal ? { ...goal } : undefined;
  }

  /** UI 面板用：活动目标 + 最近一个"触顶暂停"的续航目标（可续跑）+ 最近一个受阻目标（含被手动 blocked 的）。模型续航判定仍只看 activeGoal。 */
  goalState(conversationId: string): { active?: Goal; resumable?: Goal; blocked?: Goal } {
    const active = this.activeGoal(conversationId);
    const blockedAll = this.goalList.filter((item) => item.conversationId === conversationId && item.status === 'blocked');
    const isTopOut = (item: Goal) => item.autonomy === 'until_done' && (item.note ?? '').includes('轮数上限');
    const resumable = [...blockedAll].reverse().find(isTopOut);
    const blocked = [...blockedAll].reverse().find((item) => !isTopOut(item));
    return { active, ...(resumable ? { resumable: { ...resumable } } : {}), ...(blocked ? { blocked: { ...blocked } } : {}) };
  }

  /** 人工把受阻目标重新打开（继续推进）：恢复 active 并清掉受阻说明。 */
  reopenGoal(conversationId: string): Goal {
    const goal = [...this.goalList].reverse().find((item) => item.conversationId === conversationId && item.status === 'blocked');
    if (!goal) throw new Error('没有可继续的受阻目标');
    const index = this.goalList.indexOf(goal);
    const next = [...this.goalList];
    next[index] = { ...goal, status: 'active', note: '人工继续推进', updatedAt: Date.now() };
    this.persistGoals(next);
    this.notifyGoals(conversationId);
    return { ...next[index] };
  }

  setGoal(input: { conversationId: string; botId: string; objective: string; successCriteria?: string[]; autonomy?: 'turn' | 'until_done'; maxRounds?: number }): Goal {
    const conversation = this.getConversation(input.conversationId);
    if (!conversation) throw new Error('会话不存在');
    if (conversation.subagent) throw new Error('子智能体的临时会话不能设定目标');
    const objective = input.objective.trim();
    if (!objective) throw new Error('目标不能为空');
    if (objective.length > 2000) throw new Error('目标描述最多 2000 字，请写清可验收的完成条件');
    const criteria = (input.successCriteria ?? [])
      .map((text) => text.trim()).filter((text) => text).slice(0, 12)
      .map((text) => ({ text, done: false as const }));
    const maxRounds = Math.min(Math.max(Math.floor(input.maxRounds ?? 8), 1), 50);
    const goal: Goal = {
      id: newId('goal'),
      botId: input.botId,
      conversationId: input.conversationId,
      objective,
      status: 'active',
      ...(criteria.length ? { criteria } : {}),
      autonomy: input.autonomy === 'until_done' ? 'until_done' : 'turn',
      maxRounds,
      roundsUsed: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // 只让一本会话有一个活动目标：把之前的活动目标标成 blocked 而不是悄悄丢弃。
    const next = this.goalList.map((item) =>
      item.conversationId === input.conversationId && item.status === 'active'
        ? { ...item, status: 'blocked' as const, note: '被新的目标取代', updatedAt: Date.now() }
        : item,
    );
    this.persistGoals([...next, goal]);
    this.notifyGoals(input.conversationId);
    return { ...goal };
  }

  /** 续航每完成一轮 +1；返回新的 roundsUsed（仅活动目标）。 */
  bumpGoalRound(conversationId: string): number {
    const index = this.goalList.findIndex((item) => item.conversationId === conversationId && item.status === 'active');
    if (index < 0) return 0;
    const used = (this.goalList[index].roundsUsed ?? 0) + 1;
    const next = [...this.goalList];
    next[index] = { ...next[index], roundsUsed: used, updatedAt: Date.now() };
    this.persistGoals(next);
    this.notifyGoals(conversationId);
    return used;
  }

  /** 一键续跑：给触顶 blocked 的目标追加轮数并转回 active（人类判断，不要求证据）。 */
  resumeGoal(conversationId: string, extraRounds = 5): Goal {
    const goal = this.goalList.find((item) => item.conversationId === conversationId && item.status === 'blocked' && item.autonomy === 'until_done' && (item.note ?? '').includes('轮数上限'));
    if (!goal) throw new Error('只有触顶暂停的续航目标才能续跑');
    const next = [...this.goalList];
    const index = next.indexOf(goal);
    next[index] = { ...goal, status: 'active', maxRounds: Math.min((goal.maxRounds ?? 8) + extraRounds, 200), note: `人工续跑 +${extraRounds} 轮`, updatedAt: Date.now() };
    this.persistGoals(next);
    this.notifyGoals(conversationId);
    return { ...next[index] };
  }

  updateGoal(conversationId: string, patch: { status?: Goal['status']; note?: string; evidence?: { criterion: string; proof: string }[] }, opts: { requireEvidence?: boolean } = {}): Goal {
    const index = this.goalList.findIndex((item) => item.conversationId === conversationId && item.status === 'active');
    if (index < 0) throw new Error('这个会话没有进行中的目标');
    if (patch.status && !['active', 'complete', 'blocked'].includes(patch.status)) throw new Error('目标状态无效');
    const current = this.goalList[index]!;
    let criteria = current.criteria;
    // 完成闸：目标若定义了验收条件，模型标 complete 前必须逐条给出证据；缺一条都不放行。
    // 人类在 UI 上点「完成」走 requireEvidence:false 越权——人的判断高于自动审计。
    if (patch.status === 'complete' && criteria?.length && opts.requireEvidence !== false) {
      const norm = (value: string) => value.trim().toLocaleLowerCase();
      const provided = new Map((patch.evidence ?? []).map((item) => [norm(item.criterion), item.proof?.trim() ?? '']));
      const unmet = criteria.filter((item) => !item.done && !(provided.get(norm(item.text))?.length));
      if (unmet.length) throw new Error(`还有 ${unmet.length} 条验收条件没有证据，逐条给证据再标 complete：\n${unmet.map((item) => `- ${item.text}`).join('\n')}`);
      criteria = criteria.map((item) => item.done ? item : { ...item, done: true, evidence: provided.get(norm(item.text)) });
    }
    const goal: Goal = {
      ...current,
      ...(criteria ? { criteria } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.note !== undefined ? { note: patch.note.trim().slice(0, 500) } : {}),
      updatedAt: Date.now(),
    };
    const next = [...this.goalList];
    next[index] = goal;
    this.persistGoals(next);
    this.notifyGoals(conversationId);
    return { ...goal };
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
