/**
 * Shared contract between the MoyuBot core, the Electron main process and the renderer.
 * Everything here must stay JSON-serialisable: it crosses the IPC boundary.
 */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export type ReasoningEffort = 'low' | 'medium' | 'high';
export interface ModelSettings {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  /** Long-conversation compaction starts here; >= context window means the full window. */
  compactionThresholdTokens?: number;
  /** Explicit opt-in: compatible relays do not necessarily support these fields. */
  reasoningControl?: 'default' | 'openai-effort' | 'anthropic-budget' | 'gemini-budget';
  outputTokenParameter?: 'max_tokens' | 'max_completion_tokens';
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  /** DeepSeek-compatible thinking history; automatically enabled for known DeepSeek models. */
  reasoningReplay?: boolean;
}
export interface BotGenerationSettings {
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  maxSteps?: number;
  /** Per-Bot override for long-conversation compaction; falls back to the model setting. */
  compactionThresholdTokens?: number;
  /** Across every request, retry and compaction in this Bot run. */
  maxTaskOutputTokens?: number;
  maxDurationSeconds?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Base URL without a trailing slash, e.g. https://api.x.ai/v1 */
  baseUrl: string;
  /** Omitted values connect directly; system follows OS proxy and bypass rules. */
  networkMode?: 'system' | 'direct';
  defaultModel: string;
  models: string[];
  /** Filled from the provider's /v1/models: readable name + advertised limits per model id. */
  modelCatalog?: Record<string, { name?: string; contextWindowTokens?: number; maxOutputTokens?: number }>;
  imageModel?: string;
  /** Extra headers, e.g. OpenRouter's HTTP-Referer. */
  extraHeaders?: Record<string, string>;
  /** Model input + output limit. Unknown models use a conservative 32K budget. */
  contextWindowTokens?: number;
  /** Per-request output ceiling including reasoning; absent uses automatic sizing. */
  maxOutputTokens?: number;
  modelSettings?: Record<string, ModelSettings>;
  createdAt: number;
}

export interface BotAvatar {
  /** Portrait id from the bundled ai girl bot character set. */
  shape?: string;
  /** Locally stored, cropped avatar image; absent for animated built-in portraits. */
  imageDataUrl?: string;
  from: string;
  to: string;
  glyph: string;
}

/** 'ask'=写类工具执行前弹审批；'never'=全部直接执行。（历史上的 'always' 与 'never' 行为相同，加载时已归一。） */
export type ApprovalPolicy = 'ask' | 'never';

export interface ImageConfig {
  /** Images are generated through the Bot's provider image API. */
  aspect: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16';
}

export interface Bot {
  id: string;
  name: string;
  handle: string;
  avatar: BotAvatar;
  providerId: string;
  model: string;
  temperature: number;
  generation?: BotGenerationSettings;
  systemPrompt: string;
  approvalPolicy: ApprovalPolicy;
  tools: string[];
  mcpServerIds?: string[];
  skillIds?: string[];
  image: ImageConfig;
  wakeOnTask: boolean;
  createdAt: number;
  updatedAt: number;
  /** Local navigation preferences, independent of model and conversation identity. */
  sidebar?: { pinned?: boolean; hidden?: boolean; unread?: boolean; group?: string };
  workspaceId?: string;
  /** Bot 专属工作目录名（跨平台安全、稳定不变）：文件工具的相对路径与命令 cwd 都锚定在这里，实现 Bot 间文件隔离。 */
  dirName?: string;
}

export type WorkspaceKind = 'local' | 'cloud';
export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  computerName: string;
  createdAt: number;
  directory?: string;
  activeBotId?: string;
  botGroups?: SidebarBotGroup[];
  ungroupedGroupIndex?: number;
  groupChatsCollapsed?: boolean;
  groupChatOrder?: string[];
}

export type BotMetadataPatch = { name?: string; sidebar?: NonNullable<Bot['sidebar']> };
export interface SidebarBotGroup { name: string; collapsed?: boolean }
export type GroupChatAction =
  | { type: 'edit'; title: string; memberBotIds: string[] }
  | { type: 'move'; direction: 'up' | 'down' }
  | { type: 'delete' };
export type BotGroupAction =
  | { type: 'rename'; name: string }
  | { type: 'move'; direction: 'up' | 'down' }
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'delete' };

