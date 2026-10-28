import type {
  AgentEvent,
  AppSettings,
  ApprovalDecision,
  Bot,
  BootstrapPayload,
  CloudStatus,
  Conversation,
  ExecResult,
  MemoryFact,
  ProviderTestResult,
  Schedule,
  SendMessageInput,
  SendMessageResult,
} from '@moyu/core';

export interface ConversationSummary {
  id: string;
  botId: string;
  title: string;
  updatedAt: number;
  preview?: string;
}

export interface MoyuBridge {
  bootstrap(): Promise<BootstrapPayload>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  setTelegramToken(token: string): Promise<void>;
  testProvider(providerId: string): Promise<ProviderTestResult>;
  listModels(providerId: string): Promise<string[]>;
  saveBot(bot: Bot): Promise<Bot>;
  deleteBot(botId: string): Promise<void>;
  send(input: SendMessageInput): Promise<SendMessageResult>;
  stop(conversationId: string): Promise<boolean>;
  approve(decision: ApprovalDecision): Promise<void>;
  conversations(botId?: string): Promise<ConversationSummary[]>;
  conversation(id: string): Promise<Conversation | undefined>;
  newConversation(botId: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  cloud(): Promise<CloudStatus>;
  cloudAction(action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop'): Promise<CloudStatus>;
  cloudExec(cmd: string): Promise<ExecResult>;
  saveCloud(patch: Partial<AppSettings['cloud']>, apiKey?: string): Promise<CloudStatus>;
  schedules(): Promise<Schedule[]>;
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