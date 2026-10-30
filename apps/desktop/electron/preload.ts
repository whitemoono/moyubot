import { contextBridge, ipcRenderer } from 'electron';
import type {
  CapabilityStatus,
  AppUpdateResult,
  AppUpdateProgress,
  AgentEvent,
  AppSettings,
  ApprovalDecision,
  Bot,
  BotMetadataPatch,
  BotGroupAction,
  GroupChatAction,
  BootstrapPayload,
  CloudStatus,
  DesktopSession,
  DiagnosticEntry,
  Conversation,
  ExecResult,
  MemoryFact,
  ProviderTestResult,
  ProviderConfig,
  Schedule,
  ScheduleUpdate,
  SendMessageInput,
  SendMessageResult,
  UsageQuery,
  UsageReport,
} from '@moyu/core';
import type { ConversationSummary } from '@moyu/core';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  capabilityStatus: (workspaceId: string) => invoke<CapabilityStatus>('moyu:capabilities:status', workspaceId),
  importMcp: (workspaceId: string, json: string) => invoke<void>('moyu:mcp:import', workspaceId, json),
  testMcp: (id: string) => invoke<void>('moyu:mcp:test', id),
  importSkill: (workspaceId: string) => invoke<void>('moyu:skill:import', workspaceId),
  removeCapability: (kind: 'mcp' | 'skill', id: string) => invoke<void>('moyu:capabilities:remove', kind, id),
  setupDirectory: (directory: string) => invoke<AppSettings>('moyu:setup:directory', directory),
  finishSetup: (skipCloud: boolean) => invoke<AppSettings>('moyu:setup:finish', skipCloud),
  feedbackDiagnostics: () => invoke<DiagnosticEntry[]>('moyu:feedback:diagnostics'),
  clearFeedbackDiagnostics: () => invoke<void>('moyu:feedback:clear'),
  copyFeedback: (text: string) => invoke<void>('moyu:feedback:copy', text),
  checkForUpdates: () => invoke<AppUpdateResult>('moyu:app:check-updates'),
  updateStatus: () => invoke<AppUpdateProgress>('moyu:app:update-status'),
  downloadUpdate: () => invoke<AppUpdateProgress>('moyu:app:download-update'),
  cancelUpdate: () => invoke<void>('moyu:app:cancel-update'),
  installUpdate: () => invoke<AppUpdateProgress>('moyu:app:install-update'),
  bootstrap: () => invoke<BootstrapPayload>('moyu:bootstrap'),
  usage: (query: UsageQuery) => invoke<UsageReport>('moyu:usage', query),
  saveSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>('moyu:settings:save', patch),
  setProviderKey: (providerId: string, key: string) => invoke<void>('moyu:provider:key', { providerId, key }),
  testProvider: (providerId: string, draft?: ProviderConfig, key?: string) => invoke<ProviderTestResult>('moyu:provider:test', providerId, draft, key),
  listModels: (providerId: string, draft?: ProviderConfig, key?: string) => invoke<string[]>('moyu:provider:models', providerId, draft, key),
  listModelCatalog: (providerId: string, draft?: ProviderConfig, key?: string) => invoke<{ id: string; name?: string; contextWindowTokens?: number; maxOutputTokens?: number }[]>('moyu:provider:model-catalog', providerId, draft, key),
  saveBot: (bot: Bot) => invoke<Bot>('moyu:bot:save', bot),
  updateBotMetadata: (botId: string, patch: BotMetadataPatch) => invoke<Bot>('moyu:bot:metadata', botId, patch),
  updateBotGroup: (name: string, action: BotGroupAction, workspaceId?: string) => invoke<AppSettings>('moyu:bot-group:update', name, action, workspaceId),
  copyConversationId: (botId: string) => invoke<string>('moyu:bot:copy-conversation', botId),
  deleteBot: (botId: string) => invoke<void>('moyu:bot:delete', botId),

  send: (input: SendMessageInput) => invoke<SendMessageResult>('moyu:send', input),
  stop: (conversationId: string) => invoke<boolean>('moyu:stop', conversationId),
  approve: (decision: ApprovalDecision) => invoke<void>('moyu:approve', decision),
  conversations: (botId?: string) => invoke<ConversationSummary[]>('moyu:conversations', botId),
  conversation: (id: string) => invoke<Conversation | undefined>('moyu:conversation', id),
  botConversation: (botId: string) => invoke<Conversation>('moyu:conversation:bot', botId),
  createGroup: (title: string, memberBotIds: string[]) => invoke<Conversation>('moyu:group:create', title, memberBotIds),
  updateGroupChat: (id: string, action: GroupChatAction) => invoke<{ group: Conversation; settings: AppSettings }>('moyu:group:update', id, action),
  setGroupChatsCollapsed: (workspaceId: string, collapsed: boolean) => invoke<AppSettings>('moyu:group:collapse', workspaceId, collapsed),

  cloud: () => invoke<CloudStatus>('moyu:cloud'),
  desktopOpen: () => invoke<DesktopSession>('moyu:desktop:open'),
  desktopTake: () => invoke<DesktopSession>('moyu:desktop:take'),
  desktopRelease: () => invoke<DesktopSession>('moyu:desktop:release'),
  desktopClose: () => invoke<void>('moyu:desktop:close'),
  desktopHeartbeat: () => invoke<void>('moyu:desktop:heartbeat'),
  local: () => invoke<CloudStatus>('moyu:local'),
  chooseLocalDirectory: () => invoke<AppSettings>('moyu:local:directory'),
  cloudAction: (action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop') => invoke<CloudStatus>('moyu:cloud:action', action),
  cloudExec: (cmd: string, requestId?: string) => invoke<ExecResult>('moyu:cloud:exec', cmd, requestId),
  localExec: (cmd: string, requestId?: string) => invoke<ExecResult>('moyu:local:exec', cmd, requestId),
  stopTerminal: (requestId: string) => invoke<void>('moyu:terminal:stop', requestId),
  saveCloud: (patch: Partial<AppSettings['cloud']>, apiKey?: string) =>
    invoke<CloudStatus>('moyu:cloud:save', { patch, apiKey }),

  schedules: () => invoke<Schedule[]>('moyu:schedules'),
  updateSchedule: (botId: string, id: string, patch: ScheduleUpdate) => invoke<Schedule>('moyu:schedule:update', botId, id, patch),
  addSchedule: (input: { botId: string; cron: string; prompt: string }) => invoke<Schedule>('moyu:schedule:add', input),
  deleteSchedule: (id: string) => invoke<void>('moyu:schedule:delete', id),
  toggleSchedule: (id: string) => invoke<Schedule[]>('moyu:schedule:toggle', id),

  memories: (botId?: string) => invoke<MemoryFact[]>('moyu:memories', botId),
  addMemory: (botId: string, text: string) => invoke<MemoryFact>('moyu:memory:add', { botId, text }),
  deleteMemory: (id: string) => invoke<void>('moyu:memory:delete', id),

  openArtifact: (relPath: string) => invoke<void>('moyu:artifact:open', relPath),
  openExternal: (url: string) => invoke<void>('moyu:open-external', url),
  win: (action: 'minimize' | 'maximize' | 'close') => invoke<void>('moyu:win', action),

  mobileSync: (action: string, payload?: unknown) => invoke<any>('moyu:mobile-sync', action, payload),
  onSyncData: (listener: () => void) => {
    const handler = () => listener(); ipcRenderer.on('moyu:sync-data', handler);
    return () => ipcRenderer.removeListener('moyu:sync-data', handler);
  },
  onEvent: (listener: (event: AgentEvent) => void) => {
    const handler = (_event: unknown, payload: AgentEvent) => listener(payload);
    ipcRenderer.on('moyu:event', handler);
    return () => ipcRenderer.removeListener('moyu:event', handler);
  },
  onCloud: (listener: (status: CloudStatus) => void) => {
    const handler = (_event: unknown, payload: CloudStatus) => listener(payload);
    ipcRenderer.on('moyu:cloud', handler);
    return () => ipcRenderer.removeListener('moyu:cloud', handler);
  },
  onLocal: (listener: (status: CloudStatus) => void) => {
    const handler = (_event: unknown, payload: CloudStatus) => listener(payload);
    ipcRenderer.on('moyu:local', handler);
    return () => ipcRenderer.removeListener('moyu:local', handler);
  },
  platform: process.platform,
  isElectron: true,
};

export type MoyuApi = typeof api;

contextBridge.exposeInMainWorld('moyu', api);
