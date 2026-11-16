import type { AgentEvent, Conversation, Message } from '@moyu/core';

type ModelTurn = NonNullable<Message['modelTurns']>[number];
type ProgressEvent = Extract<AgentEvent, { type: 'delta' | 'reasoning' | 'tool_start' }>;
export type ReplyFragment = Extract<ProgressEvent, { type: 'delta' | 'reasoning' }>;

/** Apply one frame of fragments in one pass over the visible transcript. */
export function applyReplyFragments(conversation: Conversation | null, fragments: readonly ReplyFragment[]): Conversation | null {
  if (!conversation) return conversation;
  const byMessage = new Map<string, ReplyFragment[]>();
  for (const fragment of fragments) {
    if (fragment.conversationId !== conversation.id) continue;
    const pending = byMessage.get(fragment.messageId);
    if (!pending) {
      byMessage.set(fragment.messageId, [fragment]);
      continue;
    }
    const last = pending.at(-1)!;
    if (last.type === fragment.type) pending[pending.length - 1] = { ...last, text: last.text + fragment.text };
    else pending.push(fragment);
  }
  if (!byMessage.size) return conversation;
  let changed = false;
  const messages = conversation.messages.map((message) => {
    const pending = byMessage.get(message.id);
    if (!pending) return message;
    changed = true;
    return pending.reduce(appendReplyProgress, message);
  });
  return changed ? { ...conversation, messages } : conversation;
}

/** Flush before discrete events so tool and completion events retain IPC order. */
export function createReplyBuffer(
  schedule: (callback: () => void) => number,
  cancel: (handle: number) => void,
  publish: (batch: ReplyFragment[]) => void,
) {
  let pending: ReplyFragment[] = [];
  let handle: number | undefined;
  const clear = () => {
    if (handle !== undefined) cancel(handle);
    handle = undefined;
    const batch = pending;
    pending = [];
    return batch;
  };
  const flush = () => {
    const batch = clear();
    if (batch.length) publish(batch);
  };
  return {
    push(fragment: ReplyFragment) {
      pending.push(fragment);
      // Hidden windows may stop receiving animation frames.
      if (pending.length >= 128) flush();
      else if (handle === undefined) handle = schedule(flush);
    },
    flush,
    discard() { clear(); },
  };
}

/** Include an unfinished response after the persisted, complete model turns. */
export function replyTurns(message: Message): ModelTurn[] {
  const turns = [...(message.modelTurns ?? [])];
  const contentLength = turns.reduce((length, turn) => length + turn.content.length, 0);
  const reasoningLength = turns.reduce((length, turn) => length + (turn.reasoning?.length ?? 0), 0);
  const seen = new Set(turns.flatMap((turn) => turn.toolCalls?.map((call) => call.id) ?? []));
  const content = message.content.slice(contentLength);
  const reasoning = message.reasoning?.slice(reasoningLength);
  const toolCalls = message.toolCalls?.filter((call) => !seen.has(call.id));
  if (content || reasoning || toolCalls?.length) turns.push({ content, reasoning, toolCalls });
  return turns;
}

/** Mirror model turn boundaries while streaming, so completion doesn't reorder the UI. */
export function appendReplyProgress(message: Message, event: ProgressEvent): Message {
  const modelTurns = replyTurns(message);
  let last = modelTurns.at(-1);
  if (!last || (event.type !== 'tool_start' && last.toolCalls?.length)) {
    last = { content: '' };
    modelTurns.push(last);
  } else {
    last = { ...last };
    modelTurns[modelTurns.length - 1] = last;
  }
  if (event.type === 'delta') {
    last.content += event.text;
    return { ...message, content: message.content + event.text, modelTurns };
  }
  if (event.type === 'reasoning') {
    last.reasoning = (last.reasoning ?? '') + event.text;
    return { ...message, reasoning: (message.reasoning ?? '') + event.text, modelTurns };
  }
  // Some transports resend a tool_start when reconnecting.
  if (modelTurns.some((turn) => turn.toolCalls?.some((call) => call.id === event.call.id))) return message;
  last.toolCalls = [...(last.toolCalls ?? []), event.call];
  return { ...message, toolCalls: [...(message.toolCalls ?? []), event.call], modelTurns };
}
