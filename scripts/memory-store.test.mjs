import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'memory-store-tests', String(Date.now()));
let serial = 0;
function fixture(options = {}) {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir, undefined, options);
  const settings = store.getSettings();
  const atlas = { ...settings.bots[0] };
  const nova = { ...settings.bots[0], id: 'bot_nova', name: 'Nova' };
  store.updateSettings({ bots: [atlas, nova] });
  return { dataDir, store, atlas, nova };
}

/** 生成旧版 Markdown 记忆库目录（迁移测试用）。 */
function writeLegacyMarkdownLibrary(dataDir, scopeId, entries) {
  const dir = path.join(dataDir, 'memories', scopeId);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`# ${scopeId} 的记忆`, '', ''];
  for (const entry of entries) {
    const front = ['---', `id: ${entry.id}`, `scope: ${scopeId}`, `pinned: ${entry.pinned ? 'true' : 'false'}`, 'source: manual', 'createdAt: 2026-10-01T00:00:00.000Z', '---', ''].join('\n');
    const file = path.join(dir, `entry-${entry.id.slice(-6)}.md`);
    fs.writeFileSync(file, `${front}${entry.text}\n`, 'utf8');
    lines.push(`- [${entry.text.slice(0, 12)}](${path.basename(file)}) - ${entry.text}`);
  }
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), `${lines.join('\n')}\n`, 'utf8');
}

test('memories persist in a single SQLite database, isolated per scope', () => {
  const f = fixture();
  f.store.addMemory(f.atlas.id, '报告用中文，先给结论。');
  f.store.addMemory(f.nova.id, 'Nova 只负责写周报。', true);
  f.store.addMemory(f.atlas.id, '报告用中文，先给结论。');
  assert.equal(f.store.listMemories(f.atlas.id).length, 1, '同范围查重');
  assert.equal(f.store.listMemories(f.nova.id).length, 1);
  assert.ok(fs.existsSync(path.join(f.dataDir, 'memories.db')), '记忆落在单个数据库文件');
  const reopened = new Store(f.dataDir);
  assert.equal(reopened.listMemories(f.atlas.id)[0].text, '报告用中文，先给结论。');
  assert.equal(reopened.listMemories(f.nova.id)[0].pinned, true);
  const updated = reopened.updateMemory(reopened.listMemories(f.nova.id)[0].id, { text: 'Nova 负责周报与日报。', pinned: false });
  assert.equal(updated.pinned, false);
  const again = new Store(f.dataDir);
  assert.equal(again.listMemories(f.nova.id)[0].text, 'Nova 负责周报与日报。');
  again.removeMemory(again.listMemories(f.nova.id)[0].id);
  assert.equal(new Store(f.dataDir).listMemories(f.nova.id).length, 0, '删除落盘');
});

test('legacy memories.json and the Markdown library migrate into SQLite once, then archive', () => {
  const dataDir = path.join(root, String(++serial));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'memories.json'), JSON.stringify([
    { id: 'mem_legacy_a', botId: 'bot_default', text: '旧版 JSON 记忆', pinned: false, source: 'manual', createdAt: 1 },
  ]));
  writeLegacyMarkdownLibrary(dataDir, 'bot_default', [
    { id: 'mem_legacy_b', text: '旧版 Markdown 记忆' },
    { id: 'mem_legacy_c', text: '手工放进目录的记忆', pinned: true },
  ]);
  const store = new Store(dataDir);
  const texts = store.listMemories('bot_default').map((fact) => fact.text);
  assert.deepEqual(texts.sort(), ['旧版 JSON 记忆', '旧版 Markdown 记忆', '手工放进目录的记忆'].sort());
  assert.ok(!fs.existsSync(path.join(dataDir, 'memories.json')), '旧 json 迁移后改名');
  assert.ok(fs.existsSync(path.join(dataDir, 'memories.json.migrated')));
  assert.ok(fs.existsSync(path.join(dataDir, 'memories-md-archive')), 'md 资料库归档');
  assert.equal(new Store(dataDir).listMemories().length, 3, '重启不重复迁移');
});

test('recall degrades to keyword-only when the embedding service is unavailable', async () => {
  const f = fixture();
  f.store.addMemory(f.atlas.id, '报告用中文，先给结论。');
  f.store.addMemory(f.atlas.id, '每周五整理周报。');
  const hits = await f.store.searchMemories(f.atlas.id, '周报');
  assert.deepEqual(hits, ['每周五整理周报。']);
  const misses = await f.store.searchMemories(f.atlas.id, '完全不相关的查询词');
  assert.deepEqual(misses, [], '纯关键词模式下无命中即空');
});

test('hybrid recall uses vector similarity and still works after restart', async () => {
  // 向量按关键词构造：含"猫/宠物"的记忆落在同一方向，查询"猫"即可语义命中不含"猫"字面的记忆。
  const embedder = async (texts) => texts.map((text) => Float32Array.from(/猫|宠物|毛茸茸/.test(text) ? [1, 0] : [0, 1]));
  const f = fixture({ embedder });
  f.store.addMemory(f.atlas.id, '用户喜欢毛茸茸的宠物。');
  f.store.addMemory(f.atlas.id, '项目部署在华东区域。');
  await f.store.beginEmbeddingBackfill();
  const hits = await f.store.searchMemories(f.atlas.id, '猫');
  assert.deepEqual(hits, ['用户喜欢毛茸茸的宠物。'], '语义命中不含查询字面的记忆');
  const reopened = new Store(f.dataDir, undefined, { embedder });
  const semantic = await reopened.searchMemories(f.atlas.id, '猫');
  assert.deepEqual(semantic, ['用户喜欢毛茸茸的宠物。'], '向量持久化在数据库里，重启后仍可语义召回');
  const keywordMiss = await reopened.searchMemories(f.atlas.id, '部署区域');
  assert.deepEqual(keywordMiss, ['项目部署在华东区域。'], '关键词路径不受向量影响');
});

test('mobile sync applies memory records into SQLite', () => {
  const f = fixture();
  f.store.applySyncRecords([
    { collection: 'memories', id: 'mem_sync_1', revision: 1, value: { botId: f.atlas.id, text: '手机端写来的记忆', pinned: false, createdAt: Date.now(), source: 'manual' } },
  ]);
  assert.equal(f.store.listMemories(f.atlas.id)[0].text, '手机端写来的记忆');
  const reopened = new Store(f.dataDir);
  assert.equal(reopened.listMemories(f.atlas.id).length, 1);
  reopened.applySyncRecords([{ collection: 'memories', id: 'mem_sync_1', revision: 2, value: null }]);
  assert.equal(new Store(f.dataDir).listMemories(f.atlas.id).length, 0, '同步删除落盘');
});
