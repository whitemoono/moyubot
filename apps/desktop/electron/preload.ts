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
} from '@mesh/core';
import type { ConversationSummary } from '@mesh/core';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  bootstrap: () => invoke<BootstrapPayload>('mesh:bootstrap'),
  saveSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>('mesh:settings:save', patch),
  setProviderKey: (providerId: string, key: string) => invoke<void>('mesh:provider:key', { providerId, key }),
  setTelegramToken: (token: string) => invoke<void>('mesh:telegram:token', token),
  testProvider: (providerId: string) => invoke<ProviderTestResult>('mesh:provider:test', providerId),
  listModels: (providerId: string) => invoke<string[]>('mesh:provider:models', providerId),
  saveBot: (bot: Bot) => invoke<Bot>('mesh:bot:save', bot),
  deleteBot: (botId: string) => invoke<void>('mesh:bot:delete', botId),

  send: (input: SendMessageInput) => invoke<SendMessageResult>('mesh:send', input),
  stop: (conversationId: string) => invoke<boolean>('mesh:stop', conversationId),
  approve: (decision: ApprovalDecision) => invoke<void>('mesh:approve', decision),
  conversations: (botId?: string) => invoke<ConversationSummary[]>('mesh:conversations', botId),
  conversation: (id: string) => invoke<Conversation | undefined>('mesh:conversation', id),
  newConversation: (botId: string) => invoke<Conversation>('mesh:conversation:new', botId),
  deleteConversation: (id: string) => invoke<void>('mesh:conversation:delete', id),

  cloud: () => invoke<CloudStatus>('mesh:cloud'),
  cloudAction: (action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop') => invoke<CloudStatus>('mesh:cloud:action', action),
  cloudExec: (cmd: string) => invoke<ExecResult>('mesh:cloud:exec', cmd),
  saveCloud: (patch: Partial<AppSettings['cloud']>, apiKey?: string) =>
    invoke<CloudStatus>('mesh:cloud:save', { patch, apiKey }),

  schedules: () => invoke<Schedule[]>('mesh:schedules'),
  addSchedule: (input: { botId: string; cron: string; prompt: string }) => invoke<Schedule>('mesh:schedule:add', input),
  deleteSchedule: (id: string) => invoke<void>('mesh:schedule:delete', id),
  toggleSchedule: (id: string) => invoke<Schedule[]>('mesh:schedule:toggle', id),

  memories: (botId?: string) => invoke<MemoryFact[]>('mesh:memories', botId),
  addMemory: (botId: string, text: string) => invoke<MemoryFact>('mesh:memory:add', { botId, text }),
  deleteMemory: (id: string) => invoke<void>('mesh:memory:delete', id),

  openArtifact: (relPath: string) => invoke<void>('mesh:artifact:open', relPath),
  openExternal: (url: string) => invoke<void>('mesh:open-external', url),
  win: (action: 'minimize' | 'maximize' | 'close') => invoke<void>('mesh:win', action),

  onEvent: (listener: (event: AgentEvent) => void) => {
    const handler = (_event: unknown, payload: AgentEvent) => listener(payload);
    ipcRenderer.on('mesh:event', handler);
    return () => ipcRenderer.removeListener('mesh:event', handler);
  },
  onCloud: (listener: (status: CloudStatus) => void) => {
    const handler = (_event: unknown, payload: CloudStatus) => listener(payload);
    ipcRenderer.on('mesh:cloud', handler);
    return () => ipcRenderer.removeListener('mesh:cloud', handler);
  },
  platform: process.platform,
  isElectron: true,
};

export type MeshApi = typeof api;

contextBridge.exposeInMainWorld('mesh', api);