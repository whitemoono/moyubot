import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store, CloudHost, AgentRuntime } from '../packages/core/dist/index.js';
import { messagesFor, prepareContext } from '../packages/core/dist/context.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'conversation-tests', String(Date.now()));
let serial = 0;
function fixture() {
  const dataDir = path.join(root, String(++serial));
  const store = new Store(dataDir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], tools: [], model: 'test-model' };
  store.updateSettings({ bots: [bot], providers: [{ ...settings.providers[0], contextWindowTokens: 4096 }], cloud: { ...settings.cloud, driver: 'mock' } });
  return { dataDir, store, bot, conversation: store.botConversation(bot.id) };
}
function addTurn(store, conv, n, long = false) {
  store.appendMessage(conv.id, { id: `user-${n}`, role: 'user', content: `独特历史标记-${n} ${long ? '长期项目的进展与约束。'.repeat(60) : '请记住项目进展。'}`, createdAt: n * 2 });
  store.appendMessage(conv.id, { id: `assistant-${n}`, role: 'assistant', content: `第${n}轮已经处理`, createdAt: n * 2 + 1, ...(n === 0 ? { toolCalls: [{ id: 'read-0', name: 'cloud_read', arguments: { path: 'notes.md' } }], toolResults: [{ id: 'read-0', name: 'cloud_read', ok: true, summary: '读取完成', detail: '关键文件内容：部署前需要用户确认' }] } : {}) });
}
function pending(f) {
  f.store.appendMessage(f.conversation.id, { id: 'current-user', role: 'user', content: '继续这个项目', createdAt: Date.now() });
  return [{ role: 'user', content: '继续这个项目' }];
}
function summaryProvider(onCall = () => {}) {
  return { kind: 'openai', async chat(args, handlers) {
    onCall(args);
    assert.deepEqual(args.tools, [], 'Compaction must not expose tools');
    handlers.onText(JSON.stringify({ summary: '项目仍在推进；部署前需要用户确认。用户偏好中文回答。', memories: ['用户喜欢中文', '正在维护 MoyuBot 项目', 'Token: do-not-store-this-value'] }));
    return { finishReason: 'stop' };
  } };
}
const prepare = (f, live, provider, extra = {}) => prepareContext({ ...f, userMessageId: 'current-user', live, provider, system: '你是一个助手', tools: [], signal: new AbortController().signal, emit: () => {}, ...extra });

test('sidebar organization persists without replacing Bot configuration, history, or memories', () => {
  const f = fixture();
  addTurn(f.store, f.conversation, 1);
  f.store.addMemory(f.bot.id, '保留这条记忆');
  f.store.updateBotMetadata(f.bot.id, { sidebar: { pinned: true, unread: true, group: '工作' } });
  f.store.updateBotMetadata(f.bot.id, { name: '  Atlas 新名字  ', sidebar: { unread: false } });
  f.store.updateBotMetadata(f.bot.id, { sidebar: { hidden: true, pinned: false } });
  const reopened = new Store(f.dataDir);
  const bot = reopened.getBot(f.bot.id);
  assert.equal(bot.name, 'Atlas 新名字');
  assert.deepEqual(bot.sidebar, { pinned: false, unread: false, group: '工作', hidden: true });
  assert.equal(bot.model, f.bot.model);
  assert.deepEqual(bot.tools, f.bot.tools);
  assert.equal(reopened.botConversation(bot.id).id, f.conversation.id);
  assert.equal(reopened.botConversation(bot.id).messages.length, 2);
  assert.equal(reopened.listMemories(bot.id)[0].text, '保留这条记忆');
  assert.throws(() => reopened.updateBotMetadata(bot.id, { name: '  ' }), /名字/);
  assert.throws(() => reopened.updateBotMetadata('missing', { name: 'Ghost' }), /不存在/);
});