export type CloudState =
  | 'unconfigured'
  | 'off'
  | 'stopped'
  | 'suspended'
  | 'waking'
  | 'ready'
  | 'busy'
  | 'sleeping'
  | 'error';

export type InstaBoxMachineState =
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'suspending'
  | 'suspended'
  | 'resuming'
  | 'deleting'
  | 'deleted'
  | 'error';

export interface CloudHostSettings {
  driver: 'instabox' | 'mock' | 'e2b';
  baseUrl: string;
  /** E2B only: sandbox ingress domain for self-hosted. Empty → official cloud. */
  e2bDomain?: string;
  /** E2B only: template name/ID to spawn (e.g. 'base', 'code-interpreter-v1'). */
  e2bTemplate?: string;
  machineId?: string;
  machineName: string;
  templateId: string;
  vcpus?: number;
  memMiB?: number;
  persistentDiskGiB?: number;
  /** InstaBox idle auto-suspend (300-1800s, or 0 where the plan allows). */
  autoSuspendAfterSeconds: number;
  /** Local safety net on top of InstaBox's own timer. */
  idleSuspendMinutes: number;
  maxRunMinutes?: number;
  /** Folder used for generated images and run artifacts. */
  workspaceDir: string;
  /** Working directory on the remote Linux computer; workspaceDir stores local artifacts. */
  remoteWorkspaceDir?: string;
  /** Auto wake before any task/drawing. */
  wakeOnDemand: boolean;
}

export interface CloudStatus {
  state: CloudState;
  machine?: {
    id: string;
    name: string;
    state: InstaBoxMachineState;
    autoSuspendAfterSeconds: number | null;
    updatedAt?: string;
    /** Actual resources reported by the cloud backend (e.g. E2B sandbox 8 vCPU / 8192 MiB). */
    spec?: { vcpus?: number; memMiB?: number };
  };
  lastError?: string;
  lastTransitionAt: number;
  lastWakeAt?: number;
  awakeMs: number;
  wakeCount: number;
  pendingReason?: string;
  operationPhase?: string;
}

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
  detail?: string;
  artifactPath?: string;
  durationMs?: number;
};

export interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType?: string;
  /** data: URL for inline preview / vision input */
  dataUrl?: string;
  path?: string;
  size?: number;
  /** 小文本附件的内容内联（≤8KB）：Bot 不依赖云端/本地副本也能读到文件内容 */
  text?: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/** JSON-only protocol blocks, scoped to the exact endpoint and model that signed them. */
export interface ProviderReplay {
  version: 1;
  providerId: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  parts: ({ type: 'text' | 'reasoning'; text: string; providerOptions?: Record<string, Record<string, unknown>> } |
    { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown>; providerOptions?: Record<string, Record<string, unknown>> })[];
}

export interface MessageReply {
  messageId: string;
  author: string;
  content: string;
}

export interface Message {
  id: string;
  botId?: string;
  botName?: string;
  role: MessageRole;
  content: string;
  replyTo?: MessageReply;
  createdAt: number;
  model?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  attachments?: Attachment[];
  usage?: TokenUsage;
  usageTracked?: boolean;
  /** Total model generation time across this message's calls, in ms. */
  modelMs?: number;
  /** Time from the first model call to its first streamed token, in ms. */
  ttftMs?: number;
  error?: string;
  /** true while tokens are still streaming in */
  streaming?: boolean;
  /** Generation was explicitly stopped; preserved separately from provider failures. */
  stopped?: boolean;
  reasoning?: string;
  /** Complete model responses, preserving thinking/tool boundaries across requests and reloads. */
  modelTurns?: { content: string; reasoning?: string; toolCalls?: ToolCall[]; replay?: ProviderReplay }[];
  /** renderer-only shade for notices */
  tone?: 'info' | 'warning' | 'error';
}

