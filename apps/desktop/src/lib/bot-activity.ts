import type { AgentEvent, Message } from '@moyu/core';

export const BOT_ACTIVITY = {
  idle: { label: '待命', motion: 'idle' },
  sending: { label: '正在发送', motion: 'sending' },
  thinking: { label: '正在思考', motion: 'thinking' },
  searching: { label: '正在查找资料', motion: 'searching' },
  working: { label: '正在操作电脑', motion: 'working' },
  writing: { label: '正在回复', motion: 'writing' },
  drawing: { label: '正在生成图片', motion: 'loading' },
  remembering: { label: '正在整理记忆', motion: 'dictating' },
  scheduling: { label: '正在安排任务', motion: 'working' },
  organizing: { label: '正在整理上下文', motion: 'progress' },
  waiting: { label: '等待你的确认', motion: 'listening' },
  waking: { label: '正在唤醒电脑', motion: 'waking' },
  done: { label: '回复完成', motion: 'happy' },
  error: { label: '遇到问题', motion: 'alerting' },
  stopped: { label: '已停止生成', motion: 'drowsy' },
} as const;
export type BotActivityKind = keyof typeof BOT_ACTIVITY;
export interface BotActivity {
  kind: BotActivityKind;
  messageId?: string;
  toolName?: string;
  approvalId?: string;
  runId?: string;
}
export type ConversationActivities = Record<string, BotActivity>;

export function activityForTool(name: string): BotActivityKind {
  if (name === 'web_fetch' || name === 'recall' || name === 'cloud_read') return 'searching';
  if (name === 'remember') return 'remembering';
  if (name === 'generate_image') return 'drawing';
  if (['schedule_task', 'list_tasks', 'update_task'].includes(name)) return 'scheduling';
  return 'working';
}

export function inferMessageActivity(message: Message): BotActivityKind {
  if (message.error) return 'error';
  if (message.stopped) return 'stopped';
  if (!message.streaming) return 'idle';
  const call = [...(message.toolCalls ?? [])].reverse().find((item) => !message.toolResults?.some((result) => result.id === item.id));
  if (call) return activityForTool(call.name);
  return message.content ? 'writing' : 'thinking';
}

/** Conversation-scoped transitions keep background Bots and old messages independent. */
export function updateActivities(previous: ConversationActivities, event: AgentEvent): ConversationActivities {
  const id = 'conversationId' in event ? event.conversationId : event.type === 'approval' ? event.request.conversationId : event.type === 'approval_done' ? Object.keys(previous).find((key) => previous[key]?.approvalId === event.requestId) : undefined;
  if (!id) return previous;
  const before = previous[id] ?? { kind: 'idle' };
  let next: BotActivity;
  switch (event.type) {
    case 'run_start': next = { kind: 'thinking', runId: event.runId }; break;
    case 'message_start': next = { ...before, messageId: event.message.id }; break;
    case 'reasoning': next = { ...before, kind: 'thinking', messageId: event.messageId, toolName: undefined }; break;
    case 'delta': next = { ...before, kind: 'writing', messageId: event.messageId, toolName: undefined }; break;
    case 'tool_start': next = { ...before, kind: activityForTool(event.call.name), messageId: event.messageId, toolName: event.call.name }; break;
    case 'tool_end': next = { ...before, kind: event.result.ok ? 'thinking' : 'error', toolName: undefined }; break;
    case 'context_compaction': next = { ...before, kind: event.phase === 'start' ? 'organizing' : event.phase === 'done' ? 'thinking' : 'error' }; break;
    case 'approval': next = { ...before, kind: 'waiting', toolName: event.request.toolName, approvalId: event.request.id }; break;
    case 'approval_done': next = { ...before, kind: event.approved ? activityForTool(before.toolName ?? '') : 'thinking', approvalId: undefined }; break;
    case 'run_end': next = { ...before, kind: event.ok ? 'done' : event.error === '已停止' ? 'stopped' : 'error', runId: event.runId, toolName: undefined, approvalId: undefined }; break;
    default: return previous;
  }
  if (next.kind === before.kind && next.messageId === before.messageId && next.toolName === before.toolName && next.approvalId === before.approvalId && next.runId === before.runId) return previous;
  return { ...previous, [id]: next };
}
