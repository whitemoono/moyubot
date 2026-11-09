import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, maybeConsolidateMemories } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'memory-consolidation-tests', String(Date.now()));
let serial = 0;
function fixture() {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir);
  const bot = { ...store.getSettings().bots[0] };
  const conversation = store.botConversation(bot.id);
  return { dataDir, store, bot, conversation };
}
let round = 0;
function appendRound(store, conversation, content) {
  round += 1;
  const stamp = Date.now() + round;
  store.appendMessage(conversation.id, { id: `u-${round}`, role: 'user', content, createdAt: stamp });
  store.appendMessage(conversation.id, { id: `a-${round}`, role: 'assistant', content: `收到：${content}`, createdAt: stamp + 1 });
}
const providerWith = (payload) => ({ async chat(args, handlers) { handlers.onText(typeof payload === 'string' ? payload : JSON.stringify(payload)); return { finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 10 } }; } });

test('incremental consolidation runs past the threshold, filters credentials, and advances the checkpoint', async () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) appendRound(f.store, f.conversation, `第 ${n + 1} 轮讨论。${'项目部署细节与验收标准，报告用中文输出，每周五提交周报。'.repeat(10)}`);
  await maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider: providerWith({ memories: ['用户偏好深色主题', 'sk-abcdefghijklmnopqrstuvwx', 'sk-abcdefghijklmnopqrstuvwxyz'] }), emit: () => {} });
  const texts = f.store.listMemories(f.bot.id).map((fact) => fact.text);
  assert.ok(texts.includes('用户偏好深色主题'), '有效记忆入库');
  assert.ok(!texts.some((text) => text.startsWith('sk-') || text.includes('API_KEY')), '凭据被过滤');
  const checkpoint = f.store.getMemoryCheckpoint(f.conversation.id);
  assert.equal(checkpoint.throughMessageId, f.conversation.messages.at(-1).id, '检查点推进到最后一条消息');
  assert.equal(checkpoint.failures, 0);
  // 没有新增内容时不重复整理
  let calls = 0;
  await maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider: { async chat(args, handlers) { calls += 1; handlers.onText('{"memories":[]}'); return { finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } }; } }, emit: () => {} });
  assert.equal(calls, 0, '阈值未达到不再调用模型');
  const persisted = new Store(f.dataDir);
  assert.ok(persisted.listMemories(f.bot.id).some((fact) => fact.text === '用户偏好深色主题'), '记忆落盘并在重启后保留');
});

test('below-threshold conversations are never consolidated', async () => {
  const f = fixture();
  appendRound(f.store, f.conversation, '才聊了两轮。');
  appendRound(f.store, f.conversation, '还没到阈值。');
  let calls = 0;
  await maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider: { async chat(args, handlers) { calls += 1; handlers.onText('{"memories":["不该出现"]}'); return { finishReason: 'stop' }; } }, emit: () => {} });
  assert.equal(calls, 0);
  assert.equal(f.store.listMemories(f.bot.id).length, 0);
});

test('repeated extraction failures skip the window instead of burning tokens forever', async () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) appendRound(f.store, f.conversation, `第 ${n + 1} 轮。${'持续讨论项目部署与验收标准，覆盖构建、回归与发布节奏。'.repeat(10)}`);
  await maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider: providerWith('这不是 JSON'), emit: () => {} });
  let checkpoint = f.store.getMemoryCheckpoint(f.conversation.id);
  assert.equal(checkpoint.failures, 1, '第一次失败只计数，不推进检查点');
  await maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider: providerWith('还不是 JSON'), emit: () => {} });
  checkpoint = f.store.getMemoryCheckpoint(f.conversation.id);
  assert.equal(checkpoint.throughMessageId, f.conversation.messages.at(-1).id, '连续两次失败后跳过本窗口');
  assert.equal(checkpoint.failures, 0);
  const texts = f.store.listMemories(f.bot.id).map((fact) => fact.text);
  assert.ok(!texts.includes('不该出现'), '跳过的窗口不再重试');
});

test('连续两次回复触发整理时并发整理只跑一次', async () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) appendRound(f.store, f.conversation, `第 ${n + 1} 轮。${'讨论项目部署与验收标准，周报周五提交，报告用中文。'.repeat(10)}`);
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = {
    async chat(args, handlers) {
      calls += 1;
      await gate;
      handlers.onText('{"memories":["用户喜欢深色主题"]}');
      return { finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 2 } };
    },
  };
  const first = maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider, emit: () => {} });
  const second = maybeConsolidateMemories({ store: f.store, bot: f.bot, conversation: f.conversation, provider, emit: () => {} });
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1, '同会话并发整理只能调用一次模型');
  const facts = f.store.listMemories(f.bot.id).map((fact) => fact.text);
  assert.equal(facts.filter((item) => item === '用户喜欢深色主题').length, 1, '不应重复写入同一条记忆');
});
