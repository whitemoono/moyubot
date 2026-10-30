import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AgentEvent,
  AppSettings,
  ApprovalRequest,
  Bot,
  BotMetadataPatch,
  BotGroupAction,
  GroupChatAction,
  CloudStatus,
  Conversation,
  MemoryFact,
  Message,
  Schedule,
  Workspace,
} from '@moyu/core';
import { moyu } from './lib/bridge';
import type { ConversationSummary } from './lib/bridge';
import { inferMessageActivity, updateActivities } from './lib/bot-activity';
import type { BotActivity, ConversationActivities } from './lib/bot-activity';
import { appendReplyProgress } from './lib/reply-flow';

export type View = 'chat' | 'bots' | 'cloud' | 'tasks' | 'settings';
export type SettingsSection = 'profile' | 'providers' | 'appearance' | 'about' | 'bots' | 'cloud' | 'usage' | 'feedback' | 'capabilities';

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
}

interface MoyuContextValue {
  ready: boolean;
  settings: AppSettings;
  cloud: CloudStatus;
  local: CloudStatus;
  workspaces: Workspace[];
  activeWorkspace: Workspace | undefined;
  selectWorkspace: (workspaceId: string) => void;
  chooseLocalDirectory: () => Promise<void>;
  completeSetup: (skipCloud: boolean) => Promise<void>;
  secrets: { providerKeys: Record<string, boolean>; cloudKey: boolean; telegramToken: boolean; encrypted: boolean };
  view: View;
  setView: (view: View) => void;
  settingsSection: SettingsSection;
  settingsOpen: boolean;
  closeSettings: () => void;
  openSettings: (section: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  bot: Bot | undefined;
  selectBot: (botId: string) => void;
  createGroup: (title: string, memberBotIds: string[]) => Promise<void>;
  updateGroupChat: (id: string, action: GroupChatAction) => Promise<void>;
  setGroupChatsCollapsed: (collapsed: boolean) => Promise<void>;
  runningGroupIds: Set<string>;
  conversation: Conversation | null;
  conversations: ConversationSummary[];
  running: boolean;
  runningBotIds: Set<string>;
  compacting: boolean;
  botActivities: Record<string, BotActivity>;
  approval: ApprovalRequest | null;
  schedules: Schedule[];
  memories: MemoryFact[];
  toasts: Toast[];
  logs: { level: string; text: string; ts: number }[];
  platform: string;
  version: string;
  sendMessage: (text: string, images: { name?: string; mimeType: string; dataUrl: string }[], replyTo?: Message['replyTo']) => Promise<boolean>;
  stop: () => void;
  saveBot: (bot: Bot, options?: { stayInSettings?: boolean }) => Promise<void>;
  updateBotMetadata: (botId: string, patch: BotMetadataPatch) => Promise<void>;
  updateBotGroup: (name: string, action: BotGroupAction) => Promise<void>;
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
  workspaces: [
    { id: 'workspace_cloud', name: '云电脑工作区', kind: 'cloud', computerName: '共享云电脑', createdAt: 0 },
    { id: 'workspace_local', name: '本地工作区', kind: 'local', computerName: '本机 Windows', createdAt: 0 },
  ],
  activeWorkspaceId: 'workspace_cloud',
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [activeBotId, setActiveBotId] = useState<string>('');
  const [local, setLocal] = useState<CloudStatus>({ state: 'ready', lastTransitionAt: Date.now(), awakeMs: 0, wakeCount: 0 });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [runningConversations, setRunning] = useState<Set<string>>(new Set());
  const [compactingConversations, setCompacting] = useState<Set<string>>(new Set());
  const [activities, setActivities] = useState<ConversationActivities>({});
  const activityTimers = useRef(new Map<string, number>());
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logs, setLogs] = useState<{ level: string; text: string; ts: number }[]>([]);
  const [platform, setPlatform] = useState('win32');
  const [version, setVersion] = useState('0.1.1');

  const conversationRef = useRef<Conversation | null>(null);
  conversationRef.current = conversation;
  const selectedBotRef = useRef(activeBotId);
  selectedBotRef.current = activeBotId;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const viewRef = useRef(view);
  viewRef.current = view;
  const runningRef = useRef<Set<string>>(new Set());