export interface Conversation {
  id: string;
  workspaceId?: string;
  botId: string;
  group?: { memberBotIds: string[] };
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /** Legacy threads stay on disk after being merged into the bot's single thread. */
  mergedInto?: string;
  /** Deleted group chats retain their transcript on disk and leave the active list. */
  deletedAt?: number;
  context?: ConversationContext;
  /**
   * 子智能体的临时工作会话：只在主进程内存里存在，不落盘、不进侧栏、不进同步快照。
   * 它对外的唯一留痕是回给父会话的那条工具结果；depth 用来硬限递归层数。
   */
  subagent?: { task: string; depth: number; parentConversationId: string };
  /**
   * 会话级续航偏好：省略即 'turn'（只在单轮内自动多步）。
   * 'until_done' 时，模型 set_goal 若没显式指定 autonomy 就默认续航，且系统提示引导它这么做。
   */
  autonomy?: 'turn' | 'until_done';
  /**
   * 计划模式。省略即等同 'execute'，所以旧会话文件不需要迁移。
   * 计划态下模型只拿到只读工具（MCP 工具一并隐藏），必须用 exit_plan_mode 把方案交给
   * 人批准，批准后才切回执行态。
   */
  mode?: 'execute' | 'plan';
  /** 最近一次被批准的计划，供界面回看与后续轮次引用。 */
  plan?: { title: string; steps: string[]; approvedAt: number };
}

/** 一次模型调用前的上下文三段拆分 + 窗口/预留，落盘以便重启后界面仍显示上次值。 */
export interface ContextUsageSnapshot {
  systemTokens: number;
  toolTokens: number;
  historyTokens: number;
  windowTokens: number;
  reserveTokens: number;
  updatedAt: number;
}

export interface ConversationContext {
  summary: string;
  throughMessageId: string;
  compactedMessages: number;
  updatedAt: number;
  model: string;
}

export interface MemoryFact {
  id: string;
  botId: string;
  text: string;
  pinned: boolean;
  createdAt: number;
  lastUsedAt?: number;
  source?: 'manual' | 'automatic';
}

/** 设置页「长期记忆」用的范围概览：一个 Bot 或一个群聊的统计。 */
export interface MemoryScopeSummary {
  scopeId: string;
  title: string;
  kind: 'bot' | 'group';
  total: number;
  pinned: number;
  latestAt: number;
}

/**
 * 跨轮目标：会话级状态，不是 Bot 配置。
 * moyubot 不做自动续跑（那会无人值守地烧 token），目标只负责让模型和用户都记得
 * "这一轮还没做完什么"，推进由用户或定时任务发起。
 */
export interface Goal {
  id: string;
  botId: string;
  conversationId: string;
  objective: string;
  status: 'active' | 'complete' | 'blocked';
  /** 结束时的一句话交代：完成了什么，或者卡在哪。 */
  note?: string;
  /** 可验收的完成条件：模型标 complete 前必须逐条给出证据（人类 UI 可越权直接完成）。 */
  criteria?: { text: string; done: boolean; evidence?: string }[];
  /** 'turn'=单轮内自动多步（现状）；'until_done'=跨轮续航，框架自动再来一轮直到达成/受阻/触顶。 */
  autonomy?: 'turn' | 'until_done';
  /** 续航最大轮数，默认 8；到顶标 blocked（可一键续跑）。 */
  maxRounds?: number;
  /** 已消耗的续航轮数（首轮用户消息不计）。 */
  roundsUsed?: number;
  createdAt: number;
  updatedAt: number;
}

/** 会话内轻量任务清单：模型每次提交完整清单（整体替换），人一眼看到还剩什么。 */
export interface TodoList {
  conversationId: string;
  botId: string;
  items: { content: string; done: boolean }[];
  updatedAt: number;
}

/** 开放提问：模型信息不足时问用户，等一段文字回答（区别于"是/否"审批）。 */
export interface AskRequest {
  id: string;
  conversationId: string;
  botId: string;
  question: string;
  createdAt: number;
}

export interface AskDecision {
  requestId: string;
  answer: string;
}

export interface Schedule {
  id: string;
  botId: string;
  prompt: string;
  /** 5-field cron in the local timezone. */
  cron: string;
  kind?: 'cron' | 'once';
  title?: string;
  runAt?: number;
  createdAt?: number;
  updatedAt?: number;
  closedAt?: number;
  completedAt?: number;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: 'ok' | 'error' | 'running' | 'skipped';
  lastError?: string;
}

export interface ScheduleInput { prompt: string; title?: string; cron?: string; runAt?: number }
export interface ScheduleUpdate { action?: 'update' | 'pause' | 'resume' | 'close'; prompt?: string; title?: string; cron?: string; runAt?: number }

export interface TelegramSettings {
  enabled: boolean;
  token: string;
  allowedIds: string[];
  defaultBotId?: string;
}

