import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, CloudHost, Store, schemasFor, toolNamesFor } from '../packages/core/dist/index.js';
import { testProvider } from './test-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'plan-mode-tests', String(Date.now()));
let serial = 0;
const names = (body) => (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
const toolResults = (body) => body.messages.filter((message) => message.role === 'tool');

function fakeProvider(script) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const delta = script(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return { requests, listen: () => new Promise((resolve) => server.listen(0, 'localhost', () => resolve(server.address().port))), close: () => new Promise((resolve) => server.close(resolve)) };
}

const call = (name, args) => ({ tool_calls: [{ index: 0, id: `call-${name}-${Math.random().toString(16).slice(2, 8)}`, function: { name, arguments: JSON.stringify(args) } }] });
const say = (content) => ({ content });

async function fixture(script, options = {}) {
  const provider = fakeProvider(script);
  const port = await provider.listen();
  const dir = path.join(root, String(++serial));
  const store = new Store(dir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], model: 'test-model', tools: ['cloud_exec', 'cloud_read', 'remember', 'spawn_agent'] };
  store.updateSettings({
    bots: [bot],
    providers: [{ ...testProvider({ baseUrl: `http://localhost:${port}/v1`, contextWindowTokens: 128000 }) }],
    cloud: { ...settings.cloud, driver: 'mock' },
  });
  const conversation = store.botConversation(bot.id);
  const events = [];
  const approvals = [];
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({
    store, cloud, emit: (event) => events.push(event),
    requestApproval: async (request) => {
      approvals.push(request);
      return options.approve === undefined ? true : options.approve;
    },
  });
  return { provider, store, bot, conversation, events, approvals, cloud, runtime, cleanup: async () => { cloud.dispose(); await provider.close(); } };
}

test('plan mode strips write tools and offers exactly one way out', () => {
  const writeTools = ['cloud_exec', 'cloud_write', 'desktop_action', 'generate_image', 'remember', 'schedule_task', 'install_mcp', 'install_skill'];
  const bot = { id: 'b', name: 'B', handle: 'b', avatar: {}, providerId: 'p', model: 'm', temperature: 0, systemPrompt: '', approvalPolicy: 'never', tools: ['cloud_exec', 'cloud_read', 'remember', 'spawn_agent'], image: { aspect: 'square' }, wakeOnTask: false, createdAt: 0, updatedAt: 0, workspaceId: 'workspace_cloud' };
  const plan = names({ tools: schemasFor(bot, 'plan') });
  assert.ok(plan.includes('exit_plan_mode'), '计划模式必须给出提交计划的出口');
  assert.ok(plan.includes('cloud_read'), '只读工具要保留，否则没法核实事实');
  // spawn_agent 保留：子代理本身只有只读工具、也拿不到 spawn，等于把"查证"并行化，
  // 计划建在事实之上比建在猜测之上好；真正的写能力一个都不能露。
  assert.ok(plan.includes('spawn_agent'), '只读分身应当在计划模式可用');
  for (const tool of writeTools) assert.ok(!plan.includes(tool), `计划模式不该看到写能力 ${tool}`);
  const execute = names({ tools: schemasFor(bot) });
  assert.ok(execute.includes('cloud_exec') && !execute.includes('exit_plan_mode'), '默认执行模式不受影响');
  assert.equal(toolNamesFor(bot).includes('exit_plan_mode'), false, '出口工具不属于 Bot 的工具清单');
});

