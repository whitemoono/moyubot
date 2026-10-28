import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AgentEvent,
  AppSettings,
  ApprovalRequest,
  Bot,
  CloudStatus,
  Conversation,
  MemoryFact,
  Message,
  Schedule,
} from '@moyu/core';
import { moyu } from './lib/bridge';
import type { ConversationSummary } from './lib/bridge';

export type View = 'chat' | 'bots' | 'cloud' | 'tasks' | 'settings';

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
}

interface MoyuContextValue {
  ready: boolean;
  settings: AppSettings;
  cloud: CloudStatus;
  secrets: { providerKeys: Record<string, boolean>; cloudKey: boolean; telegramToken: boolean; encrypted: boolean };
  view: View;
  setView: (view: View) => void;
  bot: Bot | undefined;
  selectBot: (botId: string) => void;
  conversation: Conversation | null;
  conversations: ConversationSummary[];
  running: boolean;
  agentPhase: string | null;
  approval: ApprovalRequest | null;
  schedules: Schedule[];
  memories: MemoryFact[];
  toasts: Toast[];
  logs: { level: string; text: string; ts: number }[];
  platform: string;
  version: string;
  sendMessage: (text: string, images: { name?: string; mimeType: string; dataUrl: string }[]) => Promise<void>;
  stop: () => void;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  saveBot: (bot: Bot) => Promise<void>;
  deleteBot: (botId: string) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  saveCloud: (patch: Partial<AppSettings['cloud']>, apiKey?: string) => Promise<void>;
  cloudAction: (action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop') => Promise<void>;
  saveProviderKey: (providerId: string, key: string) => Promise<void>;
  refreshSchedules: () => Promise<void>;
  addSchedule: (botId: string, cron: string, prompt: string) => Promise<Schedule>;
  toggleSchedule: (id: string) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  refreshMemories: () => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  respondApproval: (approved: boolean) => Promise<void>;
  toast: (text: string, level?: Toast['level']) => void;
}

const EMPTY_SETTINGS: AppSettings = {
  version: 1,
  providers: [],
  bots: [],
  cloud: {
    driver: 'mock',
    baseUrl: 'https://api.instabox.sh',
    machineName: 'moyubot-shared',
    templateId: 'agent-browser',
    autoSuspendAfterSeconds: 600,
    idleSuspendMinutes: 3,
    workspaceDir: '',
    wakeOnDemand: true,
  },
  telegram: { enabled: false, token: '', allowedIds: [] },
  ui: { accent: '#f5f5f5', appearance: 'dark', reduceMotion: false, density: 'comfortable', glassIntensity: 0.6 },
};

/** 浅色主题下把过亮的强调色压暗，免得选中边框 / 图标在白底上消失。 */
function readableAccent(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#111111' : hex;
}

/**
 * AgentEvent → vendored Grok 引擎的状态名（见 assets/grok/engine/tables.js 播放表）。
 * undefined 表示这个事件不改变表情。
 */
function agentPhaseForEvent(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'run_start':
    case 'reasoning':
    case 'tool_end':
    case 'message_end':
      return 'thinking';
    case 'delta':
      return 'writing';
    case 'tool_start': {
      const name = event.call.name;
      if (name === 'web_fetch' || name === 'recall') return 'searching';
      if (name === 'cloud_write' || name === 'remember') return 'writing';
      if (name === 'generate_image') return 'loading';
      if (name === 'schedule_task') return 'dictating';
      return 'working';
    }
    case 'run_end':
      return event.ok ? 'happy' : 'alerting';
    default:
      return undefined;
  }
}

const MoyuContext = createContext<MoyuContextValue | null>(null);

export function useMoyu(): MoyuContextValue {
  const value = useContext(MoyuContext);
  if (!value) throw new Error('useMoyu must be used inside MoyuProvider');
  return value;
}

let toastSeq = 0;

