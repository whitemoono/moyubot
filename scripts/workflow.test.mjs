import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, CloudHost, Store, runWorkflow } from '../packages/core/dist/index.js';
import { testProvider } from './test-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'workflow-tests', String(Date.now()));
let serial = 0;
const isChild = (body) => String(body.messages.at(-1)?.content ?? '').includes('你是子智能体');
const childTask = (body) => String(body.messages.at(-1)?.content ?? '').split('\n')[0];
const toolNames = (body) => (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
const toolResults = (body) => body.messages.filter((message) => message.role === 'tool');

function fakeProvider(callArgs) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    let delta;
    if (isChild(body)) delta = { content: `结论：${childTask(body)}` };
    else if (!toolResults(body).length) delta = { tool_calls: [{ index: 0, id: 'call-script-1', function: { name: 'run_script', arguments: JSON.stringify(callArgs) } }] };
    else delta = { content: '工作流已完成' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return { requests, listen: () => new Promise((resolve) => server.listen(0, 'localhost', () => resolve(server.address().port))), close: () => new Promise((resolve) => server.close(resolve)) };
}

async function fixture(callArgs, options = {}) {
  const provider = fakeProvider(callArgs);
  const port = await provider.listen();
  const dir = path.join(root, String(++serial));
  const store = new Store(dir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], model: 'test-model', tools: ['run_script', 'cloud_exec', 'cloud_read', 'web_fetch'] };
  store.updateSettings({
    bots: [bot],
    providers: [{ ...testProvider({ baseUrl: `http://localhost:${port}/v1`, contextWindowTokens: 128000 }) }],
    cloud: { ...settings.cloud, driver: 'mock' },
  });
  const conversation = store.botConversation(bot.id);
  if (options.plan) store.setConversationMode(conversation.id, 'plan');
  const events = [];
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({ store, cloud, emit: (event) => events.push(event), requestApproval: async () => true });
  const run = async () => {
    const sent = await runtime.send({ botId: bot.id, text: '编排一下' });
    await runtime['runCompletions'].get(sent.conversationId);
    return store.getConversation(conversation.id).messages.at(-1).toolResults.find((item) => item.name === 'run_script');
  };
  return { provider, store, bot, conversation, events, runtime, run, cleanup: async () => { cloud.dispose(); await provider.close(); } };
}

test('用 run_script 时子代理默认只读，结论能回到父任务', async () => {
  const f = await fixture({ script: 'const a = await agent("读一下 notes.md 的结论"); return { a }' });
  try {
    const result = await f.run();
    assert.equal(result.ok, true, result.summary);
    assert.match(result.detail, /结论：读一下 notes.md 的结论/, '子代理的结论要能回到脚本返回值里');
    assert.match(result.summary, /1 个子代理/);
    assert.match(result.summary, /只读/);
    const child = f.provider.requests.find(isChild);
    const names = toolNames(child);
    assert.ok(names.includes('cloud_read') && !names.includes('cloud_exec'), '默认不该给子代理执行命令的能力');
  } finally { await f.cleanup(); }
});

test('write:true 才给完整工具集，并明确警告审批不再逐步生效', async () => {
  const f = await fixture({ script: 'return await agent("跑一条命令")', write: true });
  try {
    const result = await f.run();
    assert.equal(result.ok, true, result.summary);
    assert.match(result.summary, /完整权限/);
    const child = f.provider.requests.find(isChild);
    assert.ok(toolNames(child).includes('cloud_exec'), 'write:true 时子代理应拿到执行能力');
    assert.ok(toolNames(child).includes('cloud_read'));
    assert.ok(f.events.some((event) => event.type === 'log' && event.level === 'warn' && /完整工具权限/.test(event.text)), '高危权限必须留下明确提示');
  } finally { await f.cleanup(); }
});

test('parallel 并发多个子代理，pipeline 让每项独立走完阶段', async () => {
  const f = await fixture({
    script: `
      phase('粗筛');
      const coarse = await parallel([() => agent('筛 A'), () => agent('筛 B'), () => agent('筛 C')]);
      phase('精读');
      const fine = await pipeline(coarse, async (prev) => agent('精读 ' + prev), async (prev, item, i) => ({ index: i, value: prev }));
      return fine;
    `,
  });
  try {
    const result = await f.run();
    assert.equal(result.ok, true, result.summary);
    assert.match(result.summary, /6 个子代理/);
    assert.match(result.summary, /2 个阶段/);
    assert.match(result.detail, /筛 A/);
    assert.match(result.detail, /精读 结论：筛 C/, 'pipeline 的后续阶段要拿到上一阶段的值');
    assert.match(result.detail, /"index": 0/, '阶段函数的第三个参数是原索引');
  } finally { await f.cleanup(); }
});

test('沙箱里没有进程、文件系统和网络，脚本只能通过 agent 干活', async () => {
  for (const script of ['return process.platform', 'return require("node:fs").readFileSync("x")', 'return fetch("https://example.com")']) {
    const f = await fixture({ script });
    try {
      const result = await f.run();
      assert.equal(result.ok, false, `这个脚本不该跑通：${script}`);
      assert.match(`${result.summary}`, /not defined|工作流执行失败/);
      assert.equal(f.provider.requests.filter(isChild).length, 0);
    } finally { await f.cleanup(); }
  }
});

test('一次工作流的子代理数量与墙钟都设了上限', async () => {
  const overflow = Array.from({ length: 13 }, (_, i) => `await agent('任务 ${i}')`).join(';\n');
  const f = await fixture({ script: `${overflow};` });
  try {
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.match(result.summary, /最多运行 12 个子代理/, '没有上限时脚本可以无限派活');
  } finally { await f.cleanup(); }

  const slow = await runWorkflow(
    { conversationId: 'c', emit: () => {}, runAgent: async () => 'x' },
    { script: 'await new Promise(() => {}); return 1', maxSeconds: 5 },
  ).then(() => 'resolved', (error) => error.message);
  assert.match(String(slow), /上限|中止/, '永不 resolve 的脚本也必须被时间上限掐掉');
});

test('忘了 await 的脚本既不会拖崩宿主，也不会让子代理在工作流结束后偷偷继续干活', async () => {
  const f = await fixture({ script: "agent('没 await 的一次'); return 'done'" });
  try {
    const result = await f.run();
    assert.equal(result.ok, true, result.summary);
    assert.match(result.detail, /done/);
    assert.equal(f.provider.requests.filter(isChild).length, 1, '派出去的子代理必须在返回前收尾');
  } finally { await f.cleanup(); }
});

test('计划模式拒绝带写权限的工作流，只读编排仍可用', async () => {
  const write = await fixture({ script: 'return await agent("改点东西")', write: true }, { plan: true });
  try {
    const result = await write.run();
    assert.equal(result.ok, false);
    assert.match(`${result.summary}`, /计划模式下不能运行带写权限的工作流/);
    assert.equal(write.provider.requests.filter(isChild).length, 0, '拒绝要发生在派活之前');
  } finally { await write.cleanup(); }

  const read = await fixture({ script: 'return await agent("查一下")' }, { plan: true });
  try {
    const result = await read.run();
    assert.equal(result.ok, true, result.summary);
  } finally { await read.cleanup(); }
});