export interface UiSettings {
  botGroups?: SidebarBotGroup[];
  /** Position of the built-in ungrouped section among named groups; omitted means last. */
  ungroupedGroupIndex?: number;
  userAvatar?: BotAvatar & { imageDataUrl?: string };
  accent: string;
  appearance: 'dark' | 'light' | 'system';
  reduceMotion: boolean;
  density: 'comfortable' | 'compact';
  glassIntensity: number;
}

export type WebSearchProvider = 'bing-web' | 'duckduckgo' | 'serper' | 'brave' | 'bing' | 'searxng';

/** Backend for the web_search tool; bing-web and duckduckgo need no credentials. */
export interface WebSearchSettings {
  provider: WebSearchProvider;
  apiKey?: string;
  /** SearXNG instance base URL, e.g. https://searx.example.com */
  endpoint?: string;
}

export interface AppSettings {
  mcpServers?: McpServerConfig[];
  skills?: SkillConfig[];
  webSearch?: WebSearchSettings;
  version: number;
  userName?: string;
  onboarding?: { step: 0 | 1 | 2; cloudSkipped?: boolean; completedAt?: number };
  providers: ProviderConfig[];
  bots: Bot[];
  cloud: CloudHostSettings;
  /** GitHub（Codespaces 接入）：OAuth App 的 Client ID；token 在加密密钥库里，不进 settings。 */
  github?: { oauthClientId?: string };
  telegram: TelegramSettings;
  ui: UiSettings;
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  activeBotId?: string;
  activeView?: string;
  /** 记忆召回的向量模型（OpenAI 兼容 /embeddings 端点）；不可用时自动降级为纯关键词检索。 */
  embedding?: EmbeddingSettings;
}

/** 默认指向硅基流动的 bge-m3（免费档，中文效果好）；API Key 存在 SecretBox 的 embedding:key。 */
export interface EmbeddingSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  dimensions?: number;
}

export interface EmbeddingTestResult {
  ok: boolean;
  dimensions: number;
  latencyMs: number;
  message: string;
}

export interface McpServerConfig {
  id: string;
  workspaceId: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  hasSecrets?: boolean;
}

export interface SkillConfig {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  directory: string;
}

export interface CapabilityStatus {
  servers: { id: string; state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'deployed'; tools: { name: string; description?: string }[]; error?: string; cloud?: boolean; name?: string; transport?: string; source?: string }[];
  loadedSkills: { botId: string; skillId: string; loadedAt: number }[];
  /** 云电脑真实部署的 MCP 服务（由云主机盘点而来，非本机配置）。botId/botDirName 标记该 Bot 家目录的部署项；共享项（~/.claude）无 botId。 */
  cloudServers?: { id: string; name: string; transport: string; command?: string; url?: string; source: string; botId?: string; botDirName?: string }[];
  /** 云电脑真实部署的技能（目录盘点）。 */
  cloudSkills?: { id: string; name: string; path: string; source: string; botId?: string; botDirName?: string }[];
}

/** importMcp / importSkill 的结果：云端安装还是本机安装。 */
export interface CapabilityImportResult {
  target: 'cloud' | 'local';
  names?: string[];
  name?: string;
  id?: string;
}

export type AgentEvent =
  | { type: 'schedules'; schedules: Schedule[] }
  | { type: 'todos'; conversationId: string; todos?: TodoList }
  | { type: 'goal'; conversationId: string; active?: Goal; resumable?: Goal; blocked?: Goal }
  | { type: 'run_start'; runId: string; conversationId: string }
  | { type: 'message_start'; conversationId: string; message: Message }
  | { type: 'delta'; conversationId: string; messageId: string; text: string }
  | { type: 'reasoning'; conversationId: string; messageId: string; text: string }
  | { type: 'tool_start'; conversationId: string; messageId: string; call: ToolCall }
  | { type: 'tool_end'; conversationId: string; messageId: string; result: ToolResult }
  | { type: 'message_end'; conversationId: string; message: Message }
  | { type: 'run_end'; conversationId: string; runId: string; ok: boolean; error?: string }
  | { type: 'context_compaction'; conversationId: string; phase: 'start' | 'done' | 'error'; context?: ConversationContext }
  | { type: 'context_pruned'; conversationId: string; pruned: number; savedTokens: number }
  /** 子智能体批次进度。父会话用它画嵌套卡片；子会话内部的 token 增量不外发，避免界面串台。 */
  | { type: 'subagent'; conversationId: string; callId: string; status: 'start'; tasks: string[] }
  /** 单个子任务的实时状态：界面据此显示"第几个在跑、第几个已完成"，childConversationId 支持单独停止/续聊。 */
  | { type: 'subagent'; conversationId: string; callId: string; status: 'child'; index: number; task: string; state: 'running' | 'done' | 'error'; childConversationId?: string }
  | { type: 'subagent'; conversationId: string; callId: string; status: 'done'; tasks: string[]; children?: { conversationId: string; task: string; ok: boolean; text?: string; error?: string }[]; seconds?: number }
  | { type: 'question'; request: AskRequest }
  | { type: 'question_done'; requestId: string; answer: string; cancelled: boolean }
  | { type: 'context_usage'; conversationId: string; systemTokens: number; toolTokens: number; historyTokens: number; windowTokens: number; reserveTokens: number }
  | { type: 'usage'; conversationId: string; messageId: string; usage: TokenUsage }
  | { type: 'cloud'; status: CloudStatus; note?: string }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval_done'; requestId: string; approved: boolean }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  botId: string;
  toolName: string;
  summary: string;
  command?: string;
  createdAt: number;
}

