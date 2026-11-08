import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, CloudHost, Store } from '../packages/core/dist/index.js';
import { testProvider } from './test-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'subagent-tests', String(Date.now()));
let serial = 0;

const toolNames = (body) => (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
// 子智能体请求：初次派发、续聊追问、fork 分身三种入口都带各自的标记词，且都不走父任务剧本。
const isChildRequest = (body) => /你是子智能体|一次追问|父对话最近的节选/.test(String(body.messages.at(-1)?.content ?? ''));

/**
 * 假供应商：父任务的第一个请求返回 spawn_agent 工具调用，之后返回收尾文本；
 * 子智能体请求默认返回结论，childMode='error' 时返回 500 让子任务真的失败。
 */
function fakeProvider(options = {}) {
  const requests = [];
  let parentTurns = 0;
  const http2 = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (isChildRequest(body)) {
      if (options.childMode === 'error') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: '子任务模型不可用' } })); return; }
      if (options.childDelay) await new Promise((resolve) => setTimeout(resolve, options.childDelay));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: options.childText ?? '结论：只读调研完成\n依据：notes.md:12\n未覆盖：无' }, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    parentTurns += 1;
    const delta = parentTurns === 1
      ? { tool_calls: [{ index: 0, id: 'call-parent-1', function: { name: 'spawn_agent', arguments: JSON.stringify(options.spawnArgs ?? { task: '调研 A 的用法' }) } }] }
      : { content: '已根据子智能体的结论收尾' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return { requests, listen: () => new Promise((resolve) => http2.listen(0, 'localhost', () => resolve(http2.address().port))), close: () => new Promise((resolve) => http2.close(resolve)) };
}

async function fixture(options = {}) {
  const provider = fakeProvider(options);
  const port = await provider.listen();
  const dir = path.join(root, String(++serial));
  const store = new Store(dir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], model: 'test-model', tools: ['spawn_agent', 'cloud_read', 'cloud_exec', 'cloud_write', 'remember', 'schedule_task', 'generate_image'] };
  store.updateSettings({
    bots: [bot],
    providers: [{ ...testProvider({ baseUrl: `http://localhost:${port}/v1`, contextWindowTokens: 128000 }) }],
    cloud: { ...settings.cloud, driver: 'mock' },
  });
  const events = [];
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({ store, cloud, emit: (event) => events.push(event), requestApproval: async () => true });
  const spawnResult = () => store.botConversation(bot.id).messages.at(-1).toolResults?.find((item) => item.name === 'spawn_agent');
  return { provider, store, bot, events, cloud, runtime, spawnResult, dataDir: dir, cleanup: async () => { cloud.dispose(); await provider.close(); } };
}

const childRequests = (requests) => requests.filter(isChildRequest);

test('spawn_agent runs the child and returns its answer as the tool result', async () => {
  const f = await fixture();
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const result = f.spawnResult();
    assert.ok(result, '父会话必须拿到 spawn_agent 的工具结果');
    assert.equal(result.ok, true, `子智能体应当成功，实际：${result.summary}`);
    assert.match(result.detail, /只读调研完成/, '子智能体的结论要回灌给父任务');
    assert.match(result.detail, /子任务 1/, '结果要标明是第几个子任务');

    const starts = f.events.filter((event) => event.type === 'subagent' && event.status === 'start');
    const dones = f.events.filter((event) => event.type === 'subagent' && event.status === 'done');
    assert.equal(starts.length, 1, '要发出批次开始事件供界面画卡片');
    assert.equal(dones.length, 1, '要发出批次结束事件');
    assert.equal(starts[0].callId, dones[0].callId, 'start 与 done 必须对应同一次工具调用');
    assert.equal(dones[0].children.length, 1);
    assert.ok(dones[0].seconds >= 1, '批次耗时要给界面展示');

    const conversationId = f.store.botConversation(f.bot.id).id;
    assert.equal(f.events.filter((event) => event.type === 'run_end').length, 1, '子会话不得自己发 run_end');
    assert.ok(f.events.filter((event) => event.type === 'context_usage').every((event) => event.conversationId === conversationId),
      '子会话不得污染界面顶部的上下文用量遥测');
  } finally { await f.cleanup(); }
});

