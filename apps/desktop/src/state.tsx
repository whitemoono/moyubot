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
  Goal,
  AskRequest,
  TodoList,
  MemoryFact,
  Message,
  Schedule,
  Workspace,
} from '@moyu/core';
import { moyu } from './lib/bridge';
import type { ConversationSummary } from './lib/bridge';
import { inferMessageActivity, updateActivities } from './lib/bot-activity';
import type { BotActivity, ConversationActivities } from './lib/bot-activity';
import { appendReplyProgress, applyReplyFragments, createReplyBuffer } from './lib/reply-flow';
import type { ReplyFragment } from './lib/reply-flow';
import { enqueueRequest, removeRequest, scopedSnapshots } from './lib/request-state';

export type View = 'chat' | 'bots' | 'cloud' | 'tasks' | 'settings';
export type SettingsSection = 'profile' | 'providers' | 'appearance' | 'about' | 'bots' | 'memories' | 'cloud' | 'usage' | 'feedback' | 'capabilities' | 'plugins' | 'market';

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
}

/** Latest per-conversation context breakdown reported by the agent for the request it just built. */
export interface ContextUsageSnapshot {
  systemTokens: number;
  toolTokens: number;
  historyTokens: number;
  windowTokens: number;
}

/** 按工具调用 id 聚合的子任务进度：界面用它显示"第几个在跑、第几个已完成"。 */
export interface SubagentProgress {
  conversationId: string;
  tasks: string[];
  children: Record<number, { task: string; state: 'running' | 'done' | 'error'; conversationId?: string }>;
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
  setConversationMode: (mode: 'execute' | 'plan') => Promise<void>;
  setConversationAutonomy: (autonomy: 'turn' | 'until_done') => Promise<void>;
  /** 当前会话还在推进的跨轮目标；不自动续跑，只负责让人和模型都记得它。 */
  goal: Goal | undefined;
  todos: TodoList | undefined;
  subagents: Record<string, SubagentProgress>;
  /** 待回答的开放提问；null 表示没有。 */
  question: AskRequest | null;
  answerQuestion: (decision: { requestId: string; answer: string }) => Promise<void>;
  continueSubagent: (childConversationId: string, message: string) => Promise<{ ok: boolean; text: string; error?: string }>;
  stopSubagent: (childConversationId: string) => Promise<boolean>;
  completeGoal: () => Promise<void>;
  resumableGoal: Goal | undefined;
  blockedGoal: Goal | undefined;
  resumeGoal: (extraRounds?: number) => Promise<boolean>;
  reopenGoal: () => Promise<boolean>;
  conversations: ConversationSummary[];
  running: boolean;
  runningBotIds: Set<string>;
  compacting: boolean;
  contextUsage: Record<string, ContextUsageSnapshot>;
  botActivities: Record<string, BotActivity>;
  approval: ApprovalRequest | null;
  requestSource: (request: AskRequest | ApprovalRequest) => string;
  schedules: Schedule[];
  memories: MemoryFact[];
  toasts: Toast[];
  logs: { level: string; text: string; ts: number }[];
  platform: string;
  version: string;
  sendMessage: (text: string, images: { name?: string; mimeType: string; dataUrl: string; size?: number }[], replyTo?: Message['replyTo']) => Promise<boolean>;
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
  updateMemory: (id: string, patch: { text?: string; pinned?: boolean }) => Promise<void>;
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

function useScopedSnapshots<T>() {
  const [values, setValues] = useState<ReadonlyMap<string, T>>(() => new Map());
  const [writer] = useState(() => scopedSnapshots<T>((key, value) => {
    setValues((previous) => new Map(previous).set(key, value));
  }));
  return [values, writer] as const;
}

const EMPTY_MEMORIES: MemoryFact[] = [];

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
  const [goalsByConversation, goalSnapshots] = useScopedSnapshots<{ active?: Goal; resumable?: Goal; blocked?: Goal }>();
  const [todosByConversation, todoSnapshots] = useScopedSnapshots<TodoList | undefined>();
  const { active: goal, resumable: resumableGoal, blocked: blockedGoal } = goalsByConversation.get(conversation?.id ?? '') ?? {};
  const todos = todosByConversation.get(conversation?.id ?? '');
  const [subagents, setSubagents] = useState<Record<string, SubagentProgress>>({});
  const [questions, setQuestions] = useState<readonly AskRequest[]>([]);
  const question = questions[0] ?? null;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [runningConversations, setRunning] = useState<Set<string>>(new Set());
  const [compactingConversations, setCompacting] = useState<Set<string>>(new Set());
  const [contextUsage, setContextUsage] = useState<Record<string, ContextUsageSnapshot>>({});
  const [activities, setActivities] = useState<ConversationActivities>({});
  const activityTimers = useRef(new Map<string, number>());
  const [approvals, setApprovals] = useState<readonly ApprovalRequest[]>([]);
  const approval = approvals[0] ?? null;
  const responding = useRef(new Set<string>());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memoriesByBot, memorySnapshots] = useScopedSnapshots<MemoryFact[]>();
  const memories = memoriesByBot.get(activeBotId) ?? EMPTY_MEMORIES;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logs, setLogs] = useState<{ level: string; text: string; ts: number }[]>([]);
  const [platform, setPlatform] = useState('win32');
  const [version, setVersion] = useState('0.1.3');

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

  const refreshGoal = useCallback((id: string) => goalSnapshots.load(id, () => moyu().goalState(id)), [goalSnapshots]);
  const refreshTodos = useCallback((id: string) => todoSnapshots.load(id, () => moyu().listTodos(id)), [todoSnapshots]);
  const loadMemories = useCallback(async (id: string) => {
    if (id) await memorySnapshots.load(id, () => moyu().memories(id));
  }, [memorySnapshots]);

  const workspaces = settings.workspaces ?? [];
  const activeWorkspace = workspaces.find((item) => item.id === settings.activeWorkspaceId) ?? workspaces[0];
  const workspaceBots = useMemo(() => settings.bots.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id), [settings.bots, activeWorkspace?.id]);
  const workspaceConversations = conversations.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id);
  const bot = useMemo(() => workspaceBots.find((item) => item.id === activeBotId) ?? workspaceBots.find((item) => conversations.find((conv) => conv.id === activeBotId)?.group?.memberBotIds.includes(item.id)) ?? workspaceBots[0], [workspaceBots, activeBotId, conversations]);
  const requestSource = (request: AskRequest | ApprovalRequest) => {
    const name = settings.bots.find((item) => item.id === request.botId)?.name ?? 'Bot';
    const group = conversations.find((item) => item.id === request.conversationId && item.group);
    return group ? `${name} · ${group.title}` : name;
  };

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

  /** 切换会话的计划/执行模式。故意不放进 Bot 配置：同一只 Bot 的不同会话各管各的。 */
  const setConversationMode = useCallback(async (mode: 'execute' | 'plan') => {
    const current = conversationRef.current;
    if (!current || current.subagent) return;
    try {
      const updated = await moyu().setConversationMode(current.id, mode);
      if (conversationRef.current?.id === updated.id) setConversation(updated);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }, [toast]);

  const setConversationAutonomy = useCallback(async (autonomy: 'turn' | 'until_done') => {
    const current = conversationRef.current;
    if (!current || current.subagent || current.group) return;
    try {
      const updated = await moyu().setConversationAutonomy(current.id, autonomy);
      if (conversationRef.current?.id === updated.id) setConversation(updated);
      toast(autonomy === 'until_done' ? '已开启自动跑到底：新目标会自动跨轮续航' : '续航已关闭：目标只在当前轮内自动多步');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }, [toast]);

  const submitRequest = useCallback(async (key: string, send: () => Promise<unknown>) => {
    if (responding.current.has(key)) return;
    responding.current.add(key);
    try { await send(); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { responding.current.delete(key); }
  }, [toast]);

  const answerQuestion = useCallback((decision: { requestId: string; answer: string }) =>
    submitRequest(`question:${decision.requestId}`, async () => {
      await moyu().answerQuestion(decision);
      setQuestions((prev) => removeRequest(prev, decision.requestId));
    }), [submitRequest]);

  const continueSubagent = useCallback(async (childConversationId: string, message: string) => {
    try { return await moyu().continueSubagent(childConversationId, message); }
    catch (error) { return { ok: false, text: '', error: (error as Error).message }; }
  }, []);

  const stopSubagent = useCallback(async (childConversationId: string) => {
    try { return await moyu().stopSubagent(childConversationId); }
    catch { return false; }
  }, []);

  const completeGoal = useCallback(async () => {
    const current = conversationRef.current;
    if (!current) return;
    try {
      await moyu().updateGoal(current.id, { status: 'complete' });
      void refreshGoal(current.id).catch(() => {});
      toast('目标已标记完成');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }, [toast, refreshGoal]);

  const resumeGoal = useCallback(async (extraRounds = 5) => {
    const current = conversationRef.current;
    if (!current) return false;
    const selection = selectedBotRef.current;
    try {
      await moyu().resumeGoal(current.id, extraRounds);
      void refreshGoal(current.id).catch(() => {});
      return selectedBotRef.current === selection && conversationRef.current?.id === current.id;
    } catch (error) {
      toast((error as Error).message, 'error');
      return false;
    }
  }, [toast, refreshGoal]);

  /** 受阻目标「继续推进」：重新打开为活动目标。 */
  const reopenGoal = useCallback(async () => {
    const current = conversationRef.current;
    if (!current) return false;
    const selection = selectedBotRef.current;
    try {
      await moyu().reopenGoal(current.id);
      void refreshGoal(current.id).catch(() => {});
      return selectedBotRef.current === selection && conversationRef.current?.id === current.id;
    } catch (error) {
      toast((error as Error).message, 'error');
      return false;
    }
  }, [toast, refreshGoal]);

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
    const replyBuffer = createReplyBuffer(
      (flush) => window.requestAnimationFrame(flush),
      (handle) => window.cancelAnimationFrame(handle),
      (batch) => {
        const lastByConversation = new Map<string, ReplyFragment>();
        for (const event of batch) lastByConversation.set(event.conversationId, event);
        setActivities((previous) => {
          let next = previous;
          for (const event of lastByConversation.values()) next = updateActivities(next, event);
          return next;
        });
        setConversation((previous) => applyReplyFragments(previous, batch));
      },
    );
    const offSync = moyu().onSyncData(() => {
      void moyu().bootstrap().then(async boot => {
        setSettings(boot.settings); setConversations(boot.conversations); setSchedules(boot.schedules);
        const current = conversationRef.current;
        const selectedId = selectedBotRef.current;
        if (current && !runningRef.current.has(current.id)) {
          const updated = await moyu().conversation(current.id);
          if (updated && selectedBotRef.current === selectedId && !runningRef.current.has(current.id)) {
            setConversation((prev) => prev?.id === current.id && !prev.messages.some((message) => message.id.startsWith('tmp_')) ? updated : prev);
          }
        }
        await loadMemories(selectedBotRef.current);
      }).catch(error => toast(error.message, 'error'));
    });
    const off = moyu().onEvent((event: AgentEvent) => {
      if (event.type === 'delta' || event.type === 'reasoning') {
        replyBuffer.push(event);
        return;
      }
      replyBuffer.flush();
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
      if (event.type === 'message_start') {
        setConversation((current) => {
          if (!current || current.id !== event.conversationId || current.messages.some((message) => message.id === event.message.id)) return current;
          return { ...current, messages: [...current.messages, event.message] };
        });
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
          void loadMemories(conversationRef.current.botId).catch((error: Error) => toast(error.message, 'error'));
        }
        return;
      }
      if (event.type === 'schedules') { setSchedules(event.schedules); return; }
      if (event.type === 'todos') {
        todoSnapshots.set(event.conversationId, event.todos);
        return;
      }
      if (event.type === 'goal') {
        goalSnapshots.set(event.conversationId, { active: event.active, resumable: event.resumable, blocked: event.blocked });
        return;
      }
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
        // 一轮结束时目标可能刚被 set_goal / update_goal 改过，顺手同步一次。
        if (conversationRef.current?.id === event.conversationId) {
          void refreshGoal(event.conversationId).catch(() => {});
          void refreshTodos(event.conversationId).catch(() => {});
        }
        void moyu().conversation(event.conversationId).then((conv) => {
          if (conv && settingsRef.current.bots.some((item) => item.id === conv.botId) && (conv.botId !== selectedBotRef.current || viewRef.current !== 'chat')) {
            void updateBotMetadata(conv.botId, { sidebar: { unread: true } }).catch((error: Error) => toast(error.message, 'error'));
          }
          if (conv && conv.botId === selectedBotRef.current && !runningRef.current.has(conv.id)) {
            setConversation((prev) => prev?.messages.some((message) => message.id.startsWith('tmp_')) ? prev : conv);
            void loadMemories(conv.botId).catch((error: Error) => toast(error.message, 'error'));
          }
        }).catch((error: Error) => toast(error.message, 'error'));
        return;
      }
      if (event.type === 'subagent') {
        setSubagents((previous) => {
          const current = previous[event.callId] ?? { conversationId: event.conversationId, tasks: [], children: {} };
          if (event.status === 'start') return { ...previous, [event.callId]: { conversationId: event.conversationId, tasks: event.tasks, children: {} } };
          if (event.status === 'child') {
            return { ...previous, [event.callId]: { ...current, children: { ...current.children, [event.index]: { task: event.task, state: event.state, conversationId: event.childConversationId ?? current.children[event.index]?.conversationId } } } };
          }
          const merged = { ...current.children };
          (event.children ?? []).forEach((child, index) => { merged[index] = { task: child.task, state: child.ok ? 'done' : 'error', conversationId: child.conversationId }; });
          return { ...previous, [event.callId]: { ...current, tasks: event.tasks, children: merged } };
        });
        return;
      }
      if (event.type === 'question') {
        setQuestions((prev) => enqueueRequest(prev, event.request));
        return;
      }
      if (event.type === 'question_done') {
        setQuestions((prev) => removeRequest(prev, event.requestId));
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
          void loadMemories(conversationRef.current.botId).catch((error: Error) => toast(error.message, 'error'));
        }
        return;
      }
      if (event.type === 'usage') {
        patchMessage(event.messageId, (message) => ({ ...message, usage: event.usage }));
        return;
      }
      if (event.type === 'context_usage') {
        const snapshot = { systemTokens: event.systemTokens, toolTokens: event.toolTokens, historyTokens: event.historyTokens, windowTokens: event.windowTokens };
        try { localStorage.setItem(`moyu:ctx:${event.conversationId}`, JSON.stringify(snapshot)); } catch { /* ignore quota/denied */ }
        setContextUsage((prev) => ({ ...prev, [event.conversationId]: snapshot }));
        return;
      }
      if (event.type === 'approval') {
        setApprovals((prev) => enqueueRequest(prev, event.request));
        return;
      }
      if (event.type === 'approval_done') {
        setApprovals((prev) => removeRequest(prev, event.requestId));
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
      replyBuffer.discard();
      offSync();
      off();
      offCloud();
      offLocal();
      activityTimers.current.forEach((timer) => window.clearTimeout(timer));
      activityTimers.current.clear();
    };
  }, [patchMessage, toast, loadConversations, updateBotMetadata, loadMemories, refreshGoal, refreshTodos, goalSnapshots, todoSnapshots]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const target = settingsRef.current.workspaces?.find((item) => item.id === workspaceId);
    if (!target) return;
    const preferred = settingsRef.current.bots.find((item) => item.id === target.activeBotId && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id ?? conversations.find((item) => item.group && item.id === target.activeBotId && (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id;
    const next = preferred ?? settingsRef.current.bots.find((item) => (item.workspaceId ?? 'workspace_cloud') === workspaceId)?.id;
    const workspaces = settingsRef.current.workspaces.map((item) => item.id === settingsRef.current.activeWorkspaceId ? { ...item, activeBotId: selectedBotRef.current } : item);
    settingsRef.current = { ...settingsRef.current, activeWorkspaceId: workspaceId, activeBotId: next, workspaces };
    selectedBotRef.current = next ?? '';
    setSettings(settingsRef.current);
    setActiveBotId(next ?? ''); setConversation(null); setSettingsOpen(false); setView('chat');
    void moyu().saveSettings({ activeWorkspaceId: workspaceId, workspaces, activeBotId: next, activeView: 'chat' }).catch((error: Error) => toast(error.message, 'error'));
  }, [toast, conversations]);

  useEffect(() => {
    if (!activeBotId) return;
    let cancelled = false;
    void loadConversations();
    void loadMemories(activeBotId).catch((error: Error) => { if (!cancelled) toast(error.message, 'error'); });
    const loading = settingsRef.current.bots.some((item) => item.id === activeBotId) ? moyu().botConversation(activeBotId) : moyu().conversation(activeBotId);
    void loading.then((conv) => {
      if (conv && !cancelled && selectedBotRef.current === activeBotId) {
        setConversation(conv);
        void refreshGoal(conv.id).catch(() => {});
        void refreshTodos(conv.id).catch(() => {});
        // 重启后从磁盘补上三段快照（实时事件已有则不覆盖）。
        void moyu().contextUsage(conv.id).then((snap) => { if (snap && !cancelled && selectedBotRef.current === activeBotId) setContextUsage((prev) => (prev[conv.id] ? prev : { ...prev, [conv.id]: snap })); }).catch(() => {});
      }
    }).catch((error: Error) => { if (!cancelled) toast(error.message, 'error'); });
    return () => { cancelled = true; };
  }, [activeBotId, loadConversations, loadMemories, refreshGoal, refreshTodos, toast]);

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
      if (conversationRef.current?.botId !== botId) setConversation(null);
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
    async (text: string, images: { name?: string; mimeType: string; dataUrl: string; size?: number }[], replyTo?: Message['replyTo']) => {
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
              // 与 core 的 attachmentsFrom 保持一致：按 mimeType 区分图片/文件，否则乐观消息会把文件渲染成图片。
              kind: (image.mimeType.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
              name: image.name ?? (image.mimeType.startsWith('image/') ? '图片' : '附件'),
              mimeType: image.mimeType,
              dataUrl: image.dataUrl,
              size: image.size,
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
        else { selectedBotRef.current = ''; setActiveBotId(''); setConversation(null); }
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
        else { selectedBotRef.current = ''; setActiveBotId(''); setConversation(null); setView('chat'); setSettingsSection('bots'); setSettingsOpen(true); }
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
  const refreshMemories = useCallback(() => loadMemories(activeBotId), [activeBotId, loadMemories]);
  const addMemory = useCallback(
    async (text: string) => {
      if (!activeBotId) return;
      await moyu().addMemory(activeBotId, text);
      await refreshMemories();
    },
    [activeBotId, refreshMemories],
  );
  const updateMemory = useCallback(
    async (id: string, patch: { text?: string; pinned?: boolean }) => {
      await moyu().updateMemory(id, patch);
      await refreshMemories();
    },
    [refreshMemories],
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
      await submitRequest(`approval:${approval.id}`, async () => {
        await moyu().approve({ requestId: approval.id, approved });
        setApprovals((prev) => removeRequest(prev, approval.id));
      });
    },
    [approval, submitRequest],
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
      if (approvals.some((request) => request.botId === item.id)) activity = { ...activity, kind: 'waiting' };
      result[item.id] = activity;
    }
    return result;
  }, [settings.bots, conversations, conversation, activities, runningConversations, compactingConversations, cloud.state, approvals]);

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
    contextUsage,
    botActivities,
    approval,
    requestSource,
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
    setConversationMode,
    setConversationAutonomy,
    completeGoal,
    goal,
    todos,
    resumableGoal,
    blockedGoal,
    reopenGoal,
    resumeGoal,
    subagents,
    question,
    answerQuestion,
    continueSubagent,
    stopSubagent,
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
    updateMemory,
    deleteMemory,
    respondApproval,
    toast,
  };

  return <MoyuContext.Provider value={value}>{children}</MoyuContext.Provider>;
}
