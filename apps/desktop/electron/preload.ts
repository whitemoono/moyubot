import { contextBridge, ipcRenderer } from 'electron';
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
import type { ConversationSummary } from '@moyu/core';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  bootstrap: () => invoke<BootstrapPayload>('moyu:bootstrap'),
  saveSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>('moyu:settings:save', patch),
  setProviderKey: (providerId: string, key: string) => invoke<void>('moyu:provider:key', { providerId, key }),
  setTelegramToken: (token: string) => invoke<void>('moyu:telegram:token', token),
  testProvider: (providerId: string) => invoke<ProviderTestResult>('moyu:provider:test', providerId),
  listModels: (providerId: string) => invoke<string[]>('moyu:provider:models', providerId),
  saveBot: (bot: Bot) => invoke<Bot>('moyu:bot:save', bot),
  deleteBot: (botId: string) => invoke<void>('moyu:bot:delete', botId),

  send: (input: SendMessageInput) => invoke<SendMessageResult>('moyu:send', input),
  stop: (conversationId: string) => invoke<boolean>('moyu:stop', conversationId),
  approve: (decision: ApprovalDecision) => invoke<void>('moyu:approve', decision),
  conversations: (botId?: string) => invoke<ConversationSummary[]>('moyu:conversations', botId),
  conversation: (id: string) => invoke<Conversation | undefined>('moyu:conversation', id),
  newConversation: (botId: string) => invoke<Conversation>('moyu:conversation:new', botId),
  deleteConversation: (id: string) => invoke<void>('moyu:conversation:delete', id),

  cloud: () => invoke<CloudStatus>('moyu:cloud'),
  cloudAction: (action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop') => invoke<CloudStatus>('moyu:cloud:action', action),
  cloudExec: (cmd: string) => invoke<ExecResult>('moyu:cloud:exec', cmd),
  saveCloud: (patch: Partial<AppSettings['cloud']>, apiKey?: string) =>
    invoke<CloudStatus>('moyu:cloud:save', { patch, apiKey }),

  schedules: () => invoke<Schedule[]>('moyu:schedules'),
  addSchedule: (input: { botId: string; cron: string; prompt: string }) => invoke<Schedule>('moyu:schedule:add', input),
  deleteSchedule: (id: string) => invoke<void>('moyu:schedule:delete', id),
  toggleSchedule: (id: string) => invoke<Schedule[]>('moyu:schedule:toggle', id),

  memories: (botId?: string) => invoke<MemoryFact[]>('moyu:memories', botId),
  addMemory: (botId: string, text: string) => invoke<MemoryFact>('moyu:memory:add', { botId, text }),
  deleteMemory: (id: string) => invoke<void>('moyu:memory:delete', id),

  openArtifact: (relPath: string) => invoke<void>('moyu:artifact:open', relPath),
  openExternal: (url: string) => invoke<void>('moyu:open-external', url),
  win: (action: 'minimize' | 'maximize' | 'close') => invoke<void>('moyu:win', action),

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
  platform: process.platform,
  isElectron: true,
};

export type MoyuApi = typeof api;

contextBridge.exposeInMainWorld('moyu', api);