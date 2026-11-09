import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'history-search-tests', String(Date.now()));
let serial = 0;
function fixture() {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir, undefined, { embedder: async () => null });
  const bot = { ...store.getSettings().bots[0] };
  const conversation = store.botConversation(bot.id);
  return { dataDir, store, bot, conversation };
}

test('history_search finds past messages by keyword across restart', () => {
  const f = fixture();
  let t = Date.now();
  f.store.appendMessage(f.conversation.id, { id: 'm1', role: 'user', content: '为什么放弃这个 API，它兼容性一直有问题。', createdAt: t++ });
  f.store.appendMessage(f.conversation.id, { id: 'm2', role: 'assistant', content: '因为那个中转商经常 502，决定换用 DeepSeek 直连。', createdAt: t++ });
  f.store.appendMessage(f.conversation.id, { id: 'm3', role: 'user', content: '好的，报告用中文输出。', createdAt: t++ });

  const hits = f.store.searchHistory('中转商 502', { conversationId: f.conversation.id });
  assert.ok(hits.some((hit) => hit.text.includes('502')), '应该检索到那条关于 502 的历史助手消息');

  // 只索引 user/assistant，不含 tool/system
  const reopened = new Store(f.dataDir, undefined, { embedder: async () => null });
  const afterRestart = reopened.searchHistory('API 放弃', { conversationId: f.conversation.id });
  assert.ok(afterRestart.length > 0, '重启后索引仍可用，能搜到"为什么放弃这个 API"');
});

test('history_search supports time filtering and limit', () => {
  const f = fixture();
  let t = Date.now() - 10;
  f.store.appendMessage(f.conversation.id, { id: 'o1', role: 'user', content: '项目预算上限三百万', createdAt: t });
  f.store.appendMessage(f.conversation.id, { id: 'o2', role: 'assistant', content: '预算已记录', createdAt: t + 20 });
  const recent = f.store.searchHistory('预算', { conversationId: f.conversation.id, since: t + 10, limit: 1 });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, 'o2');
});

test('recall and history_search stay separate capabilities', async () => {
  const f = fixture();
  f.store.appendMessage(f.conversation.id, { id: 'h1', role: 'user', content: '旧对话里讨论过截图工具选型', createdAt: Date.now() });
  // 没有写长期记忆，只有原始消息
  assert.equal(f.store.listMemories(f.bot.id).length, 0);
  const hist = f.store.searchHistory('截图工具', { conversationId: f.conversation.id });
  assert.equal(hist.length, 1, 'history_search 能找到未整理成记忆的原始对话');
  const recalled = await f.store.searchMemories(f.bot.id, '截图工具');
  assert.deepEqual(recalled, [], 'recall 只搜已整理的长期记忆，搜不到原始历史');
});