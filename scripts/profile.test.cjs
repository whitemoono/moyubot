const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Store, CloudHost, LocalHost, AgentRuntime } = require('../packages/core/dist');
const temporary = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-profile-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('fresh setup uses requested installation workspace; partial setup survives restart and names are validated', (t) => {
  const dir = temporary(t), localDirectory = path.join(dir, 'install', 'workspace');
  const store = new Store(path.join(dir, 'data'), undefined, { localDirectory });
  assert.equal(store.getSettings().onboarding.completedAt, undefined);
  assert.equal(store.getSettings().workspaces.find((workspace) => workspace.kind === 'local').directory, localDirectory);
  store.updateSettings({ userName: '  白月  ', onboarding: { step: 2, cloudSkipped: true } });
  const next = new Store(store.dataDir);
  assert.equal(next.getSettings().userName, '白月');
  assert.deepEqual(next.getSettings().onboarding, { step: 2, cloudSkipped: true });
  for (const value of ['', '   ', 'line\nbreak', 'x'.repeat(41)]) assert.throws(() => next.updateSettings({ userName: value }), /用户名/);
  assert.equal(next.getSettings().userName, '白月');
});

test('existing users retain their chosen directories, history and completed setup', (t) => {
  const dir = temporary(t), store = new Store(dir);
  const bot = store.getSettings().bots[0], conversation = store.botConversation(bot.id);
  store.appendMessage(conversation.id, { id: 'history', role: 'user', content: '旧对话保留', createdAt: Date.now() });
  const settings = store.getSettings(), localDirectory = path.join(dir, 'chosen');
  settings.workspaces.find((workspace) => workspace.kind === 'local').directory = localDirectory;
  delete settings.onboarding; delete settings.userName;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const upgraded = new Store(dir, undefined, { localDirectory: path.join(dir, 'install', 'workspace') });
  assert.ok(upgraded.getSettings().onboarding.completedAt);
  assert.equal(upgraded.getSettings().workspaces.find((workspace) => workspace.kind === 'local').directory, localDirectory);
  assert.equal(upgraded.botConversation(bot.id).messages[0].content, '旧对话保留');
});

test('all cloud, local and group participants receive current shared name on each request', async (t) => {
  const store = new Store(temporary(t)); store.updateSettings({ userName: '白月' });
  const base = store.getSettings().bots[0];
  const other = store.upsertBot({ ...base, id: 'second-cloud' });
  const localBot = store.upsertBot({ ...base, id: 'local-bot', workspaceId: 'workspace_local' });
  const cloud = new CloudHost({ settings: { ...store.getSettings().cloud, driver: 'mock' } });
  const local = new LocalHost(store.getSettings().cloud);
  t.after(() => { cloud.dispose(); local.dispose(); });
  const seen = [];
  const runtime = new AgentRuntime({ store, cloud, computers: { workspace_local: local }, emit() {}, requestApproval: async () => true });
  runtime.providerFor = () => ({ provider: { chat: async (args, handlers) => { seen.push(args.system); handlers.onText?.('收到'); return {}; } }, imageGenerator: async () => { throw Error('unused'); } });
  for (const bot of [base, other, localBot]) {
    const result = await runtime.send({ botId: bot.id, text: '我的名字是什么？' });
    await runtime.waitForRun(result.runId);
  }
  const group = store.createGroup('群聊', [base.id, other.id]);
  const result = await runtime.send({ botId: base.id, conversationId: group.id, text: '我的名字是什么？' });
  await runtime.waitForRun(result.runId);
  assert.equal(seen.length, 5); assert.ok(seen.every((system) => system.includes('"userName":"白月"')));
  store.updateSettings({ userName: '新名字' });
  const changed = await runtime.send({ botId: localBot.id, text: '现在叫什么？' }); await runtime.waitForRun(changed.runId);
  assert.ok(seen.at(-1).includes('"userName":"新名字"')); assert.ok(!seen.at(-1).includes('"userName":"白月"'));
});