test('ungrouped section moves among named groups and retains its position without changing Bot membership', () => {
  const f = fixture();
  f.store.upsertBot({ ...f.bot, id: 'work-member', sidebar: { group: '工作' } });
  f.store.upsertBot({ ...f.bot, id: 'idea-member', sidebar: { group: '灵感' } });
  addTurn(f.store, f.conversation, 1);
  f.store.addMemory(f.bot.id, '不改变这条记忆');
  const membership = f.store.getSettings().bots.map((bot) => [bot.id, bot.sidebar?.group]);
  f.store.updateBotGroup('', { type: 'move', direction: 'up' });
  assert.equal(f.store.getSettings().ui.ungroupedGroupIndex, 1);
  assert.deepEqual(f.store.listBotGroups().map((group) => group.name), ['工作', '灵感']);
  const reopened = new Store(f.dataDir);
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, 1);
  reopened.updateBotGroup('', { type: 'move', direction: 'up' });
  reopened.updateBotGroup('', { type: 'move', direction: 'up' });
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, 0, 'Moving beyond the first position is a no-op');
  reopened.updateBotGroup('工作', { type: 'move', direction: 'up' });
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, 1, 'Named groups can move past the ungrouped section');
  reopened.updateBotGroup('', { type: 'move', direction: 'down' });
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, undefined, 'Last position follows the default ordering');
  reopened.updateBotGroup('', { type: 'move', direction: 'down' });
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, undefined);
  assert.deepEqual(reopened.getSettings().bots.map((bot) => [bot.id, bot.sidebar?.group]), membership);
  assert.equal(reopened.botConversation(f.bot.id).messages.length, 2);
  assert.equal(reopened.listMemories(f.bot.id)[0].text, '不改变这条记忆');
  assert.throws(() => reopened.updateBotGroup('', { type: 'rename', name: '其他' }), /仅支持/);
  assert.throws(() => reopened.updateBotGroup('', { type: 'delete' }), /仅支持/);
  reopened.updateBotGroup('', { type: 'move', direction: 'up' });
  reopened.updateBotGroup('工作', { type: 'delete' });
  assert.equal(reopened.getSettings().ui.ungroupedGroupIndex, 0, 'Deleting a preceding group keeps the section in place');
  assert.equal(new Store(f.dataDir).getSettings().ui.ungroupedGroupIndex, 0);
  const before = reopened.getSettings();
  const persist = reopened.persistSettings;
  reopened.persistSettings = () => { throw new Error('disk unavailable'); };
  assert.throws(() => reopened.updateBotGroup('', { type: 'move', direction: 'down' }), /disk unavailable/);
  assert.equal(reopened.getSettings(), before, 'A storage error rolls back section ordering');
  reopened.persistSettings = persist;
});

test('group storage validates members and stays separate from each Bot fixed conversation', () => {
  const f = fixture();
  const second = { ...f.bot, id: 'group-member', name: 'Second' };
  f.store.upsertBot(second);
  assert.throws(() => f.store.createGroup('', [f.bot.id, f.bot.id]), /2–12/);
  assert.throws(() => f.store.createGroup('', [f.bot.id, 'missing']), /不存在/);
  const group = f.store.createGroup('  灵感小组  ', [f.bot.id, second.id, f.bot.id]);
  f.store.appendMessage(group.id, { id: 'group-user', role: 'user', content: '共同讨论', createdAt: 1 });
  const reopened = new Store(f.dataDir);
  assert.equal(reopened.getConversation(group.id).title, '灵感小组');
  assert.deepEqual(reopened.getConversation(group.id).group.memberBotIds, [f.bot.id, second.id]);
  assert.equal(reopened.botConversation(f.bot.id).messages.length, 0);
  assert.equal(reopened.botConversation(second.id).messages.length, 0);
  assert.equal(reopened.listConversations().filter((item) => item.group).length, 1);
});

