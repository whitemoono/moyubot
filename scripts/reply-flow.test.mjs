import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../apps/desktop/src/lib/reply-flow.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { replyTurns, appendReplyProgress } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const empty = () => ({ id: 'reply', role: 'assistant', content: '', createdAt: 1, streaming: true });
const call = (id = 'command') => ({ id, name: 'cloud_exec', arguments: { cmd: 'node --version' } });
const progress = (message, type, data) => appendReplyProgress(message, { type, conversationId: 'chat', messageId: message.id, ...data });

test('streaming keeps text, commands, more thinking and final text in their original turns', () => {
  let message = progress(empty(), 'reasoning', { text: '先检查环境。' });
  message = progress(message, 'delta', { text: '开始检查。' });
  const beforeTool = message;
  message = progress(message, 'tool_start', { call: call() });
  message = { ...message, toolResults: [{ id: 'command', name: 'cloud_exec', ok: true, summary: 'v22' }] };
  const afterTool = message;
  message = progress(message, 'reasoning', { text: '版本满足要求。' });
  message = progress(message, 'delta', { text: '已完成' });
  message = progress(message, 'delta', { text: '检查。' });
  assert.deepEqual(replyTurns(message), [
    { content: '开始检查。', reasoning: '先检查环境。', toolCalls: [call()] },
    { content: '已完成检查。', reasoning: '版本满足要求。' },
  ]);
  assert.equal(message.content, '开始检查。已完成检查。');
  assert.equal(message.reasoning, '先检查环境。版本满足要求。');
  assert.equal(beforeTool.modelTurns[0].toolCalls, undefined, 'Progress must not mutate earlier React state');
  assert.equal(afterTool.modelTurns.length, 1);
});

test('parallel calls stay after the same text and reconnects do not duplicate a card', () => {
  let message = progress(empty(), 'delta', { text: '同时检查两个项目。' });
  message = progress(message, 'tool_start', { call: call('one') });
  message = progress(message, 'tool_start', { call: call('two') });
  const duplicate = progress(message, 'tool_start', { call: call('one') });
  assert.equal(duplicate, message);
  assert.equal(replyTurns(message).length, 1);
  assert.deepEqual(message.modelTurns[0].toolCalls.map(item => item.id), ['one', 'two']);
});

test('persisted complete turns render in the same order after reload', () => {
  const modelTurns = [
    { content: '读取版本。', toolCalls: [call('one')] },
    { content: '检查路径。', reasoning: '继续检查。', toolCalls: [call('two')] },
    { content: '环境可用。' },
  ];
  const message = { ...empty(), streaming: false, content: modelTurns.map(turn => turn.content).join(''), reasoning: '继续检查。', toolCalls: [call('one'), call('two')], modelTurns };
  assert.deepEqual(replyTurns(JSON.parse(JSON.stringify(message))), modelTurns);
});

test('stopped and failed responses retain text from their unfinished final turn', () => {
  for (const terminal of [{ stopped: true }, { error: '网络断开' }]) {
    const message = { ...empty(), ...terminal, streaming: false, content: '检查中。已读取', reasoning: '先检查。还需分析。', toolCalls: [call()], modelTurns: [{ content: '检查中。', reasoning: '先检查。', toolCalls: [call()] }] };
    const turns = replyTurns(message);
    assert.equal(turns.length, 2);
    assert.equal(turns[1].content, '已读取');
    assert.equal(turns[1].reasoning, '还需分析。');
    assert.deepEqual(turns[1].toolCalls, []);
  }
});

test('legacy transcripts show all existing text and tools once', () => {
  const message = { ...empty(), streaming: false, content: '这是旧记录。', reasoning: '旧思考。', toolCalls: [call()] };
  assert.deepEqual(replyTurns(message), [{ content: message.content, reasoning: message.reasoning, toolCalls: message.toolCalls }]);
  assert.deepEqual(replyTurns(empty()), []);
});
