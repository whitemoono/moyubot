import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, pruneOutput } from '../packages/core/dist/index.js';
import { prepareContext, pruneToolMessages } from '../packages/core/dist/context.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'tool-pruning-tests', String(Date.now()));
let serial = 0;

function fixture() {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], tools: [], model: 'test-model' };
  store.updateSettings({ bots: [bot], providers: [{ ...settings.providers[0], contextWindowTokens: 4096 }], cloud: { ...settings.cloud, driver: 'mock' } });
  return { dataDir, store, bot, conversation: store.botConversation(bot.id) };
}

/** 一条旧轮次：user + assistant(带工具结果)。detail 用纯 ASCII，好让 token 估算可预测。 */
function addOldTurn(store, conv, n, detailChars) {
  store.appendMessage(conv.id, { id: `user-${n}`, role: 'user', content: '请记住项目进展。', createdAt: n * 10 });
  store.appendMessage(conv.id, {
    id: `assistant-${n}`, role: 'assistant', content: `第${n}轮已经处理`, createdAt: n * 10 + 1,
    toolCalls: [{ id: `exec-${n}`, name: 'cloud_exec', arguments: { cmd: `run-${n}` } }],
    toolResults: [{ id: `exec-${n}`, name: 'cloud_exec', ok: true, summary: `第${n}轮完成`, ...(detailChars ? { detail: 'x'.repeat(detailChars) + `_TAIL_${n}` } : {}) }],
  });
}

const FORBIDDEN = { kind: 'openai', async chat() { throw new Error('原地精简不该产生任何模型往返'); } };
const prepare = (f, live, provider, extra = {}) => prepareContext({
  store: f.store, bot: f.bot, conversation: f.conversation, userMessageId: 'current-user', live, provider,
  system: '你是一个助手', tools: [], signal: new AbortController().signal, emit: () => {}, ...extra,
});

test('pruneOutput keeps both ends and never exceeds the requested budget', () => {
  const text = 'H'.repeat(5000) + 'UNIQUE_TAIL_SENTINEL';
  const pruned = pruneOutput(text, 1000);
  assert.ok(pruned.length <= 1000, `裁剪结果必须不超过额度，实际 ${pruned.length}`);
  assert.ok(pruned.startsWith('HHHH'), '开头必须保留');
  assert.ok(pruned.endsWith('UNIQUE_TAIL_SENTINEL'), '结尾必须保留：命令输出的退出码与最终报错都在这里');
  assert.match(pruned, /中间省略 \d+ 字符，已保留首尾/);
  assert.equal(pruneOutput('short', 100), 'short', '短文本必须原样返回');
  assert.equal(pruneOutput('anything', 0), '', '额度为 0 时返回空串');
});

test('pruneOutput head ratio shifts the split toward the end for command output', () => {
  const text = 'a'.repeat(1000) + 'b'.repeat(1000);
  const tailHeavy = pruneOutput(text, 600, 0.35);
  assert.ok(tailHeavy.indexOf('b'.repeat(40)) > tailHeavy.indexOf('省略'), '尾部占比应大于头部');
});

test('pruneToolMessages never touches the newest tool result', () => {
  const newest = 'z'.repeat(9000) + '_NEWEST_TAIL';
  const messages = [
    { role: 'user', content: '开工' },
    { role: 'assistant', content: '执行中' },
    { role: 'tool', toolCallId: 'old', name: 'cloud_exec', content: 'x'.repeat(9000) },
    { role: 'assistant', content: '再看一次' },
    { role: 'tool', toolCallId: 'new', name: 'cloud_exec', content: newest },
  ];
  const { messages: out, prunedCount } = pruneToolMessages(messages, 2000);
  assert.equal(prunedCount, 1, '只有较早的那条工具输出会被精简');
  assert.equal(out[4].content, newest, '最新工具结果是模型下一步的工作集，必须逐字保留');
  assert.ok(out[2].content.length <= 2000);
  assert.equal(messages[2].content.length, 9000, '入参数组不得被就地修改');
});

test('over-budget tool transcripts get shrunk in place instead of paying for a summary', async () => {
  const f = fixture();
  addOldTurn(f.store, f.conversation, 1, 12000);
  addOldTurn(f.store, f.conversation, 2, 12000);
  addOldTurn(f.store, f.conversation, 3, 0); // 最新一条没有大输出，留出精简空间
  f.store.appendMessage(f.conversation.id, { id: 'current-user', role: 'user', content: '继续这个项目', createdAt: 999 });

  const events = [];
  const live = [{ role: 'user', content: '继续这个项目' }];
  const { messages } = await prepare(f, live, FORBIDDEN, { emit: (event) => events.push(event) });

  const toolContents = messages.filter((message) => message.role === 'tool').map((message) => message.content);
  assert.ok(toolContents.every((content) => !/^x+$/.test(content)), '较早的工具输出应已被改写');
  assert.ok(toolContents.some((content) => content.includes('已保留首尾')), '必须留下首尾保留标记，不能让模型误读为连续内容');
  const pruned = events.find((event) => event.type === 'context_pruned');
  assert.ok(pruned, '要发出结构化的 context_pruned 事件供界面使用');
  assert.ok(pruned.pruned >= 1 && pruned.savedTokens > 0, `事件要带裁剪条数与省回量，实际 ${JSON.stringify(pruned)}`);
  assert.ok(!f.conversation.context?.summary, '原地精简不推进摘要游标，完整历史仍在磁盘上');
});

test('small history is left completely untouched', async () => {
  const f = fixture();
  addOldTurn(f.store, f.conversation, 1, 100);
  f.store.appendMessage(f.conversation.id, { id: 'current-user', role: 'user', content: '继续', createdAt: 999 });
  const events = [];
  const { messages } = await prepare(f, [{ role: 'user', content: '继续' }], FORBIDDEN, { emit: (event) => events.push(event) });
  assert.ok(!events.some((event) => event.type === 'context_pruned'), '没超预算就不该裁剪');
  assert.ok(messages.some((message) => message.role === 'tool' && message.content.includes('_TAIL_1')), '小输出必须逐字保留');
});

test('an oversized non-tool input still fails loudly without a silent cut', async () => {
  const f = fixture();
  f.store.appendMessage(f.conversation.id, { id: 'current-user', role: 'user', content: '超'.repeat(40000), createdAt: 999 });
  const events = [];
  await assert.rejects(
    () => prepare(f, [{ role: 'user', content: '超'.repeat(40000) }], FORBIDDEN, { emit: (event) => events.push(event) }),
    /上下文上限/,
    '当前输入本身超限时要明确报错并提示缩短，不能静默截掉',
  );
  assert.ok(!events.some((event) => event.type === 'context_compaction'), '没有可裁内容时不应白白打一次摘要模型');
});