test('sidebar groups persist folding and order; rename and deletion update every member without touching conversations', () => {
  const f = fixture();
  const second = { ...f.bot, id: 'sidebar-hidden', name: 'Hidden', sidebar: { group: '工作', hidden: true } };
  const third = { ...f.bot, id: 'sidebar-third', name: 'Third', sidebar: { group: '灵感' } };
  f.store.upsertBot(second); f.store.upsertBot(third);
  f.store.updateBotMetadata(f.bot.id, { sidebar: { group: '工作', pinned: true } });
  addTurn(f.store, f.conversation, 1);
  f.store.addMemory(f.bot.id, '保留分组成员的记忆');
  assert.deepEqual(f.store.listBotGroups().map((item) => item.name), ['工作', '灵感']);
  f.store.updateBotGroup('工作', { type: 'collapse', collapsed: true });
  f.store.updateBotGroup('工作', { type: 'move', direction: 'up' });
  assert.equal(f.store.listBotGroups()[0].name, '工作', 'Moving beyond the first position has no effect');
  f.store.updateBotGroup('工作', { type: 'move', direction: 'down' });
  f.store.updateBotGroup('工作', { type: 'rename', name: ' 项目 ' });
  assert.equal(f.store.getBot(f.bot.id).sidebar.group, '项目');
  assert.equal(f.store.getBot(second.id).sidebar.group, '项目');
  assert.equal(f.store.getBot(second.id).sidebar.hidden, true);
  assert.equal(f.store.getBot(f.bot.id).sidebar.pinned, true);
  const reopened = new Store(f.dataDir);
  assert.deepEqual(reopened.listBotGroups(), [{ name: '灵感', collapsed: false }, { name: '项目', collapsed: true }]);
  assert.throws(() => reopened.updateBotGroup('项目', { type: 'rename', name: '灵感' }), /同名/);
  assert.throws(() => reopened.updateBotGroup('项目', { type: 'rename', name: '  ' }), /1–60/);
  assert.equal(reopened.getBot(f.bot.id).sidebar.group, '项目');
  reopened.updateBotGroup('项目', { type: 'delete' });
  assert.equal(reopened.getBot(f.bot.id).sidebar.group, '');
  assert.equal(reopened.getBot(second.id).sidebar.group, '');
  assert.equal(reopened.getBot(second.id).sidebar.hidden, true);
  assert.equal(reopened.getBot(f.bot.id).sidebar.pinned, true);
  assert.equal(reopened.botConversation(f.bot.id).id, f.conversation.id);
  assert.equal(reopened.botConversation(f.bot.id).messages.length, 2);
  assert.equal(reopened.listMemories(f.bot.id)[0].text, '保留分组成员的记忆');
  assert.deepEqual(new Store(f.dataDir).listBotGroups().map((item) => item.name), ['灵感']);
  const previous = reopened.getSettings();
  reopened.persistSettings = () => { throw new Error('simulated group save failure'); };
  assert.throws(() => reopened.updateBotGroup('灵感', { type: 'rename', name: '不会保存' }), /save failure/);
  assert.equal(reopened.getSettings(), previous, 'Failed group saves restore the previous settings snapshot');
});

