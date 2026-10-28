/**
 * Shared contract between the MeshBot core, the Electron main process and the renderer.
 * Everything here must stay JSON-serialisable: it crosses the IPC boundary.
 */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Base URL without a trailing slash, e.g. https://api.x.ai/v1 */
  baseUrl: string;
  defaultModel: string;
  models: string[];
  imageModel?: string;
  /** Extra headers, e.g. OpenRouter's HTTP-Referer. */
  extraHeaders?: Record<string, string>;
  createdAt: number;
}

export interface BotAvatar {
  from: string;
  to: string;
  glyph: string;
}

export type ApprovalPolicy = 'ask' | 'always' | 'never';

export interface ImageConfig {
  /** api = provider image endpoint, cloud = run the job inside the shared cloud computer */
  backend: 'api' | 'cloud';
  /** Command template executed inside the VM. {prompt} and {out} are substituted. */
  cloudCommand?: string;
  /** Path inside the VM that the command writes the PNG to. */
  cloudOutputPath?: string;
  aspect: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16';
  /** Wake the shared cloud host even when the image backend is an HTTP API. */
  wakeHost: boolean;
}

export interface Bot {
  id: string;
  name: string;
  handle: string;
  avatar: BotAvatar;
  providerId: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  approvalPolicy: ApprovalPolicy;
  tools: string[];
  image: ImageConfig;
  wakeOnTask: boolean;
  createdAt: number;
  updatedAt: number;
}

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
  driver: 'instabox' | 'mock';
  baseUrl: string;
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
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  model?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  attachments?: Attachment[];
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: string;
  /** true while tokens are still streaming in */
  streaming?: boolean;
  reasoning?: string;
  /** renderer-only shade for notices */
  tone?: 'info' | 'warning' | 'error';
}

export interface Conversation {
  id: string;
  botId: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryFact {
  id: string;
  botId: string;
  text: string;
  pinned: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

export interface Schedule {
  id: string;
  botId: string;
  prompt: string;
  /** 5-field cron in the local timezone. */
  cron: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: 'ok' | 'error' | 'running' | 'skipped';
  lastError?: string;
}

export interface TelegramSettings {
  enabled: boolean;
  token: string;
  allowedIds: string[];
  defaultBotId?: string;
}

export interface UiSettings {
  accent: string;
  appearance: 'dark' | 'light' | 'system';
  reduceMotion: boolean;
  density: 'comfortable' | 'compact';
  glassIntensity: number;
}

export interface AppSettings {
  version: number;
  providers: ProviderConfig[];
  bots: Bot[];
  cloud: CloudHostSettings;
  telegram: TelegramSettings;
  ui: UiSettings;
  activeBotId?: string;
  activeView?: string;
}

export type AgentEvent =
  | { type: 'run_start'; runId: string; conversationId: string }
  | { type: 'message_start'; message: Message }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'reasoning'; messageId: string; text: string }
  | { type: 'tool_start'; messageId: string; call: ToolCall }
  | { type: 'tool_end'; messageId: string; result: ToolResult }
  | { type: 'message_end'; message: Message }
  | { type: 'run_end'; runId: string; ok: boolean; error?: string }
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
}

export interface SendMessageInput {
  conversationId?: string;
  botId: string;
  text: string;
  images?: ChatImageInput[];
}

export interface SendMessageResult {
  conversationId: string;
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
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

export interface BootstrapPayload {
  settings: AppSettings;
  cloud: CloudStatus;
  conversations: { id: string; botId: string; title: string; updatedAt: number }[];
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

export const DEFAULT_SYSTEM_PROMPT = `你是 {bot_name}，一个运行在 MeshBot 里的通用智能体。
你有一台共享的云端 Linux 电脑（4 vCPU / 8 GB），平时处于休眠状态，需要时会被自动唤醒。
- 涉及文件、命令、脚本、绘图的任务，用 cloud_* 工具在云电脑里完成；聊天闲聊不必唤醒云电脑。
- 需要生成图片时调用 generate_image，它会按配置走云主机或图像 API。
- 长任务先说明计划，再用工具一步步执行，每一步都给出可验证的结果。
- 不确定的信息要说明不确定，不要编造命令输出。`;

export const DEFAULT_CLOUD_COMMAND = `mkdir -p "$(dirname {out})" && python3 /opt/meshbot/draw.py --prompt {prompt} --out {out}`;