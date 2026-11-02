import type {
  CapabilityStatus,
  CapabilityImportResult,
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
  Goal,
  AskRequest,
  TodoList,
  ConversationContext,
  ContextUsageSnapshot,
  MemoryFact,
  MemoryScopeSummary,
  EmbeddingSettings,
  EmbeddingTestResult,
  ProviderTestResult,
  ProviderConfig,
  Schedule,
  ScheduleUpdate,
  SendMessageInput,
  SendMessageResult,
  UsageQuery,
  UsageReport,
} from '@moyu/core';

export interface ConversationSummary {
  id: string;
  workspaceId?: string;
  botId: string;
  group?: Conversation['group'];
  title: string;
  updatedAt: number;
  preview?: string;
}

export interface MoyuBridge {
  capabilityStatus(workspaceId: string): Promise<CapabilityStatus>;
  importMcp(workspaceId: string, json: string): Promise<CapabilityImportResult>;
  testMcp(id: string): Promise<void>;
  importSkill(workspaceId: string): Promise<CapabilityImportResult>;
  removeCapability(kind: 'mcp' | 'skill', id: string): Promise<void>;
  setupDirectory(directory: string): Promise<AppSettings>;
  dataDirInfo(): Promise<{ current: string; source: 'env' | 'chosen' | 'legacy' | 'portable' | 'userData'; portable: string; userData: string; installBase: string }>;
  setDataDir(directory: string): Promise<{ restartRequired: boolean; dataDir: string }>;
  pickDirectory(title?: string, defaultPath?: string): Promise<string | undefined>;
  finishSetup(skipCloud: boolean): Promise<AppSettings>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  listTools(): Promise<{ name: string; description: string }[]>;
  feedbackDiagnostics(): Promise<DiagnosticEntry[]>;
  clearFeedbackDiagnostics(): Promise<void>;
  copyFeedback(text: string): Promise<void>;
  checkForUpdates(): Promise<AppUpdateResult>;
  updateStatus(): Promise<AppUpdateProgress>;
  downloadUpdate(): Promise<AppUpdateProgress>;
  cancelUpdate(): Promise<void>;
  installUpdate(): Promise<AppUpdateProgress>;
  bootstrap(): Promise<BootstrapPayload>;
  mobileSync(action: string, payload?: unknown): Promise<any>;
  onSyncData(listener: () => void): () => void;
  usage(query: UsageQuery): Promise<UsageReport>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  testProvider(providerId: string, draft?: ProviderConfig, key?: string): Promise<ProviderTestResult>;
  listModels(providerId: string, draft?: ProviderConfig, key?: string): Promise<string[]>;
  listModelCatalog(providerId: string, draft?: ProviderConfig, key?: string): Promise<{ id: string; name?: string; contextWindowTokens?: number; maxOutputTokens?: number }[]>;
  saveBot(bot: Bot): Promise<Bot>;
  updateBotMetadata(botId: string, patch: BotMetadataPatch): Promise<Bot>;
  updateBotGroup(name: string, action: BotGroupAction, workspaceId?: string): Promise<AppSettings>;
  copyConversationId(botId: string): Promise<string>;
  deleteBot(botId: string): Promise<void>;
  send(input: SendMessageInput): Promise<SendMessageResult>;
  stop(conversationId: string): Promise<boolean>;
  approve(decision: ApprovalDecision): Promise<void>;
  conversations(botId?: string): Promise<ConversationSummary[]>;
  conversation(id: string): Promise<Conversation | undefined>;
  botConversation(botId: string): Promise<Conversation>;
  setConversationMode(id: string, mode: 'execute' | 'plan'): Promise<Conversation>;
  setConversationAutonomy(id: string, autonomy: 'turn' | 'until_done'): Promise<Conversation>;
  activeGoal(conversationId: string): Promise<Goal | undefined>;
  goalState(conversationId: string): Promise<{ active?: Goal; resumable?: Goal; blocked?: Goal }>;
  reopenGoal(conversationId: string): Promise<Goal>;
  resumeGoal(conversationId: string, extraRounds?: number): Promise<Goal>;
  updateGoal(conversationId: string, patch: { status: 'complete' | 'blocked'; note?: string }): Promise<Goal>;
  listTodos(conversationId: string): Promise<TodoList | undefined>;
  answerQuestion(decision: { requestId: string; answer: string }): Promise<void>;
  contextUsage(conversationId: string): Promise<ContextUsageSnapshot | undefined>;
  continueSubagent(id: string, message: string): Promise<{ ok: boolean; text: string; error?: string }>;
  stopSubagent(id: string): Promise<boolean>;
  createGroup(title: string, memberBotIds: string[]): Promise<Conversation>;
  updateGroupChat(id: string, action: GroupChatAction): Promise<{ group: Conversation; settings: AppSettings }>;
  setGroupChatsCollapsed(workspaceId: string, collapsed: boolean): Promise<AppSettings>;
  cloud(): Promise<CloudStatus>;
  desktopOpen(): Promise<DesktopSession>;
  desktopTake(): Promise<DesktopSession>;
  desktopRelease(): Promise<DesktopSession>;
  desktopClose(): Promise<void>;
  desktopHeartbeat(): Promise<void>;
  local(): Promise<CloudStatus>;
  chooseLocalDirectory(): Promise<AppSettings>;
  cloudAction(action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop'): Promise<CloudStatus>;
  cloudExec(cmd: string, requestId?: string): Promise<ExecResult>;
  localExec(cmd: string, requestId?: string): Promise<ExecResult>;
  stopTerminal(requestId: string): Promise<void>;
  ptyOpen(id: string, kind: 'local' | 'cloud', cols: number, rows: number): Promise<{ pid: number }>;
  ptyInput(id: string, data: string): Promise<void>;
  ptyResize(id: string, cols: number, rows: number): Promise<void>;
  ptyClose(id: string): Promise<void>;
  onPtyData(listener: (payload: { id: string; data: string }) => void): () => void;
  onPtyExit(listener: (payload: { id: string; exitCode: number }) => void): () => void;
  saveCloud(patch: Partial<AppSettings['cloud']>, apiKey?: string): Promise<CloudStatus>;
  schedules(): Promise<Schedule[]>;
  updateSchedule(botId: string, id: string, patch: ScheduleUpdate): Promise<Schedule>;
  addSchedule(input: { botId: string; cron: string; prompt: string }): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  toggleSchedule(id: string): Promise<Schedule[]>;
  memories(botId?: string): Promise<MemoryFact[]>;
  addMemory(botId: string, text: string): Promise<MemoryFact>;
  updateMemory(id: string, patch: { text?: string; pinned?: boolean }): Promise<MemoryFact>;
  deleteMemory(id: string): Promise<void>;
  memoryScopes(): Promise<MemoryScopeSummary[]>;
  memoryPath(): Promise<string>;
  openMemoryFolder(scopeId?: string): Promise<void>;
  exportMemories(): Promise<string>;
  saveEmbeddingKey(key: string): Promise<void>;
  testEmbedding(draft?: EmbeddingSettings, draftKey?: string): Promise<EmbeddingTestResult>;
  openArtifact(relPath: string): Promise<void>;
  saveArtifact(relPath: string): Promise<void>;
  revealArtifact(relPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  win(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  onCloud(listener: (status: CloudStatus) => void): () => void;
  onLocal(listener: (status: CloudStatus) => void): () => void;
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    moyu: MoyuBridge;
  }
}

export const moyu = (): MoyuBridge => {
  if (!window.moyu) throw new Error('MoyuBridge 未注入：请通过桌面端启动');
  return window.moyu;
};

/** Turn a workspace-relative artifact path into a readable URL. */
export function assetUrl(relative?: string): string | undefined {
  if (!relative) return undefined;
  return `moyu-asset://local/${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
}