test('group replies preserve speaker identity, shared context, private memory isolation, and cancellation', async () => {
  const f = fixture();
  const second = { ...f.bot, id: 'second-group-bot', name: 'Second', model: 'second-model' };
  f.store.upsertBot(second);
  f.store.addMemory(f.bot.id, 'PRIVATE_MEMORY_NEVER_SHARE');
  f.store.appendMessage(f.conversation.id, { id: 'private-note', role: 'user', content: 'PRIVATE_TRANSCRIPT_NEVER_SHARE', createdAt: 1 });
  const seen = [];
  let block = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); seen.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: body.model === 'second-model' ? 'Second 的补充' : 'First 的观点' } }] })}\n\n`);
    if (block) { await new Promise((resolve) => setTimeout(resolve, 200)); if (res.destroyed) return; }
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  f.store.updateSettings({ providers: [{ ...f.store.getSettings().providers[0], baseUrl: `http://localhost:${server.address().port}/v1`, contextWindowTokens: 8192 }] });
  const cloud = new CloudHost({ settings: f.store.getSettings().cloud, apiKey: () => '', onStatus: () => {} });
  const events = [];
  const runtime = new AgentRuntime({ store: f.store, cloud, emit: (event) => events.push(event), requestApproval: async () => true });
  const waitFor = async (condition) => { const deadline = Date.now() + 5000; while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10)); assert.ok(condition()); };
  const group = f.store.createGroup('共同思考', [f.bot.id, second.id]);
  try {
    await runtime.send({ conversationId: group.id, botId: f.bot.id, text: '讨论设计' });
    await assert.rejects(runtime.send({ conversationId: group.id, botId: second.id, text: '重复发送' }), /正在回复/);
    await waitFor(() => !runtime.isRunning(group.id));
    assert.deepEqual(group.messages.map((message) => message.role), ['user', 'assistant', 'assistant']);
    assert.deepEqual(group.messages.slice(1).map((message) => message.botId), [f.bot.id, second.id]);
    assert.equal(seen.length, 2);
    assert.ok(seen[1].messages.some((message) => message.role === 'user' && message.content.includes('First 的观点') && message.content.includes(f.bot.name)));
    assert.ok(seen.every((body) => !JSON.stringify(body).includes('PRIVATE_')));
    assert.equal(events.filter((event) => event.type === 'run_end').length, 1);
    assert.equal(f.store.botConversation(f.bot.id).messages.length, 1);
    assert.equal(f.store.botConversation(second.id).messages.length, 0);
    await runtime.send({ conversationId: group.id, botId: f.bot.id, text: '继续讨论' });
    await waitFor(() => !runtime.isRunning(group.id));
    assert.ok(seen[2].messages.some((message) => message.role === 'user' && message.content.includes('Second 的补充')));
    assert.equal(new Store(f.dataDir).getConversation(group.id).messages.length, 6);
    block = true;
    const before = seen.length;
    await runtime.send({ conversationId: group.id, botId: f.bot.id, text: '测试群聊停止' });
    await waitFor(() => seen.length > before);
    assert.equal(runtime.stop(group.id), true);
    await waitFor(() => !runtime.isRunning(group.id));
    assert.equal(seen.length, before + 1, 'Stopping a group prevents queued Bot replies');
    assert.equal(group.messages.at(-1).stopped, true);
    assert.equal(events.filter((event) => event.type === 'run_end').at(-1).error, '已停止');
  } finally { cloud.dispose(); server.close(); }
});