  const toast = useCallback((text: string, level: Toast['level'] = 'info') => {
    const id = `t${++toastSeq}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), level === 'error' ? 7000 : 4200);
  }, []);

  const workspaces = settings.workspaces ?? [];
  const activeWorkspace = workspaces.find((item) => item.id === settings.activeWorkspaceId) ?? workspaces[0];
  const workspaceBots = useMemo(() => settings.bots.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id), [settings.bots, activeWorkspace?.id]);
  const workspaceConversations = conversations.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id);
  const bot = useMemo(() => workspaceBots.find((item) => item.id === activeBotId) ?? workspaceBots.find((item) => conversations.find((conv) => conv.id === activeBotId)?.group?.memberBotIds.includes(item.id)) ?? workspaceBots[0], [workspaceBots, activeBotId, conversations]);

  const loadConversations = useCallback(async () => {
    const list = await moyu().conversations();
    setConversations(list);
    return list;
  }, []);

  // Settings replies may arrive after a workspace switch. Apply data changes
  // without restoring the selection that was active when the request started.
  const applySavedSettings = useCallback((next: AppSettings) => {
    setSettings((previous) => ({
      ...next,
      activeWorkspaceId: previous.activeWorkspaceId,
      activeBotId: previous.activeBotId,
      activeView: previous.activeView,
      workspaces: next.workspaces.map((workspace) => ({ ...workspace, activeBotId: previous.workspaces.find((item) => item.id === workspace.id)?.activeBotId })),
    }));
  }, []);

  const updateBotMetadata = useCallback(async (botId: string, patch: BotMetadataPatch) => {
    const saved = await moyu().updateBotMetadata(botId, patch);
    setSettings((previous) => {
      const groups = previous.ui.botGroups ?? [];
      const name = saved.sidebar?.group;
      return { ...previous, ui: { ...previous.ui, botGroups: name && !groups.some((item) => item.name === name) ? [...groups, { name, collapsed: false }] : groups }, bots: previous.bots.map((item) => item.id === saved.id ? saved : item) };
    });
  }, []);

  const updateBotGroup = useCallback(async (name: string, action: BotGroupAction) => {
    applySavedSettings(await moyu().updateBotGroup(name, action, settingsRef.current.activeWorkspaceId));
  }, [applySavedSettings]);

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
        setLocal(await moyu().local());
        setSecrets(boot.secrets);
        setSchedules(boot.schedules);
        setMemories(boot.memories);
        setPlatform(boot.platform);
        setVersion(boot.version);
        const restoredSettings = ['settings', 'bots', 'cloud'].includes(boot.settings.activeView ?? '');
        setView(restoredSettings ? 'chat' : (boot.settings.activeView as View) || 'chat');
        setSettingsOpen(restoredSettings);
        if (boot.settings.activeView === 'bots' || boot.settings.activeView === 'cloud') setSettingsSection(boot.settings.activeView);
        const workspaceId = boot.settings.activeWorkspaceId ?? 'workspace_cloud';
        const preferred = boot.settings.workspaces.find((item) => item.id === workspaceId)?.activeBotId ?? boot.settings.activeBotId;
        const initialBot = boot.settings.bots.find((item) => item.id === preferred && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id ?? boot.conversations.find((item) => item.id === preferred && item.group && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id ?? boot.settings.bots.find((item) => (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id;
        setActiveBotId(initialBot ?? '');
        setConversations(boot.conversations);
        runningRef.current = new Set(boot.runningConversations);
        setRunning(new Set(boot.runningConversations));
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
    const offSync = moyu().onSyncData(() => {
      void moyu().bootstrap().then(async boot => {
        setSettings(boot.settings); setConversations(boot.conversations); setSchedules(boot.schedules);
        const current = conversationRef.current;
        if (current && !runningRef.current.has(current.id)) {
          const updated = await moyu().conversation(current.id);
          if (updated && conversationRef.current?.id === current.id) setConversation(updated);
        }
        setMemories(await moyu().memories(selectedBotRef.current));
      }).catch(error => toast(error.message, 'error'));
    });
    const off = moyu().onEvent((event: AgentEvent) => {
      setActivities((previous) => updateActivities(previous, event));
      if (event.type === 'run_start' || event.type === 'run_end') {
        window.clearTimeout(activityTimers.current.get(event.conversationId));
        activityTimers.current.delete(event.conversationId);
        if (event.type === 'run_end') {
          activityTimers.current.set(event.conversationId, window.setTimeout(() => {
            activityTimers.current.delete(event.conversationId);
            setActivities((previous) => previous[event.conversationId]?.runId === event.runId ? { ...previous, [event.conversationId]: { kind: 'idle' } } : previous);
          }, event.ok ? 2400 : 4000));
        }
      }
      if (event.type === 'run_start') {
        runningRef.current = new Set(runningRef.current).add(event.conversationId);
        setRunning(new Set(runningRef.current));
        return;
      }
      if (event.type === 'delta') {
        patchMessage(event.messageId, (message) => appendReplyProgress(message, event));
        return;
      }
      if (event.type === 'reasoning') {
        patchMessage(event.messageId, (message) => appendReplyProgress(message, event));
        return;
      }
      if (event.type === 'message_start') {
        const current = conversationRef.current;
        if (!current || current.id !== event.conversationId) return;
        if (current.messages.some((message) => message.id === event.message.id)) return;
        setConversation({ ...current, messages: [...current.messages, event.message] });
        return;
      }
      if (event.type === 'tool_start') {
        patchMessage(event.messageId, (message) => appendReplyProgress(message, event));
        return;
      }
      if (event.type === 'tool_end') {
        patchMessage(event.messageId, (message) => ({
          ...message,
          toolResults: [...(message.toolResults ?? []).filter((item) => item.id !== event.result.id), event.result],
        }));
        if (event.result.name === 'remember' && event.result.ok && conversationRef.current?.id === event.conversationId) {
          const selectedId = selectedBotRef.current;
          void moyu().memories(selectedId).then((facts) => { if (selectedId === selectedBotRef.current) setMemories(facts); }).catch((error: Error) => toast(error.message, 'error'));
        }
        return;
      }
      if (event.type === 'schedules') { setSchedules(event.schedules); return; }
      if (event.type === 'message_end') {
        patchMessage(event.message.id, () => event.message);
        return;
      }
      if (event.type === 'run_end') {
        const next = new Set(runningRef.current);
        next.delete(event.conversationId);
        runningRef.current = next;
        setRunning(next);
        if (!event.ok && event.error && event.error !== '已停止') toast(event.error, 'error');
        void loadConversations();
        void moyu().conversation(event.conversationId).then((conv) => {
          if (conv && settingsRef.current.bots.some((item) => item.id === conv.botId) && (conv.botId !== selectedBotRef.current || viewRef.current !== 'chat')) {
            void updateBotMetadata(conv.botId, { sidebar: { unread: true } }).catch((error: Error) => toast(error.message, 'error'));
          }
          if (conv && conv.botId === selectedBotRef.current && !runningRef.current.has(conv.id)) {
            setConversation((prev) => prev?.messages.some((message) => message.id.startsWith('tmp_')) ? prev : conv);
          }
        });
        const selectedId = selectedBotRef.current;
        void moyu().memories(selectedId).then((facts) => { if (selectedId === selectedBotRef.current) setMemories(facts); });
        return;
      }
      if (event.type === 'context_compaction') {
        setCompacting((prev) => {
          const next = new Set(prev);
          if (event.phase === 'start') next.add(event.conversationId);
          else next.delete(event.conversationId);
          return next;
        });
        if (event.context) setConversation((prev) => prev?.id === event.conversationId ? { ...prev, context: event.context } : prev);
        if (event.phase === 'done' && conversationRef.current?.id === event.conversationId) {
          const selectedId = selectedBotRef.current;
          void moyu().memories(selectedId).then((facts) => { if (selectedId === selectedBotRef.current) setMemories(facts); }).catch((error: Error) => toast(error.message, 'error'));
        }
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
    const offLocal = moyu().onLocal((status) => setLocal(status));
    return () => {
      offSync();
      off();
      offCloud();
      offLocal();
      activityTimers.current.forEach((timer) => window.clearTimeout(timer));
      activityTimers.current.clear();
    };
  }, [patchMessage, toast, loadConversations, updateBotMetadata]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const target = settingsRef.current.workspaces?.find((item) => item.id === workspaceId);
    if (!target) return;
    const preferred = settingsRef.current.bots.find((item) => item.id === target.activeBotId && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id ?? conversations.find((item) => item.group && item.id === target.activeBotId && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id;
    const next = preferred ?? settingsRef.current.bots.find((item) => (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id;
    const workspaces = settingsRef.current.workspaces.map((item) => item.id === settingsRef.current.activeWorkspaceId ? { ...item, activeBotId: selectedBotRef.current } : item);
    settingsRef.current = { ...settingsRef.current, activeWorkspaceId: workspaceId, activeBotId: next, workspaces };
    selectedBotRef.current = next ?? '';
    setSettings(settingsRef.current);
    setActiveBotId(next ?? ''); setConversation(null); setMemories([]); setSettingsOpen(false); setView('chat');
    void moyu().saveSettings({ activeWorkspaceId: workspaceId, workspaces, activeBotId: next, activeView: 'chat' }).catch((error: Error) => toast(error.message, 'error'));
  }, [toast, conversations]);

  useEffect(() => {
    if (!activeBotId) return;
    let cancelled = false;
    void loadConversations();
    void Promise.all([settingsRef.current.bots.some((item) => item.id === activeBotId) ? moyu().botConversation(activeBotId) : moyu().conversation(activeBotId), moyu().memories(activeBotId)]).then(([conv, facts]) => {
      if (conv && !cancelled && selectedBotRef.current === activeBotId) { setConversation(conv); setMemories(facts); }
    }).catch((error: Error) => { if (!cancelled) toast(error.message, 'error'); });
    return () => { cancelled = true; };
  }, [activeBotId, loadConversations, toast]);

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
    (botId: string, preserveSettings = false) => {
      if (!preserveSettings) setSettingsOpen(false);
      const target = settingsRef.current.bots.find((item) => item.id === botId && (item.workspaceId ?? 'workspace_cloud') === settingsRef.current.activeWorkspaceId);
      const group = conversations.find((item) => item.id === botId && item.group && (item.workspaceId ?? 'workspace_cloud') === settingsRef.current.activeWorkspaceId);
      if (!target && !group && settingsRef.current.bots.some((item) => item.id === botId)) return;
      if (target?.sidebar?.unread) void updateBotMetadata(botId, { sidebar: { unread: false } }).catch((error: Error) => toast(error.message, 'error'));
      selectedBotRef.current = botId;
      if (conversationRef.current?.botId !== botId) { setConversation(null); setMemories([]); }
      setActiveBotId(botId);
      const workspaces = settingsRef.current.workspaces.map((item) => item.id === settingsRef.current.activeWorkspaceId ? { ...item, activeBotId: botId } : item);
      settingsRef.current = { ...settingsRef.current, activeBotId: botId, workspaces };
      setSettings((previous) => ({ ...previous, activeBotId: botId, workspaces }));
      void moyu().saveSettings({ activeBotId: botId, workspaces, activeView: 'chat' });
      setView('chat');
    },
    [updateBotMetadata, toast, conversations],
  );

  const sendMessage = useCallback(
    async (text: string, images: { name?: string; mimeType: string; dataUrl: string }[], replyTo?: Message['replyTo']) => {
      if (!bot || !conversation || (!conversation.group && conversation.botId !== bot.id)) {
        toast('先创建一个 Bot', 'warn');
        return false;
      }
      const trimmed = text.trim();
      if (!trimmed && images.length === 0) return false;
      const optimisticUserId = `tmp_${Date.now()}`;
      setActivities((previous) => ({ ...previous, [conversation.id]: { kind: 'sending' } }));
      const optimistic: Conversation = conversation ?? {
        id: 'pending',
        botId: bot.id,
        title: bot.name,
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
            replyTo,
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
          replyTo: replyTo ? { messageId: replyTo.messageId, selectedText: conversation.messages.find((message) => message.id === replyTo.messageId)?.content ? replyTo.content : undefined } : undefined,
        });
        setConversation((prev) => {
          if (!prev || prev.id !== conversation.id) return prev;
          const messages = prev.messages.map((message) => message.id === optimisticUserId ? { ...message, id: result.userMessageId } : message);
          if (messages.some((message) => message.id === result.assistantMessageId)) return { ...prev, id: result.conversationId, messages };
          return {
            ...prev,
            id: result.conversationId,
            messages: [
              ...messages,
              {
                id: result.assistantMessageId,
                role: 'assistant',
                botId: conversation.group ? conversation.group.memberBotIds.find((id) => settingsRef.current.bots.some((item) => item.id === id)) : undefined,
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
        return true;
      } catch (error) {
        setActivities((previous) => ({ ...previous, [conversation.id]: { kind: 'error' } }));
        toast((error as Error).message, 'error');
        setConversation((prev) =>
          prev?.id === conversation.id ? { ...prev, messages: prev.messages.filter((message) => message.id !== optimisticUserId) } : prev,
        );
        return false;
      }
    },
    [bot, conversation, toast],
  );

  const createGroup = useCallback(async (title: string, memberBotIds: string[]) => {
    const group = await moyu().createGroup(title, memberBotIds);
    await loadConversations();
    selectBot(group.id);
  }, [loadConversations, selectBot]);

  const setGroupChatsCollapsed = useCallback(async (collapsed: boolean) => {
    applySavedSettings(await moyu().setGroupChatsCollapsed(settingsRef.current.activeWorkspaceId ?? 'workspace_cloud', collapsed));
  }, [applySavedSettings]);

  const updateGroupChat = useCallback(async (id: string, action: GroupChatAction) => {
    const result = await moyu().updateGroupChat(id, action);
    applySavedSettings(result.settings);
    const list = await loadConversations();
    if (action.type === 'delete') {
      if (selectedBotRef.current === id) {
        const workspaceId = settingsRef.current.activeWorkspaceId;
        const next = settingsRef.current.bots.find((item) => (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id ?? list.find((item) => item.group && item.workspaceId === workspaceId)?.id;
        if (next) selectBot(next);
        else { selectedBotRef.current = ''; setActiveBotId(''); setConversation(null); setMemories([]); }
      }
      toast('群聊已删除，历史记录已保留');
    } else if (action.type === 'edit') {
      setConversation((previous) => previous?.id === id ? { ...previous, title: result.group.title, group: result.group.group } : previous);
      toast('群聊已保存');
    }
  }, [applySavedSettings, loadConversations, selectBot, toast]);

  const stop = useCallback(() => {
    if (!conversation) return;
    void moyu().stop(conversation.id);
  }, [conversation]);

  const saveBot = useCallback(
    async (nextBot: Bot, options?: { stayInSettings?: boolean }) => {
      const saved = await moyu().saveBot({ ...nextBot, workspaceId: nextBot.workspaceId ?? settingsRef.current.activeWorkspaceId });
      setSettings((prev) => {
        const exists = prev.bots.some((item) => item.id === saved.id);
        return { ...prev, bots: exists ? prev.bots.map((item) => (item.id === saved.id ? saved : item)) : [...prev.bots, saved] };
      });
      if (!options?.stayInSettings && saved.workspaceId === settingsRef.current.activeWorkspaceId) selectBot(saved.id);
      toast(`已保存 ${saved.name}`);
    },
    [toast, selectBot],
  );

  const deleteBot = useCallback(
    async (botId: string) => {
      await moyu().deleteBot(botId);
      setSettings((prev) => ({ ...prev, bots: prev.bots.filter((item) => item.id !== botId) }));
      if (selectedBotRef.current === botId) {
        const next = workspaceBots.find((item) => item.id !== botId);
        if (next) selectBot(next.id, true);
        else { setActiveBotId(''); setConversation(null); setMemories([]); setView('chat'); setSettingsSection('bots'); setSettingsOpen(true); }
      }
      toast('Bot 已删除');
    },
    [toast, workspaceBots, selectBot],
  );

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const scoped = patch.bots ? { ...patch, bots: [...settingsRef.current.bots.filter((item) => (item.workspaceId ?? 'workspace_cloud') !== settingsRef.current.activeWorkspaceId), ...patch.bots] } : patch;
    const next = await moyu().saveSettings(scoped);
    applySavedSettings(next);
  }, [applySavedSettings]);

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
    if (!activeBotId) return;
    const facts = await moyu().memories(activeBotId);
    if (selectedBotRef.current === activeBotId) setMemories(facts);
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

  const botActivities = useMemo(() => {
    const result: Record<string, BotActivity> = {};
    for (const item of settings.bots) {
      const thread = conversations.find((entry) => entry.botId === item.id);
      const id = conversation?.botId === item.id ? conversation.id : thread?.id;
      const latest = conversation?.botId === item.id ? conversation.messages.at(-1) : undefined;
      let activity: BotActivity = id && activities[id] ? activities[id]! : { kind: id && runningConversations.has(id) ? latest ? inferMessageActivity(latest) : 'thinking' : 'idle' };
      const groupReply = conversation?.group ? [...conversation.messages].reverse().find((message) => message.role === 'assistant') : undefined;
      if (groupReply?.botId === item.id && (groupReply.streaming || activities[conversation!.id]?.messageId === groupReply.id)) activity = activities[conversation!.id] ?? { kind: inferMessageActivity(groupReply), messageId: groupReply.id };
      if (id && compactingConversations.has(id)) activity = { ...activity, kind: 'organizing' };
      const needsComputer = activity.toolName?.startsWith('cloud_');
      if (needsComputer && cloud.state === 'waking') activity = { ...activity, kind: 'waking' };
      if (approval?.botId === item.id) activity = { ...activity, kind: 'waiting' };
      result[item.id] = activity;
    }
    return result;
  }, [settings.bots, conversations, conversation, activities, runningConversations, compactingConversations, cloud.state, approval]);

  const value: MoyuContextValue = {
    ready,
    settings: { ...settings, bots: workspaceBots, ui: { ...settings.ui, botGroups: [...new Map([...workspaceBots.flatMap((item) => item.sidebar?.group ? [{ name: item.sidebar.group }] : []), ...(activeWorkspace?.botGroups ?? [])].map((item) => [item.name, item])).values()], ungroupedGroupIndex: activeWorkspace?.ungroupedGroupIndex } },
    cloud,
    secrets,
    view,
    settingsSection,
    settingsOpen,
    closeSettings,
    setSettingsSection,
    openSettings: (section) => {
      setSettingsSection(section);
      setSettingsOpen(true);
    },
    setView: (next) => {
      if (next === 'settings') { setSettingsOpen(true); return; }
      if (next === 'bots' || next === 'cloud') { setSettingsSection(next); setSettingsOpen(true); return; }
      setSettingsOpen(false);
      setView(next);
      void moyu().saveSettings({ activeView: next });
    },
    bot,
    selectBot,
    createGroup,
    updateGroupChat,
    setGroupChatsCollapsed,
    runningGroupIds: new Set(conversations.filter((item) => item.group && runningConversations.has(item.id)).map((item) => item.id)),
    conversation,
    conversations: workspaceConversations,
    running: conversation ? runningConversations.has(conversation.id) : false,
    runningBotIds: new Set(conversations.filter((item) => runningConversations.has(item.id)).map((item) => item.botId)),
    compacting: conversation ? compactingConversations.has(conversation.id) : false,
    botActivities,
    approval,
    schedules: schedules.filter((item) => workspaceBots.some((bot) => bot.id === item.botId)),
    memories,
    toasts,
    logs,
    platform,
    version,
    sendMessage,
    stop,
    saveBot,
    updateBotMetadata,
    updateBotGroup,
    deleteBot,
    saveSettings,
    saveCloud,
    cloudAction,
    local,
    workspaces,
    activeWorkspace,
    selectWorkspace,
    chooseLocalDirectory: async () => { applySavedSettings(await moyu().chooseLocalDirectory()); },
    completeSetup: async (skipCloud: boolean) => {
      const next = await moyu().finishSetup(skipCloud);
      setSettings(next); setActiveBotId(next.activeBotId ?? ''); setView('chat');
      setConversations(await moyu().conversations());
    },
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
