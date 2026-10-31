import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, CloudHost, Store } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'goal-tests', String(Date.now()));
let serial = 0;
const systemText = (body) => body.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
const toolResults = (body) => body.messages.filter((message) => message.role === 'tool');

function fakeProvider(script) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const delta = script(body, requests.length);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return { requests, listen: () => new Promise((resolve) => server.listen(0, 'localhost', () => resolve(server.address().port))), close: () => new Promise((resolve) => server.close(resolve)) };
}

const call = (name, args) => ({ tool_calls: [{ index: 0, id: `call-${name}-${Math.random().toString(16).slice(2, 8)}`, function: { name, arguments: JSON.stringify(args) } }] });
const say = (content) => ({ content });

async function fixture(script) {
  const provider = fakeProvider(script);
  const port = await provider.listen();
  const dir = path.join(root, String(++serial));
  const store = new Store(dir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], model: 'test-model', tools: ['set_goal', 'update_goal', 'cloud_read'] };
  store.updateSettings({
    bots: [bot],
    providers: [{ ...settings.providers[0], baseUrl: `http://localhost:${port}/v1`, contextWindowTokens: 128000 }],
    cloud: { ...settings.cloud, driver: 'mock' },
  });
  const conversation = store.botConversation(bot.id);
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({ store, cloud, emit: () => {}, requestApproval: async () => true });
  const round = async (text) => {
    const sent = await runtime.send({ botId: bot.id, text });
    // runCompletions 在 runLoop 结束后才删，取到 undefined 会提前返回；轮询 isRunning 更可靠
    // （runs 里删除发生在 goal/todo 落库之后）。
    const deadline = Date.now() + 8000;
    while (runtime.isRunning(sent.conversationId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return sent;
  };
  return { provider, store, bot, conversation, cloud, runtime, round, cleanup: async () => { cloud.dispose(); await provider.close(); } };
}

test('a goal recorded in one round is still in the system prompt of the next round', async () => {
  const f = await fixture((body) => {
    if (toolResults(body).length) return say('记下了');
    return call('set_goal', { objective: '把发布脚本收敛成一条命令，验收标准：pnpm release 能一次跑完' });
  });
  try {
    await f.round('帮我盯一下发布脚本这件事');
    assert.equal(f.store.activeGoal(f.conversation.id).status, 'active');

    // 第二轮：让供应商直接回话，检查这一次请求的 system 里带着目标。
    const second = await f.round('接着来');
    const system = systemText(f.provider.requests.at(-1));
    assert.match(system, /当前目标/, '下一轮必须知道还没做完什么');
    assert.match(system, /pnpm release 能一次跑完/, '完成条件也要一起带回去');
    assert.ok(second.conversationId === f.conversation.id);
  } finally { await f.cleanup(); }
});

test('a completed goal stops nagging the model', async () => {
  const f = await fixture((body) => {
    const results = toolResults(body);
    if (!results.length) return call('set_goal', { objective: '核对一遍打包产物' });
    if (results.length === 1) return call('update_goal', { status: 'complete', note: '产物已核对，哈希一致' });
    return say('收工');
  });
  try {
    await f.round('核对打包产物');
    const goal = f.store.listGoals(f.conversation.id)[0];
    assert.equal(goal.status, 'complete');
    assert.match(goal.note, /哈希一致/);
    assert.equal(f.store.activeGoal(f.conversation.id), undefined, '完成的目标不再是活动目标');

    await f.round('还有别的吗');
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)), /当前目标/, '做完的目标不该继续占系统提示');
  } finally { await f.cleanup(); }
});

test('a new goal supersedes the active one instead of silently dropping it', async () => {
  const f = await fixture((body) => toolResults(body).length ? say('好') : call('set_goal', { objective: '先做 A' }));
  try {
    await f.round('做 A');
    const first = f.store.activeGoal(f.conversation.id);
    const second = f.store.setGoal({ conversationId: f.conversation.id, botId: f.bot.id, objective: '改做 B' });
    assert.equal(f.store.activeGoal(f.conversation.id).id, second.id);
    const history = f.store.listGoals(f.conversation.id);
    const superseded = history.find((goal) => goal.id === first.id);
    assert.equal(superseded.status, 'blocked');
    assert.match(superseded.note, /取代/, '旧目标要留下"为什么停"的痕迹，不能凭空消失');
  } finally { await f.cleanup(); }
});