test('replies validate the source, persist selected quotes and reach the model in private and group chats', async () => {
  const f = fixture();
  f.store.updateSettings({ providers: [{ ...f.store.getSettings().providers[0], contextWindowTokens: 32768 }] });
  const peer = { ...f.bot, id: 'reply-peer', name: 'Peer' };
  f.store.upsertBot(peer);
  addTurn(f.store, f.conversation, 1);
  const cloud = new CloudHost({ settings: f.store.getSettings().cloud, apiKey: () => '', onStatus: () => {} });
  const runtime = new AgentRuntime({ store: f.store, cloud, emit: () => {}, requestApproval: async () => true });
  const seen = [];
  runtime.providerFor = () => ({ provider: { kind: 'openai', async chat(args, handlers) { seen.push(args); handlers.onText('已理解引用'); return { finishReason: 'stop' }; } } });
  const waitRun = async (id) => { const end = Date.now() + 5000; while (runtime.isRunning(id) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(runtime.isRunning(id), false); };
  try {
    const request = { botId: f.bot.id, text: '解释这部分', replyTo: { messageId: 'assistant-1', selectedText: '已经处理' } };
    const result = await runtime.send(request);
    await waitRun(result.conversationId);
    const saved = new Store(f.dataDir).getConversation(result.conversationId).messages.find((message) => message.id === result.userMessageId);
    assert.equal(saved.content, '解释这部分');
    assert.deepEqual(saved.replyTo, { messageId: 'assistant-1', author: f.bot.name, content: '已经处理' });
    assert.match(seen[0].messages.at(-1).content, /引用了.*历史消息/s);
    assert.ok(seen[0].messages.at(-1).content.includes('> 已经处理'));
    assert.ok(seen[0].messages.at(-1).content.endsWith('解释这部分'));
    await assert.rejects(runtime.send({ ...request, replyTo: { messageId: 'assistant-1', selectedText: '伪造的引用' } }), /不一致/);
    await assert.rejects(runtime.send({ ...request, botId: peer.id }), /无法引用/);
    assert.equal(runtime.isRunning(f.conversation.id), false, 'Invalid quotes must not leave a busy run');
    const group = f.store.createGroup('引用讨论', [f.bot.id, peer.id]);
    f.store.appendMessage(group.id, { id: 'group-source', role: 'assistant', botId: peer.id, botName: peer.name, content: '群聊中的原始观点', createdAt: 1 });
    await runtime.send({ botId: f.bot.id, conversationId: group.id, text: '继续这个观点', replyTo: { messageId: 'group-source' } });
    await waitRun(group.id);
    assert.equal(group.messages[1].replyTo.author, 'Peer');
    assert.ok(seen.slice(-2).every((args) => args.messages.some((message) => message.role === 'user' && message.content.includes('> 群聊中的原始观点'))));
    await assert.rejects(runtime.send({ botId: f.bot.id, conversationId: group.id, text: '引用私聊', replyTo: { messageId: 'assistant-1' } }), /无法引用/);
    f.store.appendMessage(group.id, { id: 'streaming-source', role: 'assistant', content: '还在生成', createdAt: 2, streaming: true });
    await assert.rejects(runtime.send({ botId: f.bot.id, conversationId: group.id, text: '继续', replyTo: { messageId: 'streaming-source' } }), /无法引用/);
    f.store.appendMessage(f.conversation.id, { id: 'image-source', role: 'user', content: '', createdAt: 3, attachments: [{ id: 'img', kind: 'image', name: '示意图.png' }] });
    const imageReply = await runtime.send({ botId: f.bot.id, text: '这张图', replyTo: { messageId: 'image-source' } });
    await waitRun(imageReply.conversationId);
    assert.equal(f.conversation.messages.find((message) => message.id === imageReply.userMessageId).replyTo.content, '[图片：示意图.png]');
  } finally { cloud.dispose(); }
});

test('group compaction retains attributed history and writes only group memories', async () => {
  const f = fixture();
  f.store.upsertBot({ ...f.bot, id: 'summary-peer', name: 'Peer' });
  const conversation = f.store.createGroup('摘要群', [f.bot.id, 'summary-peer']);
  for (let n = 0; n < 8; n++) addTurn(f.store, conversation, n, true);
  f.store.appendMessage(conversation.id, { id: 'current-user', role: 'user', content: '继续群聊', createdAt: Date.now() });
  await prepare({ ...f, conversation }, [{ role: 'user', content: '继续群聊' }], summaryProvider());
  assert.ok(conversation.context);
  assert.ok(f.store.listMemories(conversation.id).length > 0);
  assert.equal(f.store.listMemories(f.bot.id).length, 0);
  assert.equal(f.store.listMemories('summary-peer').length, 0);
});

test('legacy threads merge chronologically without deleting the originals; reopening is idempotent', () => {
  const f = fixture();
  const legacy = [
    { id: 'legacy-a', botId: f.bot.id, title: 'old A', createdAt: 1, updatedAt: 3, messages: [{ id: 'a', role: 'user', content: '早期记录', createdAt: 1 }] },
    { id: 'legacy-b', botId: f.bot.id, title: 'old B', createdAt: 2, updatedAt: 4, messages: [{ id: 'b', role: 'assistant', content: '后续记录', createdAt: 3 }] },
  ];
  for (const conv of legacy) fs.writeFileSync(path.join(f.dataDir, 'conversations', `${conv.id}.json`), JSON.stringify(conv));
  const migrated = new Store(f.dataDir);
  assert.equal(migrated.listConversations(f.bot.id).length, 1);
  const canonical = migrated.botConversation(f.bot.id);
  assert.equal(canonical.id, 'legacy-a');
  assert.deepEqual(canonical.messages.map((m) => m.id), ['a', 'b']);
  assert.equal(migrated.getConversation('legacy-b').id, canonical.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'conversations', 'legacy-b.json'))).messages[0].content, '后续记录');
  assert.equal(new Store(f.dataDir).botConversation(f.bot.id).messages.length, 2);
  assert.equal(migrated.createConversation(f.bot.id).id, canonical.id);
  assert.equal(migrated.createConversation(f.bot.id).id, canonical.id);
});

