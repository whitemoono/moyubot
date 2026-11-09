import type { AgentEvent, Bot, Conversation } from './types';
import type { ChatProvider } from './providers';
import type { Store } from './store';
import { estimateTokens } from './context';
import { modelSettings } from './generation';
import { trackedChat } from './usage';

/**
 * 自动项目进度更新（L2 Project State 的自主维护）。
 *
 * 用户不必每次手动说"更新一下项目"，Bot 在回复结束后后台判断
 * "最近几轮是否推进了某个项目"，有就自动 project_upsert 记一笔进度。
 * 触发条件：有当前活动项目，且自上次检查点以来满 3 轮用户对话。
 * 独立低频检查点（project-checkpoints.json 的 botId 维度），失败静默、连续两次失败跳过本窗口。
 */
export const PROJECT_UPDATE_ROUNDS = 3;

const PROJECT_INSTRUCTION = `你是项目进度记录器。最近一段对话里用户在与某个 Bot 协作推进项目。判断对话是否实质推进了"当前活动项目"，若是，用一句话更新它的进度小结和下一步。
返回严格 JSON，要么 {"update":null}（本轮没有值得记录的进展），要么：
{"update":{"name":"项目名","summary":"一句话进度小结（这轮完成了什么/进展如何）","nextActions":["下一步待办"]}}
- 必须复用当前活动项目的 name，不要新造项目名。
- summary 更新为"本轮新增的进展"一句话，不要重复历史；nextActions 是更新后的当前下一步（覆盖旧值，不要堆历史旧待办）。
- 没有实质推进（只是闲聊、读文档没产出）就返回 {"update":null}，不要强记。
- 不要输出解释或额外字段。`;

interface ProjectUpdateOutput {
  update: null | { name: string; summary?: string; nextActions?: string[] };
}

function parseProjectUpdate(text: string): ProjectUpdateOutput {
  const raw = text.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('项目更新结果缺少 JSON 对象');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as ProjectUpdateOutput;
  if (!parsed || !('update' in parsed)) throw new Error('项目更新结果格式异常');
  if (parsed.update === null) return { update: null };
  if (typeof parsed.update.name !== 'string' || !parsed.update.name.trim()) throw new Error('项目更新缺少项目名');
  return parsed;
}

interface ProjectCheckpoint { lastRound: number; failures?: number; lastActiveProject?: string }

// 项目自动更新的低频检查点：按 botId 存于 projects-auto.json。
function readCheckpoint(store: Store, botId: string): ProjectCheckpoint | undefined {
  const all = store.getAutoProjectCheckpoints();
  return all[botId];
}

function writeCheckpoint(store: Store, botId: string, checkpoint: ProjectCheckpoint): void {
  const all = store.getAutoProjectCheckpoints();
  all[botId] = checkpoint;
  store.setAutoProjectCheckpoints(all);
}

/** 回复成功后调用：有活动项目且达到轮数阈值时，后台判定并更新一次项目进度。 */
export async function maybeAutoUpdateProject(args: { store: Store; bot: Bot; conversation: Conversation; provider: ChatProvider; emit: (event: AgentEvent) => void }): Promise<void> {
  const { store, bot, conversation, provider } = args;
  if (conversation.subagent || conversation.mergedInto || conversation.deletedAt) return;
  const activeProject = store.listProjects(bot.id).find((project) => project.status === 'active');
  if (!activeProject) return;

  const checkpoint = readCheckpoint(store, bot.id);
  const userRounds = conversation.messages.filter((msg) => msg.role === 'user' && !msg.streaming).length;
  // 自上次检查点以来满 3 轮才触发
  const sinceLast = userRounds - (checkpoint?.lastRound ?? 0);
  if (sinceLast < PROJECT_UPDATE_ROUNDS) return;
  if ((checkpoint?.failures ?? 0) >= 2 && checkpoint?.lastActiveProject === activeProject.name) return;

  // 取最近几轮对话作为判断素材
  const recent = conversation.messages.filter((msg) => !msg.streaming && (msg.role === 'user' || msg.role === 'assistant')).slice(-8)
    .map((msg) => `${msg.role === 'user' ? '用户' : '助手'}：${msg.content}`).join('\n');
  if (estimateTokens(recent) < 100) return;

  let text = '';
  const providerConfig = store.getProvider(bot.providerId);
  try {
    await trackedChat(store, bot, conversation.id, 'project_update', provider, {
      model: bot.model,
      system: PROJECT_INSTRUCTION,
      messages: [{ role: 'user', content: `当前活动项目：${JSON.stringify(activeProject)}\n近期对话：\n${recent}` }],
      tools: [],
      temperature: 0,
      maxTokens: 600,
      ...(providerConfig ? { reasoning: Object.fromEntries([['outputTokenParameter', modelSettings(providerConfig, bot.model).outputTokenParameter]]) } : {}),
    }, {
      onText: (chunk) => { text += chunk; if (text.length > 4000) throw new Error('项目更新输出过长'); },
      onToolCall: () => { throw new Error('项目更新不允许调用工具'); },
    }, undefined, undefined);
  } catch {
    const failures = (checkpoint?.failures ?? 0) + 1;
    writeCheckpoint(store, bot.id, { lastRound: userRounds, failures: failures >= 2 ? 0 : failures, lastActiveProject: activeProject.name });
    return;
  }

  let parsed: ProjectUpdateOutput;
  try { parsed = parseProjectUpdate(text); }
  catch {
    const failures = (checkpoint?.failures ?? 0) + 1;
    writeCheckpoint(store, bot.id, { lastRound: checkpoint?.lastRound ?? 0, failures: failures >= 2 ? 0 : failures, lastActiveProject: activeProject.name });
    return;
  }

  const update = parsed.update;
  if (update) {
    const patch: Partial<import('./types').ProjectState> & { name: string } = { name: update.name };
    if (update.summary) patch.summary = update.summary;
    if (Array.isArray(update.nextActions)) patch.nextActions = update.nextActions.filter(Boolean);
    store.upsertProject(bot.id, patch);
    args.emit({ type: 'log', level: 'info', text: `已自动更新项目「${update.name}」进度` });
  }
  writeCheckpoint(store, bot.id, { lastRound: userRounds, failures: 0, lastActiveProject: activeProject.name });
}