test('goals are conversation-scoped and reject scratch sub-agent threads', async () => {
  const g = await fixture(() => say('x'));
  try {
    g.store.setGoal({ conversationId: g.conversation.id, botId: g.bot.id, objective: '只属于这本会话' });
    assert.equal(g.store.activeGoal(g.conversation.id).objective, '只属于这本会话');
    assert.equal(g.store.activeGoal('conv_other'), undefined, '别的会话不该看到这个目标');
    assert.throws(() => g.store.setGoal({ conversationId: g.conversation.id, botId: g.bot.id, objective: '   ' }), /目标不能为空/);
    assert.throws(() => g.store.setGoal({ conversationId: g.conversation.id, botId: g.bot.id, objective: 'x'.repeat(2001) }), /2000/);
    const scratch = g.store.createSubagentConversation(g.bot.id, 'scratch', 1, g.conversation.id);
    assert.throws(() => g.store.setGoal({ conversationId: scratch.id, botId: g.bot.id, objective: '不许' }), /子智能体/);
    assert.throws(() => g.store.updateGoal('conv_other', { status: 'complete' }), /没有进行中的目标/);
  } finally { await g.cleanup(); }
});

test('验收条件：模型标 complete 必须逐条给证据，缺证据不许完成', async () => {
  const g = await fixture(() => say('x'));
  try {
    const goal = g.store.setGoal({ conversationId: g.conversation.id, botId: g.bot.id, objective: '上线前检查', successCriteria: ['跑通冒烟', '文档已更新'] });
    assert.equal(goal.criteria.length, 2);
    assert.equal(goal.criteria[0].done, false);
    // 无证据 → 拒绝
    assert.throws(() => g.store.updateGoal(g.conversation.id, { status: 'complete' }), /验收条件没有证据/);
    // 部分证据 → 仍拒绝，并点名缺的那条
    assert.throws(
      () => g.store.updateGoal(g.conversation.id, { status: 'complete', evidence: [{ criterion: '跑通冒烟', proof: 'smoke 23:11 通过' }] }),
      /文档已更新/,
    );
    // 全证据 → 放行，逐条落库
    const done = g.store.updateGoal(g.conversation.id, {
      status: 'complete',
      evidence: [{ criterion: '跑通冒烟', proof: 'smoke 通过' }, { criterion: '文档已更新', proof: 'docs/x.md 已提交' }],
    });
    assert.equal(done.status, 'complete');
    assert.ok(done.criteria.every((item) => item.done));
    assert.match(done.criteria[1].evidence, /docs/);
  } finally { await g.cleanup(); }
});

test('验收条件：人类 UI 完成可越权（requireEvidence:false），无条件的旧目标照旧直接完成', async () => {
  const g = await fixture(() => say('x'));
  try {
    g.store.setGoal({ conversationId: g.conversation.id, botId: g.bot.id, objective: '有验收', successCriteria: ['A', 'B'] });
    // 人点的完成：不带证据也能成
    const human = g.store.updateGoal(g.conversation.id, { status: 'complete', note: '我核过了' }, { requireEvidence: false });
    assert.equal(human.status, 'complete');

    // 没定义验收条件的目标：模型无证据也能完成（向后兼容）
    const g2 = await fixture(() => say('x'));
    try {
      g2.store.setGoal({ conversationId: g2.conversation.id, botId: g2.bot.id, objective: '简单目标' });
      const legacy = g2.store.updateGoal(g2.conversation.id, { status: 'complete' });
      assert.equal(legacy.status, 'complete');
    } finally { await g2.cleanup(); }
  } finally { await g.cleanup(); }
});

test('todo 绑定：不给 successCriteria 时，目标验收条件来自当前未完成待办', async () => {
  const f = await fixture((body) => (toolResults(body).length ? say('好') : call('set_goal', { objective: '完成迁移' })));
  try {
    f.store.writeTodos(f.conversation.id, f.bot.id, [
      { content: '迁移数据库', done: true },
      { content: '切换域名', done: false },
      { content: '回归测试', done: false },
    ]);
    await f.round('开始迁移');
    const goal = f.store.activeGoal(f.conversation.id);
    assert.ok(goal.criteria, '目标应带验收条件');
    // 只取未完成项，已完成的不算验收点。
    assert.deepEqual(goal.criteria.map((item) => item.text), ['切换域名', '回归测试']);
  } finally { await f.cleanup(); }
});