test('compaction batches history, keeps complete tool groups, persists a summary, and deduplicates durable facts', async () => {
  const f = fixture();
  f.store.addMemory(f.bot.id, '用户喜欢中文。', true);
  for (let n = 0; n < 8; n++) addTurn(f.store, f.conversation, n, true);
  const live = pending(f);
  const originalCount = f.conversation.messages.length;
  const chunks = [];
  const provider = summaryProvider((args) => chunks.push(args.messages[0].content.split('新增历史片段：\n')[1]));
  const result = await prepare(f, live, provider);
  assert.ok(chunks.length > 1, 'Oversized history should be summarized in bounded chunks');
  assert.ok(result.system.includes('压缩摘要'));
  assert.ok(chunks.join('').includes('独特历史标记-0'));
  assert.ok(chunks.join('').includes('关键文件内容：部署前需要用户确认'));
  assert.equal(f.conversation.messages.length, originalCount, 'Full transcript must remain unchanged');
  assert.ok(result.messages.length < originalCount);
  assert.equal(result.messages.at(-1).content, '继续这个项目');
  const facts = f.store.listMemories(f.bot.id);
  assert.equal(facts.length, 2);
  assert.equal(facts.find((fact) => fact.pinned).text, '用户喜欢中文。');
  assert.equal(facts.find((fact) => fact.text.includes('MoyuBot')).source, 'automatic');
  const reloaded = new Store(f.dataDir).botConversation(f.bot.id);
  assert.deepEqual(reloaded.context, f.conversation.context);
  assert.equal(reloaded.messages.length, originalCount);
  const calls = chunks.length;
  await prepare(f, live, provider);
  assert.equal(chunks.length, calls, 'Reusing a summary should not summarize the same history again');
  for (const message of result.messages.filter((m) => m.role === 'assistant')) {
    for (const call of message.toolCalls ?? []) assert.ok(result.messages.some((m) => m.role === 'tool' && m.toolCallId === call.id));
  }
});

test('invalid or aborted summaries never advance the durable cursor or write extracted memories', async () => {
  for (const mode of ['invalid', 'partial', 'abort']) {
    const f = fixture();
    for (let n = 0; n < 6; n++) addTurn(f.store, f.conversation, n, true);
    const live = pending(f);
    const count = f.conversation.messages.length;
    const abort = new AbortController();
    let calls = 0;
    const provider = { kind: 'openai', async chat(_args, handlers) {
      calls++;
      handlers.onText(mode === 'invalid' || (mode === 'partial' && calls > 1) ? 'invalid JSON' : JSON.stringify({ summary: '摘要', memories: ['不应保存'] }));
      if (mode === 'abort') abort.abort();
      return { finishReason: 'stop' };
    } };
    await assert.rejects(prepare(f, live, provider, { signal: abort.signal }));
    assert.equal(f.conversation.context, undefined);
    assert.equal(f.conversation.messages.length, count);
    assert.equal(f.store.listMemories(f.bot.id).length, 0);
    assert.equal(new Store(f.dataDir).botConversation(f.bot.id).context, undefined);
  }
});

test('an oversized current message is reported without truncating or deleting it', async () => {
  const f = fixture();
  const text = '超长当前输入'.repeat(3000);
  f.store.appendMessage(f.conversation.id, { id: 'current-user', role: 'user', content: text, createdAt: Date.now() });
  await assert.rejects(prepare(f, [{ role: 'user', content: text }], summaryProvider()), /超过模型上下文/);
  assert.equal(f.conversation.messages[0].content, text);
  assert.equal(f.conversation.context, undefined);
});