test('children lose every write-capable tool and inherit no parent history', async () => {
  const f = await fixture();
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const [child] = childRequests(f.provider.requests);
    assert.ok(child, '子智能体应发起过模型请求');
    const names = toolNames(child);
    for (const forbidden of ['cloud_exec', 'cloud_write', 'remember', 'schedule_task', 'spawn_agent', 'desktop_action', 'generate_image']) {
      assert.ok(!names.includes(forbidden), `子智能体不该拿到有副作用的工具 ${forbidden}`);
    }
    assert.ok(names.includes('cloud_read') && names.includes('web_fetch'), '只读调研工具应当保留');
    // 请求里除了 system 只该有子任务那一条 user 消息；父任务的原话不得出现在子的上下文中。
    const turns = child.messages.filter((message) => message.role !== 'system');
    assert.equal(turns.length, 1, '子智能体只能看到自己的那条任务消息');
    assert.equal(turns[0].role, 'user');
    assert.ok(!JSON.stringify(child.messages).includes('帮我调研一下'), '子智能体不能继承父对话历史，必须从自包含任务起步');
    assert.equal(f.store.listConversations().length, 1, '子会话不出现在会话列表');
    assert.equal(f.store.botConversation(f.bot.id).messages.filter((message) => String(message.content).includes('你是子智能体')).length, 0,
      '子任务消息绝不能被并进用户的固定会话');
  } finally { await f.cleanup(); }
});

test('每个子任务都发出逐项进度事件，界面才能显示第几个在跑', async () => {
  const f = await fixture({ spawnArgs: { tasks: ['调研 A', '调研 B', '调研 C'] } });
  try {
    await f.runtime.runUnattended(f.bot.id, '分头调研');
    const batch = f.events.find((event) => event.type === 'subagent' && event.status === 'start');
    const childEvents = f.events.filter((event) => event.type === 'subagent' && event.status === 'child');
    assert.ok(childEvents.every((event) => event.callId === batch.callId), '逐项事件必须挂在同一次工具调用上');
    assert.deepEqual([...new Set(childEvents.map((event) => event.index))].sort(), [0, 1, 2], '三个子任务都要有各自的序号');
    for (const index of [0, 1, 2]) {
      const mine = childEvents.filter((event) => event.index === index).map((event) => event.state);
      assert.deepEqual(mine, ['running', 'done'], `第 ${index} 个应当是 先 running 再 done，实际 ${mine.join(',')}`);
    }
    assert.ok(f.events.some((event) => event.type === 'subagent' && event.status === 'done' && event.children.length === 3));
  } finally { await f.cleanup(); }
});

test('parallel tasks fan out, and more than four is refused before any child starts', async () => {
  const f = await fixture({ spawnArgs: { tasks: ['调研 A', '调研 B', '调研 C'] } });
  try {
    await f.runtime.runUnattended(f.bot.id, '分头调研');
    assert.equal(childRequests(f.provider.requests).length, 3, '三个子任务应各发一次模型请求');
    const result = f.spawnResult();
    assert.equal(result.ok, true);
    for (const label of ['子任务 1', '子任务 2', '子任务 3']) assert.match(result.detail, new RegExp(label));
  } finally { await f.cleanup(); }

  const over = await fixture({ spawnArgs: { tasks: ['1', '2', '3', '4', '5'] } });
  try {
    await over.runtime.runUnattended(over.bot.id, '分头调研');
    const result = over.spawnResult();
    assert.equal(result.ok, false, '超出并行上限要直接失败');
    assert.match(`${result.summary}${result.detail ?? ''}`, /最多并行 4/);
    assert.equal(childRequests(over.provider.requests).length, 0, '超限时必须一个子任务都不启动');
  } finally { await over.cleanup(); }
});

test('a failing child is reported through the tool result and the parent survives', async () => {
  const f = await fixture({ childMode: 'error' });
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const result = f.spawnResult();
    assert.ok(result, '父任务仍应拿到工具结果');
    assert.equal(result.ok, false, '子任务全失败时这次派发改判为失败');
    assert.match(`${result.summary}${result.detail ?? ''}`, /1 个未完成/);
    assert.equal(f.store.botConversation(f.bot.id).messages.at(-1).content, '已根据子智能体的结论收尾',
      '子任务失败不得中断父任务，父循环要继续走到收尾');
    assert.equal(f.events.filter((event) => event.type === 'run_end' && !event.ok).length, 0, '子失败不得把父运行标记成失败');
  } finally { await f.cleanup(); }
});

