import type { AgentEvent, Message } from '@moyu/core';

type ModelTurn = NonNullable<Message['modelTurns']>[number];
type ProgressEvent = Extract<AgentEvent, { type: 'delta' | 'reasoning' | 'tool_start' }>;

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
