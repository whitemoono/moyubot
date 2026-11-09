import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, maybeAutoUpdateProject } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'project-auto-tests', String(Date.now()));
let serial = 0;
function fixture() {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir, undefined, { embedder: async () => null });
  const bot = store.getSettings().bots[0];
  const conversation = store.botConversation(bot.id);
  return { dataDir, store, bot, conversation };
}
let seq = 0;
function appendTurn(store, conversation, content = '继续推进部署和测试，环境已经就绪。') {
  seq += 1;
  const t = Date.now() + seq * 1000;
  store.appendMessage(conversation.id, { id: `u${seq}`, role: 'user', content, createdAt: t });
  store.appendMessage(conversation.id, { id: `a${seq}`, role: 'assistant', content: `已处理：${content}`, createdAt: t + 500 });
}
const providerReturning = (payload) => ({ async chat(args, handlers) { handlers.onText(typeof payload === 'string' ? payload : JSON.stringify(payload)); return { finishReason: 'stop', usage: { promptTokens: 50, completionTokens: 10 } }; } });

test('auto project update records progress on the active project', async () => {
  const f = fixture();
  f.store.upsertProject(f.bot.id, { name: 'SaaS 调研', status: 'active', currentGoal: '验证付费需求' });
  for (let n = 0; n < 3; n++) appendTurn(f.store, f.conversation);
  const provider = providerReturning({ update: { name: 'SaaS 调研', summary: '访谈 3 位用户，确认有付费意愿', nextActions: ['写定价页'] } });
  await maybeAutoUpdateProject({ store: f.store, bot: f.bot, conversation: f.conversation, provider, emit: () => {} });
  const project = f.store.getProject(f.bot.id, 'SaaS 调研');
  assert.equal(project.summary, '访谈 3 位用户，确认有付费意愿');
  assert.deepEqual(project.nextActions, ['写定价页']);
  // 检查点推进后，未满 3 轮不再调用
  let calls = 0;
  appendTurn(f.store, f.conversation);
  await maybeAutoUpdateProject({ store: f.store, bot: f.bot, conversation: f.conversation, provider: { async chat(args, handlers) { calls += 1; handlers.onText('{"update":null}'); return { finishReason: 'stop' }; } }, emit: () => {} });
  assert.equal(calls, 0, '未满 3 轮不触发项目更新');
});

test('auto project update skips when no active project or no real progress', async () => {
  const f = fixture();
  // 没有活动项目 → 直接跳过
  f.store.upsertProject(f.bot.id, { name: '已完成的事', status: 'completed' });
  let calls = 0;
  for (let n = 0; n < 3; n++) appendTurn(f.store, f.conversation);
  await maybeAutoUpdateProject({ store: f.store, bot: f.bot, conversation: f.conversation, provider: { async chat(args, handlers) { calls += 1; handlers.onText('x'); return { finishReason: 'stop' }; } }, emit: () => {} });
  assert.equal(calls, 0, '无活动项目时不应发起模型调用');
  // 回复 {"update":null} → 更新检查点但不动项目
  const f2 = fixture();
  f2.store.upsertProject(f2.bot.id, { name: '活跃', status: 'active' });
  for (let n = 0; n < 3; n++) appendTurn(f2.store, f2.conversation);
  await maybeAutoUpdateProject({ store: f2.store, bot: f2.bot, conversation: f2.conversation, provider: providerReturning({ update: null }), emit: () => {} });
  assert.equal(f2.store.getProject(f2.bot.id, '活跃').summary, undefined);
  assert.equal(f2.store.getAutoProjectCheckpoints()[f2.bot.id].lastRound > 0, true, 'update:null 也推进检查点');
});