test('续聊：子代理完成后可追问，回答进同一线程并再次返回结论', async () => {
  const f = await fixture();
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const done = f.events.find((event) => event.type === 'subagent' && event.status === 'done');
    const childId = done.children[0].conversationId;
    const before = f.store.getConversation(childId).messages.length;
    const result = await f.runtime.continueSubagent(childId, '补充查一下测试覆盖');
    assert.equal(result.ok, true, result.error);
    assert.match(result.text, /只读调研完成/);
    const after = f.store.getConversation(childId).messages;
    assert.equal(after.length, before + 2, '续聊要追加一问一答');
    assert.match(String(after.at(-2).content), /一次追问/);
    const children = childRequests(f.provider.requests);
    assert.equal(children.length, 2, '初派 + 续聊各一次模型请求');
    // 续聊请求带着子会话自己的历史（初派任务 + 初答），子代理看得到前文。
    assert.ok(children[1].messages.filter((m) => m.role !== 'system').length >= 3);
  } finally { await f.cleanup(); }
});

test('续聊的边界：不存在的会话、非子会话都被拒绝', async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.runtime.continueSubagent('sub_missing', '追问'), /只能续聊子智能体/);
    const own = f.store.botConversation(f.bot.id).id;
    await assert.rejects(() => f.runtime.continueSubagent(own, '追问'), /只能续聊子智能体/);
  } finally { await f.cleanup(); }
});

test('fork：分身带着父对话最近的上下文出发，只读且自成一 thread', async () => {
  const f = await fixture();
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const parent = f.store.botConversation(f.bot.id).id;
    const result = await f.runtime.forkSubagent(parent, '顺着结论查边界情况');
    assert.equal(result.ok, true, result.error);
    assert.match(result.text, /只读调研完成/);
    const forked = f.store.getConversation(result.conversationId);
    assert.ok(forked.subagent, '分身也是子代理会话');
    assert.equal(forked.subagent.parentConversationId, parent);
    const lastChild = childRequests(f.provider.requests).at(-1);
    assert.ok(JSON.stringify(lastChild.messages).includes('帮我调研一下'), '分身必须继承父对话上下文节选');
    assert.ok(f.runtime.listSubagents(parent).some((agent) => agent.conversationId === result.conversationId));
  } finally { await f.cleanup(); }
});

test('tool-jobs：运行中的子代理可见、可单独停止，父任务不受牵连', async () => {
  const f = await fixture({ childDelay: 1500 });
  try {
    const sent = await f.runtime.send({ botId: f.bot.id, text: '帮我调研一下' });
    const deadline = Date.now() + 5000;
    let job;
    while (Date.now() < deadline) {
      job = f.runtime.listJobs().find((item) => item.kind === 'subagent');
      if (job) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(job, '子代理运行期间必须出现在 job_list');
    assert.equal(f.runtime.stop(job.conversationId), true, '可以单独停子代理');
    const quiet = Date.now() + 8000;
    while (f.runtime.isRunning(sent.conversationId) && Date.now() < quiet) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(!f.runtime.isRunning(sent.conversationId), '父任务要在子任务被停后自行走完');
    const result = f.spawnResult();
    assert.equal(result.ok, false, '被停的子任务要如实报失败');
    assert.match(`${result.summary}${result.detail ?? ''}`, /停止|没有产出结论/);
    assert.equal(f.store.botConversation(f.bot.id).messages.at(-1).content, '已根据子智能体的结论收尾', '父任务继续走到收尾');
    assert.equal(f.runtime.listJobs().filter((item) => item.kind === 'subagent').length, 0, '停止后子代理从 jobs 消失');
  } finally { await f.cleanup(); }
});

test('子代理会话落盘：重开 Store 还能取回；列表与同步依然排除它们', async () => {
  const f = await fixture();
  try {
    await f.runtime.runUnattended(f.bot.id, '帮我调研一下');
    const childId = f.events.find((event) => event.type === 'subagent' && event.status === 'done').children[0].conversationId;
    const reopened = new Store(f.dataDir);
    const reloaded = reopened.getConversation(childId);
    assert.ok(reloaded?.subagent, '重启后子会话还在（可续聊的前提）');
    assert.equal(reopened.listConversations().length, 1, '会话列表仍只算用户会话');
    assert.ok(!reopened.syncSnapshot().some((record) => record.id === childId), '同步仍排除子会话');
  } finally { await f.cleanup(); }
});