test('storage failures do not advance the in-memory or persisted compaction cursor', async () => {
  for (const method of ['addMemory', 'saveConversation']) {
    const f = fixture();
    for (let n = 0; n < 6; n++) addTurn(f.store, f.conversation, n, true);
    const live = pending(f);
    f.store[method] = () => { throw new Error('simulated storage failure'); };
    await assert.rejects(prepare(f, live, summaryProvider()), /storage failure/);
    assert.equal(f.conversation.context, undefined);
    assert.equal(new Store(f.dataDir).botConversation(f.bot.id).context, undefined);
  }
});

test('interrupted calls never turn into orphan tool messages in the next request', () => {
  const converted = messagesFor([{ id: 'x', role: 'assistant', content: '中断了', createdAt: 1, toolCalls: [{ id: 'missing', name: 'cloud_exec', arguments: {} }], toolResults: [{ id: 'orphan', name: 'cloud_exec', ok: true, summary: '没有匹配调用' }] }]);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].toolCalls, undefined);
});

test('runtime reuses the same thread, recovers from a real context rejection, and isolates simultaneous bots', async () => {
  const f = fixture();
  const seen = [];
  let rejectFirst = true;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    seen.push(body);
    const summarizing = body.messages[0]?.content.includes('你负责压缩');
    if (!summarizing && rejectFirst) { rejectFirst = false; res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'maximum context length exceeded' } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    await new Promise((resolve) => setTimeout(resolve, 35));
    const content = summarizing ? JSON.stringify({ summary: '项目按计划推进，用户要求中文回答。', memories: ['用户要求中文回答'] }) : '已继续同一个 Bot 的对话';
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const settings = f.store.getSettings();
  const second = { ...f.bot, id: 'second-bot', name: 'Second' };
  f.store.updateSettings({ bots: [f.bot, second], providers: [{ ...settings.providers[0], baseUrl: `http://localhost:${server.address().port}/v1` }] });
  for (let n = 0; n < 6; n++) addTurn(f.store, f.conversation, n);
  const cloud = new CloudHost({ settings: f.store.getSettings().cloud, apiKey: () => '', onStatus: () => {} });
  const events = [];
  const runtime = new AgentRuntime({ store: f.store, cloud, emit: (event) => events.push(event), requestApproval: async () => true });
  const waitRun = async (id) => { const end = Date.now() + 5000; while (runtime.isRunning(id) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(runtime.isRunning(id), false); };
  try {
    const run = await runtime.send({ botId: f.bot.id, text: '继续' });
    await assert.rejects(runtime.send({ botId: f.bot.id, text: '并发发送' }), /还在生成/);
    await assert.rejects(runtime.send({ botId: second.id, conversationId: run.conversationId, text: '跨 Bot' }), /其他 Bot/);
    const other = await runtime.send({ botId: second.id, text: '另一个 Bot 的消息' });
    await Promise.all([waitRun(run.conversationId), waitRun(other.conversationId)]);
    assert.equal(run.conversationId, f.conversation.id);
    assert.notEqual(other.conversationId, run.conversationId);
    assert.ok(f.conversation.context, f.conversation.messages.at(-1)?.error);
    assert.ok(events.some((event) => event.type === 'context_compaction' && event.phase === 'done'));
    assert.equal(f.conversation.messages.at(-1).error, undefined);
    assert.equal(f.store.botConversation(second.id).messages.length, 2);
    const next = await runtime.send({ botId: f.bot.id, text: '再次继续' });
    await waitRun(next.conversationId);
    assert.equal(next.conversationId, run.conversationId);
    assert.equal(f.store.listConversations().length, 2);
    for (const event of events.filter((e) => ['message_start', 'delta', 'message_end', 'run_end'].includes(e.type))) assert.ok(event.conversationId);
    assert.ok(seen.some((body) => body.messages[0].content.includes('conversation_summary')));
  } finally { cloud.dispose(); server.close(); }
});