export function MoyuProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [cloud, setCloud] = useState<CloudStatus>({
    state: 'off',
    lastTransitionAt: Date.now(),
    awakeMs: 0,
    wakeCount: 0,
  });
  const [secrets, setSecrets] = useState<MoyuContextValue['secrets']>({
    providerKeys: {},
    cloudKey: false,
    telegramToken: false,
    encrypted: false,
  });
  const [view, setView] = useState<View>('chat');
  const [activeBotId, setActiveBotId] = useState<string>('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [runningConversations, setRunning] = useState<Set<string>>(new Set());
  const [agentPhase, setAgentPhase] = useState<string | null>(null);
  const phaseTimer = useRef<number>(0);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logs, setLogs] = useState<{ level: string; text: string; ts: number }[]>([]);
  const [platform, setPlatform] = useState('win32');
  const [version, setVersion] = useState('0.1.0');

  const conversationRef = useRef<Conversation | null>(null);
  conversationRef.current = conversation;
  const activeRunRef = useRef<string | null>(null);
  const runningRef = useRef<Set<string>>(new Set());

  const toast = useCallback((text: string, level: Toast['level'] = 'info') => {
    const id = `t${++toastSeq}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), level === 'error' ? 7000 : 4200);
  }, []);

  const bot = useMemo(() => settings.bots.find((item) => item.id === activeBotId) ?? settings.bots[0], [settings.bots, activeBotId]);

  const loadConversations = useCallback(async (botId?: string) => {
    const list = await moyu().conversations(botId);
    setConversations(list);
    return list;
  }, []);

  const patchMessage = useCallback((messageId: string, patch: (message: Message) => Message) => {
    setConversation((prev) => {
      if (!prev) return prev;
      let changed = false;
      const messages = prev.messages.map((message) => {
        if (message.id !== messageId) return message;
        changed = true;
        return patch(message);
      });
      return changed ? { ...prev, messages } : prev;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await moyu().bootstrap();
        if (cancelled) return;
        setSettings(boot.settings);
        setCloud(boot.cloud);
        setSecrets(boot.secrets);
        setSchedules(boot.schedules);
        setMemories(boot.memories);
        setPlatform(boot.platform);
        setVersion(boot.version);
        setView((boot.settings.activeView as View) || 'chat');
        const initialBot = boot.settings.activeBotId || boot.settings.bots[0]?.id;
        setActiveBotId(initialBot ?? '');
        setConversations(boot.conversations);
        const latest = boot.conversations.find((item) => item.botId === initialBot);
        if (latest) {
          const conv = await moyu().conversation(latest.id);
          if (!cancelled) setConversation(conv ?? null);
        }
        setReady(true);
      } catch (error) {
        toast((error as Error).message, 'error');
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    const off = moyu().onEvent((event: AgentEvent) => {
      const phase = agentPhaseForEvent(event);
      if (phase !== undefined) {
        if (phaseTimer.current) window.clearTimeout(phaseTimer.current);
        setAgentPhase(phase);
        if (event.type === 'run_end') phaseTimer.current = window.setTimeout(() => setAgentPhase(null), 2400);
      }
      if (event.type === 'run_start') {
        activeRunRef.current = event.conversationId;
        runningRef.current = new Set(runningRef.current).add(event.conversationId);
        setRunning(new Set(runningRef.current));
        return;
      }
      if (event.type === 'delta') {
        patchMessage(event.messageId, (message) => ({ ...message, content: message.content + event.text }));
        return;
      }
      if (event.type === 'reasoning') {
        patchMessage(event.messageId, (message) => ({ ...message, reasoning: (message.reasoning ?? '') + event.text }));
        return;
      }
      if (event.type === 'message_start') {
        const current = conversationRef.current;
        if (!current) return;
        if (current.messages.some((message) => message.id === event.message.id)) return;
        setConversation({ ...current, messages: [...current.messages, event.message] });
        return;
      }
      if (event.type === 'tool_start') {
        patchMessage(event.messageId, (message) => ({
          ...message,
          toolCalls: [...(message.toolCalls ?? []).filter((call) => call.id !== event.call.id), event.call],
        }));
        return;
      }
      if (event.type === 'tool_end') {
        patchMessage(event.messageId, (message) => ({
          ...message,
          toolResults: [...(message.toolResults ?? []).filter((item) => item.id !== event.result.id), event.result],
        }));
        return;
      }
      if (event.type === 'message_end') {
        patchMessage(event.message.id, () => event.message);
        return;
      }
      if (event.type === 'run_end') {
        const id = activeRunRef.current;
        if (id) {
          const next = new Set(runningRef.current);
          next.delete(id);
          runningRef.current = next;
          setRunning(next);
        }
        if (!event.ok && event.error) toast(event.error, 'error');
        void loadConversations();
        return;
      }
      if (event.type === 'approval') {
        setApproval(event.request);
        return;
      }
      if (event.type === 'approval_done') {
        setApproval((prev) => (prev?.id === event.requestId ? null : prev));
        return;
      }
      if (event.type === 'log') {
        setLogs((prev) => [...prev.slice(-80), { level: event.level, text: event.text, ts: Date.now() }]);
        if (event.level !== 'info') toast(event.text, event.level === 'error' ? 'error' : 'warn');
      }
    });
    const offCloud = moyu().onCloud((status) => setCloud(status));
    return () => {
      off();
      offCloud();
    };
  }, [patchMessage, toast, loadConversations]);

  useEffect(() => {
    if (!activeBotId) return;
    void loadConversations();
    void moyu().memories(activeBotId).then(setMemories).catch(() => undefined);
  }, [activeBotId, loadConversations]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--glass-alpha', String(settings.ui.glassIntensity));
    root.dataset.density = settings.ui.density;
    const applyAppearance = () => {
      const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const light = settings.ui.appearance === 'light' || (settings.ui.appearance === 'system' && systemLight);
      root.dataset.theme = light ? 'light' : 'dark';
      root.style.setProperty('--accent', light ? readableAccent(settings.ui.accent) : settings.ui.accent);
    };
    applyAppearance();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', applyAppearance);
    return () => media.removeEventListener('change', applyAppearance);
  }, [settings.ui.accent, settings.ui.appearance, settings.ui.density, settings.ui.glassIntensity]);

  const selectBot = useCallback(
    (botId: string) => {
      setActiveBotId(botId);
      void (async () => {
        const list = await loadConversations(botId);
        const latest = list.find((item) => item.botId === botId);
        if (latest) setConversation((await moyu().conversation(latest.id)) ?? null);
        else setConversation(null);
        void moyu().memories(botId).then(setMemories);
      })();
      setView('chat');
    },
    [loadConversations],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      const conv = await moyu().conversation(id);
      if (conv) {
        setConversation(conv);
        setActiveBotId(conv.botId);
        setView('chat');
      }
    },
    [],
  );

  const newConversation = useCallback(async () => {
    if (!bot) return;
    const conv = await moyu().newConversation(bot.id);
    setConversation(conv);
    await loadConversations(bot.id);
    setView('chat');
  }, [bot, loadConversations]);

  const deleteConversation = useCallback(
    async (id: string) => {
      await moyu().deleteConversation(id);
      if (conversationRef.current?.id === id) setConversation(null);
      await loadConversations();
    },
    [loadConversations],
  );

  const sendMessage = useCallback(
    async (text: string, images: { name?: string; mimeType: string; dataUrl: string }[]) => {
      if (!bot) {
        toast('先创建一个 Bot', 'warn');
        return;
      }
      const trimmed = text.trim();
      if (!trimmed && images.length === 0) return;
      const optimisticUserId = `tmp_${Date.now()}`;
      const optimistic: Conversation = conversation ?? {
        id: 'pending',
        botId: bot.id,
        title: '新对话',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversation({
        ...optimistic,
        messages: [
          ...optimistic.messages,
          {
            id: optimisticUserId,
            role: 'user',
            content: trimmed,
            createdAt: Date.now(),
            attachments: images.map((image, index) => ({
              id: `att_tmp_${index}`,
              kind: 'image' as const,
              name: image.name ?? '图片',
              mimeType: image.mimeType,
              dataUrl: image.dataUrl,
            })),
          },
        ],
      });
      try {
        const result = await moyu().send({
          conversationId: conversation?.id,
          botId: bot.id,
          text: trimmed,
          images,
        });
        setConversation((prev) => {
          if (!prev) return prev;
          const withoutTemp = prev.messages.filter((message) => message.id !== optimisticUserId);
          if (withoutTemp.some((message) => message.id === result.assistantMessageId)) return { ...prev, id: result.conversationId };
          return {
            ...prev,
            id: result.conversationId,
            messages: [
              ...withoutTemp,
              {
                id: result.userMessageId,
                role: 'user',
                content: trimmed,
                createdAt: Date.now(),
                attachments: images.map((image, index) => ({
                  id: `att_${index}`,
                  kind: 'image' as const,
                  name: image.name ?? '图片',
                  mimeType: image.mimeType,
                  dataUrl: image.dataUrl,
                })),
              },
              {
                id: result.assistantMessageId,
                role: 'assistant',
                content: '',
                createdAt: Date.now(),
                model: bot.model,
                streaming: true,
                toolCalls: [],
                toolResults: [],
              },
            ],
          };
        });
        runningRef.current = new Set(runningRef.current).add(result.conversationId);
        setRunning(new Set(runningRef.current));
      } catch (error) {
        toast((error as Error).message, 'error');
        setConversation((prev) =>
          prev ? { ...prev, messages: prev.messages.filter((message) => message.id !== optimisticUserId) } : prev,
        );
      }
    },
    [bot, conversation, toast],
  );

  const stop = useCallback(() => {
    if (!conversation) return;
    void moyu().stop(conversation.id);
  }, [conversation]);

  const saveBot = useCallback(
    async (nextBot: Bot) => {
      const saved = await moyu().saveBot(nextBot);
      setSettings((prev) => {
        const exists = prev.bots.some((item) => item.id === saved.id);
        return { ...prev, bots: exists ? prev.bots.map((item) => (item.id === saved.id ? saved : item)) : [...prev.bots, saved] };
      });
      setActiveBotId(saved.id);
      toast(`已保存 ${saved.name}`);
    },
    [toast],
  );

  const deleteBot = useCallback(
    async (botId: string) => {
      await moyu().deleteBot(botId);
      setSettings((prev) => ({ ...prev, bots: prev.bots.filter((item) => item.id !== botId) }));
      toast('Bot 已删除');
    },
    [toast],
  );

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await moyu().saveSettings(patch);
    setSettings(next);
  }, []);

  const saveCloud = useCallback(
    async (patch: Partial<AppSettings['cloud']>, apiKey?: string) => {
      const status = await moyu().saveCloud(patch, apiKey);
      setCloud(status);
      if (apiKey !== undefined) setSecrets((prev) => ({ ...prev, cloudKey: Boolean(apiKey.trim()) }));
      setSettings((prev) => ({ ...prev, cloud: { ...prev.cloud, ...patch } }));
      toast('云电脑设置已保存');
    },
    [toast],
  );

  const cloudAction = useCallback(
    async (action: 'wake' | 'sleep' | 'refresh' | 'start' | 'stop') => {
      try {
        const status = await moyu().cloudAction(action);
        setCloud(status);
      } catch (error) {
        toast((error as Error).message, 'error');
      }
    },
    [toast],
  );

  const saveProviderKey = useCallback(async (providerId: string, key: string) => {
    await moyu().setProviderKey(providerId, key);
    setSecrets((prev) => ({ ...prev, providerKeys: { ...prev.providerKeys, [providerId]: Boolean(key) } }));
  }, []);

  const refreshSchedules = useCallback(async () => setSchedules(await moyu().schedules()), []);
  const addSchedule = useCallback(
    async (botId: string, cron: string, prompt: string) => {
      const schedule = await moyu().addSchedule({ botId, cron, prompt });
      setSchedules(await moyu().schedules());
      return schedule;
    },
    [],
  );
  const toggleSchedule = useCallback(async (id: string) => {
    setSchedules(await moyu().toggleSchedule(id));
  }, []);
  const deleteSchedule = useCallback(
    async (id: string) => {
      await moyu().deleteSchedule(id);
      setSchedules(await moyu().schedules());
    },
    [],
  );
  const refreshMemories = useCallback(async () => {
    if (activeBotId) setMemories(await moyu().memories(activeBotId));
  }, [activeBotId]);
  const addMemory = useCallback(
    async (text: string) => {
      if (!activeBotId) return;
      await moyu().addMemory(activeBotId, text);
      await refreshMemories();
    },
    [activeBotId, refreshMemories],
  );
  const deleteMemory = useCallback(
    async (id: string) => {
      await moyu().deleteMemory(id);
      await refreshMemories();
    },
    [refreshMemories],
  );

  const respondApproval = useCallback(
    async (approved: boolean) => {
      if (!approval) return;
      await moyu().approve({ requestId: approval.id, approved });
      setApproval(null);
    },
    [approval],
  );

  const value: MoyuContextValue = {
    ready,
    settings,
    cloud,
    secrets,
    view,
    setView: (next) => {
      setView(next);
      void moyu().saveSettings({ activeView: next });
    },
    bot,
    selectBot,
    conversation,
    conversations,
    running: conversation ? runningConversations.has(conversation.id) : false,
    agentPhase,
    approval,
    schedules,
    memories,
    toasts,
    logs,
    platform,
    version,
    sendMessage,
    stop,
    selectConversation,
    newConversation,
    deleteConversation,
    saveBot,
    deleteBot,
    saveSettings,
    saveCloud,
    cloudAction,
    saveProviderKey,
    refreshSchedules,
    addSchedule,
    toggleSchedule,
    deleteSchedule,
    refreshMemories,
    addMemory,
    deleteMemory,
    respondApproval,
    toast,
  };

  return <MoyuContext.Provider value={value}>{children}</MoyuContext.Provider>;
}