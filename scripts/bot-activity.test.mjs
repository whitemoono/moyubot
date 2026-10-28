import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the renderer's pure transition logic without a browser or animation timers.
const source = fs.readFileSync(new URL('../apps/desktop/src/lib/bot-activity.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { updateActivities, inferMessageActivity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const initial = (id = 'a') => updateActivities({}, { type: 'run_start', conversationId: id, runId: `run-${id}` });

test('each Bot keeps its own activity and message identity while other Bots stream', () => {
  let state = updateActivities(initial(), { type: 'run_start', conversationId: 'b', runId: 'run-b' });
  state = updateActivities(state, { type: 'delta', conversationId: 'a', messageId: 'reply-a', text: '回答' });
  state = updateActivities(state, { type: 'tool_start', conversationId: 'b', messageId: 'reply-b', call: { id: 'tool-b', name: 'web_fetch', arguments: {} } });
  assert.equal(state.a.kind, 'writing');
  assert.equal(state.a.messageId, 'reply-a');
  assert.equal(state.b.kind, 'searching');
  state = updateActivities(state, { type: 'run_end', conversationId: 'a', runId: 'run-a', ok: true });
  assert.equal(state.a.kind, 'done');
  assert.equal(state.b.kind, 'searching');
});

test('message completion never changes a finished reply back to thinking', () => {
  let state = updateActivities(initial(), { type: 'delta', conversationId: 'a', messageId: 'reply-a', text: '回答' });
  const message = { id: 'reply-a', role: 'assistant', content: '回答', createdAt: 1, streaming: false };
  assert.equal(updateActivities(state, { type: 'message_end', conversationId: 'a', message }), state);
  state = updateActivities(state, { type: 'run_end', conversationId: 'a', runId: 'run-a', ok: true });
  assert.equal(updateActivities(state, { type: 'message_end', conversationId: 'a', message }).a.kind, 'done');
});

test('approval resumes the pending tool and denial leaves no waiting state', () => {
  const request = { id: 'permission-a', conversationId: 'a', botId: 'bot-a', toolName: 'generate_image', summary: '画图', createdAt: 1 };
  const waiting = updateActivities(initial(), { type: 'approval', request });
  assert.equal(waiting.a.kind, 'waiting');
  assert.equal(updateActivities(waiting, { type: 'approval_done', requestId: request.id, approved: true }).a.kind, 'drawing');
  const denied = updateActivities(waiting, { type: 'approval_done', requestId: request.id, approved: false });
  assert.equal(denied.a.kind, 'thinking');
  assert.equal(denied.a.approvalId, undefined);
});

test('provider errors, stopped requests and failed tools never signal success', () => {
  const state = initial();
  assert.equal(updateActivities(state, { type: 'run_end', conversationId: 'a', runId: 'run-a', ok: false, error: '缺少 API Key' }).a.kind, 'error');
  assert.equal(updateActivities(state, { type: 'run_end', conversationId: 'a', runId: 'run-a', ok: false, error: '已停止' }).a.kind, 'stopped');
  const failedTool = updateActivities(state, { type: 'tool_end', conversationId: 'a', messageId: 'reply-a', result: { id: 'tool-a', name: 'cloud_exec', ok: false, summary: '失败' } });
  assert.equal(failedTool.a.kind, 'error');
  assert.equal(updateActivities(failedTool, { type: 'reasoning', conversationId: 'a', messageId: 'reply-a', text: '处理错误' }).a.kind, 'thinking');
});

test('reloaded messages recover the pending action; history does not inherit a new run', () => {
  const message = { id: 'old', role: 'assistant', content: '', createdAt: 1, streaming: true, toolCalls: [{ id: 'remember-a', name: 'remember', arguments: {} }] };
  assert.equal(inferMessageActivity(message), 'remembering');
  assert.equal(inferMessageActivity({ ...message, streaming: false }), 'idle');
  assert.equal(inferMessageActivity({ ...message, streaming: false, stopped: true }), 'stopped');
  assert.equal(inferMessageActivity({ ...message, streaming: false, error: '缺少 API Key' }), 'error');
  const finished = updateActivities(initial(), { type: 'run_end', conversationId: 'a', runId: 'run-a', ok: true });
  const restarted = updateActivities(finished, { type: 'run_start', conversationId: 'a', runId: 'new-run' });
  assert.equal(restarted.a.messageId, undefined);
  assert.equal(restarted.a.runId, 'new-run');
});
