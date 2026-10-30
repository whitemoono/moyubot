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
    await runtime['runCompletions'].get(sent.conversationId);
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