test('a plan needs a human yes even for a Bot set to auto-execute', async () => {
  const f = await fixture((body) => {
    if (!toolResults(body).length) return call('exit_plan_mode', { plan: '整理发布流程', steps: ['盘点脚本', '改为一条命令', '写进 README'] });
    return say('计划已收到反馈');
  });
  try {
    f.store.setConversationMode(f.conversation.id, 'plan');
    await f.runtime.send({ botId: f.bot.id, text: '帮我整理发布流程' });
    await f.runtime['runCompletions'].get(f.conversation.id);

    assert.equal(f.approvals.length, 1, '提交计划必须弹一次审批，与 Bot 的自动执行策略无关');
    assert.match(f.approvals[0].summary, /整理发布流程/);
    assert.equal(f.approvals[0].toolName, 'exit_plan_mode');
    const reopened = new Store(f.store.dataDir).getConversation(f.conversation.id);
    assert.equal(reopened.mode, undefined, '批准后要切回执行态（执行态不落字段）');
    assert.deepEqual(reopened.plan.steps, ['盘点脚本', '改为一条命令', '写进 README'], '批准的计划要留档');
    assert.ok(reopened.plan.approvedAt > 0);
  } finally { await f.cleanup(); }
});

test('a declined plan keeps plan mode and returns the refusal instead of executing', async () => {
  const f = await fixture(
    (body) => toolResults(body).length ? say('好的，我先不改') : call('exit_plan_mode', { plan: '直接改配置', steps: ['改 settings'] }),
    { approve: false },
  );
  try {
    f.store.setConversationMode(f.conversation.id, 'plan');
    await f.runtime.send({ botId: f.bot.id, text: '改一下配置' });
    await f.runtime['runCompletions'].get(f.conversation.id);
    const result = f.store.getConversation(f.conversation.id).messages.at(-1).toolResults.find((item) => item.name === 'exit_plan_mode');
    assert.equal(result.ok, false);
    assert.match(result.summary, /未批准/);
    assert.equal(f.store.getConversation(f.conversation.id).mode, 'plan', '拒绝后必须留在计划模式');
    assert.equal(f.store.getConversation(f.conversation.id).plan, undefined, '未批准的计划不得留档');
  } finally { await f.cleanup(); }
});

test('the same run regains write tools right after the plan is approved', async () => {
  const f = await fixture((body) => {
    const results = toolResults(body);
    if (!results.length) return call('exit_plan_mode', { plan: '看看工作区', steps: ['读文件', '跑一条命令'] });
    if (results.length === 1) return call('cloud_exec', { cmd: 'echo approved-and-running' });
    return say('按计划执行完毕');
  });
  try {
    f.store.setConversationMode(f.conversation.id, 'plan');
    await f.runtime.send({ botId: f.bot.id, text: '看看工作区' });
    await f.runtime['runCompletions'].get(f.conversation.id);

    const second = f.provider.requests[1];
    assert.ok(names(second).includes('cloud_exec'), '批准后本轮后续步骤要立刻拿回写工具，不能等下一轮对话');
    const execResult = f.store.getConversation(f.conversation.id).messages.at(-1).toolResults.find((item) => item.name === 'cloud_exec');
    assert.ok(execResult, '写完权限恢复后命令要真的执行');
    assert.equal(f.store.getConversation(f.conversation.id).messages.at(-1).content, '按计划执行完毕');
    assert.ok(f.events.some((event) => event.type === 'log' && /恢复写权限/.test(event.text)));
  } finally { await f.cleanup(); }
});

test('unattended runs downgrade to execute instead of waiting for an approval nobody can give', async () => {
  const f = await fixture((body) => toolResults(body).length ? say('定时任务已执行') : call('cloud_exec', { cmd: 'echo scheduled' }));
  try {
    f.store.setConversationMode(f.conversation.id, 'plan');
    await f.runtime.runUnattended(f.bot.id, '定时跑一下');
    assert.ok(names(f.provider.requests[0]).includes('cloud_exec'), '无人值守必须按执行模式跑，否则会卡在审批上直到超时');
    assert.ok(f.events.some((event) => event.type === 'log' && event.level === 'warn' && /无人值守/.test(event.text)), '降级要明确说出来');
    assert.equal(f.store.getConversation(f.conversation.id).mode, 'plan', '降级只作用于本次，不改会话设置');
  } finally { await f.cleanup(); }
});