export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  always?: boolean;
}

export interface ChatImageInput {
  name?: string;
  mimeType: string;
  dataUrl: string;
  /** 字节数；文件类附件在界面上展示大小 */
  size?: number;
}

export interface SendMessageInput {
  conversationId?: string;
  botId: string;
  text: string;
  images?: ChatImageInput[];
  replyTo?: { messageId: string; selectedText?: string };
}

export interface SendMessageResult {
  conversationId: string;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export interface AppUpdateResult {
  status: 'available' | 'current' | 'unpublished' | 'error';
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  message: string;
  checkedAt: number;
  installer?: { name: string; url: string; size: number; sha256?: string; checksumUrl?: string };
  installHint?: string;
}

export interface AppUpdateProgress {
  status: 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'cancelled' | 'error';
  received: number;
  total?: number;
  message: string;
  release?: AppUpdateResult;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  models?: string[];
}

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  imageCount: number;
  cloudWakeSeconds: number;
}

/** Provider-reported counts. Input includes cache reads; output includes reasoning. */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}
export interface UsageRecord {
  id: string;
  workspaceId?: string;
  createdAt: number;
  botId: string;
  botName: string;
  providerId: string;
  providerName: string;
  model: string;
  conversationId: string;
  messageId?: string;
  purpose: 'chat' | 'compaction' | 'historical';
  status: 'complete' | 'error';
  usage?: TokenUsage;
}
export interface UsageQuery {
  workspaceId?: string;
  start: number;
  end: number;
  interval: 'hour' | 'day' | 'week' | 'month';
  botId?: string;
  modelKey?: string;
}
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheInputTokens: number;
  cacheReportedCalls: number;
  calls: number;
  reportedCalls: number;
  compactionCalls: number;
  historicalCalls: number;
}
export interface UsageRow extends UsageTotals { id: string; name: string; detail?: string }
export interface UsageReport {
  totals: UsageTotals;
  bots: UsageRow[];
  models: UsageRow[];
  options: { bots: { id: string; name: string }[]; models: { id: string; name: string }[] };
  buckets: { start: number; end: number; totalTokens: number; bots: Record<string, number>; models: Record<string, number> }[];
}

export interface BootstrapPayload {
  settings: AppSettings;
  cloud: CloudStatus;
  conversations: { id: string; botId: string; workspaceId?: string; title: string; updatedAt: number; group?: Conversation['group']; preview?: string }[];
  runningConversations: string[];
  schedules: Schedule[];
  memories: MemoryFact[];
  secrets: {
    providerKeys: Record<string, boolean>;
    cloudKey: boolean;
    telegramToken: boolean;
    encrypted: boolean;
  };
  platform: string;
  version: string;
}

export const DEFAULT_SYSTEM_PROMPT = `你是 {bot_name}，一个运行在 MoyuBot 里的通用智能体。
你有一台共享的云端 Linux 电脑（4 vCPU / 8 GB），平时处于休眠状态，需要时会被自动唤醒。
- 涉及文件、命令、脚本的任务，用 cloud_* 工具在云电脑里完成；聊天闲聊不必唤醒云电脑。
- 需要生成图片时调用 generate_image，通过供应商图像 API 出图，无需唤醒云电脑。
- 长任务先说明计划，再用工具一步步执行，每一步都给出可验证的结果。
- 不确定的信息要说明不确定，不要编造命令输出。`;
