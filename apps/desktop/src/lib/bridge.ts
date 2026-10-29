import type {
  AppUpdateResult,
  AgentEvent,
  AppSettings,
  ApprovalDecision,
  Bot,
  BotMetadataPatch,
  BotGroupAction,
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
  setupDirectory(directory: string): Promise<AppSettings>;
  finishSetup(skipCloud: boolean): Promise<AppSettings>;
  feedbackDiagnostics(): Promise<DiagnosticEntry[]>;
  clearFeedbackDiagnostics(): Promise<void>;
  copyFeedback(text: string): Promise<void>;
  checkForUpdates(): Promise<AppUpdateResult>;
  bootstrap(): Promise<BootstrapPayload>;
  usage(query: UsageQuery): Promise<UsageReport>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  testProvider(providerId: string, draft?: ProviderConfig, key?: string): Promise<ProviderTestResult>;
  listModels(providerId: string, draft?: ProviderConfig, key?: string): Promise<string[]>;
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
  createGroup(title: string, memberBotIds: string[]): Promise<Conversation>;
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
  saveCloud(patch: Partial<AppSettings['cloud']>, apiKey?: string): Promise<CloudStatus>;
  schedules(): Promise<Schedule[]>;
  updateSchedule(botId: string, id: string, patch: ScheduleUpdate): Promise<Schedule>;
  addSchedule(input: { botId: string; cron: string; prompt: string }): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  toggleSchedule(id: string): Promise<Schedule[]>;
  memories(botId?: string): Promise<MemoryFact[]>;
  addMemory(botId: string, text: string): Promise<MemoryFact>;
  deleteMemory(id: string): Promise<void>;
  openArtifact(relPath: string): Promise<void>;
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
