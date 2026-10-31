import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime, CloudHost, Store } from '../packages/core/dist/index.js';
import { forceCompact } from '../packages/core/dist/context.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'small-capabilities-tests', String(Date.now()));
let serial = 0;
const systemText = (body) => body.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
const lastUser = (body) => body.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
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

async function fixture(script, options = {}) {
  const provider = fakeProvider(script);
  const port = await provider.listen();
  const dir = path.join(root, String(++serial));
  const workspaceDir = path.join(dir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const store = new Store(dir);
  const settings = store.getSettings();
  const bot = { ...settings.bots[0], model: 'test-model', tools: ['todo_write', 'ask_user', 'cloud_read'] };
  store.updateSettings({
    bots: [bot],
    providers: [{ ...settings.providers[0], baseUrl: `http://localhost:${port}/v1`, contextWindowTokens: 128000 }],
    cloud: { ...settings.cloud, driver: 'mock', workspaceDir },
  });
  const conversation = store.botConversation(bot.id);
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({
    store, cloud, emit: () => {},
    requestApproval: async () => true,
    requestAnswer: async () => options.answer ?? '测试回答',
  });
  const round = async (text) => {
    const sent = await runtime.send({ botId: bot.id, text });
    await runtime['runCompletions'].get(sent.conversationId);
    return sent;
  };
  return { provider, store, bot, conversation, workspaceDir, cloud, runtime, round, cleanup: async () => { cloud.dispose(); await provider.close(); } };
}

test('小窗口 + 全部工具：工具描述会按阶梯瘦身，绝不因工具列表本身撑爆窗口', async () => {
  const { prepareContext } = await import('../packages/core/dist/context.js');
  const { TOOL_SCHEMAS } = await import('../packages/core/dist/index.js');
  const est = (s) => { let a = 0, o = 0; for (const c of s) c.codePointAt(0) <= 127 ? a++ : o++; return Math.ceil(a / 3 + o * 2); };
  const fullOverhead = est(JSON.stringify(TOOL_SCHEMAS));
  const provider = {
    kind: 'openai',
    async chat(args, handlers) {
      const isCompact = /压缩同一个 Bot/.test(args.system || '');
      handlers.onText(isCompact ? JSON.stringify({ summary: '项目讨论已摘要', memories: [] }) : '好的');
      return { finishReason: 'stop' };
    },
  };
  const f = await fixture(() => say('好'));
  try {
    assert.ok(TOOL_SCHEMAS.length >= 18, '本用例依赖工具数量足够多来撑小窗口');
    f.store.updateSettings({ providers: [{ ...f.store.getSettings().providers[0], contextWindowTokens: 8192 }] });
    for (let n = 0; n < 14; n++) {
      f.store.appendMessage(f.conversation.id, { id: `u-${n}`, role: 'user', content: `历史问题${n} ${'这是一段较长的中文用来占据上下文窗口。'.repeat(6)}`, createdAt: Date.now() - 1000 + n });
      f.store.appendMessage(f.conversation.id, { id: `a-${n}`, role: 'assistant', content: `回答${n} ${'助手也输出了同样长度的一段内容来填充窗口。'.repeat(6)}`, createdAt: Date.now() - 1000 + n + 0.1 });
    }
    const last = f.store.getConversation(f.conversation.id).messages.at(-1);
    const result = await prepareContext({
      store: f.store, bot: f.bot, provider, conversation: f.store.getConversation(f.conversation.id), userMessageId: last.id,
      live: [{ role: 'user', content: '现在总结' }], system: '你是助手', tools: TOOL_SCHEMAS, signal: new AbortController().signal, emit: () => {},
    });
    assert.ok(Array.isArray(result.tools), 'prepareContext 必须返回工具列表');
    assert.equal(result.tools.length, TOOL_SCHEMAS.length, '工具不能被整条丢弃，只能瘦身描述');
    const slimOverhead = est(JSON.stringify(result.tools));
    assert.ok(slimOverhead < fullOverhead, `8K 窗口 + ${TOOL_SCHEMAS.length} 个工具应触发描述瘦身：full=${fullOverhead} slim=${slimOverhead}`);
    assert.ok(slimOverhead < 4340, `瘦身后开销应显著下降，实际 ${slimOverhead}`);
  } finally { await f.cleanup(); }
});

test('agent-instructions：工作区 AGENTS.md 注入系统提示，改动后按 mtime 刷新', async () => {
  const f = await fixture(() => say('好'));
  try {
    fs.writeFileSync(path.join(f.workspaceDir, 'AGENTS.md'), '第一条约定：回复前先检查 TODO 注释。');
    await f.round('聊聊');
    assert.match(systemText(f.provider.requests.at(-1)), /工作区指令/, '系统提示里要出现工作区指令块');
    assert.match(systemText(f.provider.requests.at(-1)), /第一条约定/, 'AGENTS.md 内容要真的进去');

    fs.writeFileSync(path.join(f.workspaceDir, 'AGENTS.md'), '第二条约定：中文优先。');
    await f.round('再来');
    assert.match(systemText(f.provider.requests.at(-1)), /第二条约定/, '文件变了下一轮就要读到新内容');
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)), /第一条约定/, '旧内容不该残留（mtime 缓存要刷新）');

    fs.unlinkSync(path.join(f.workspaceDir, 'AGENTS.md'));
    await f.round('还来');
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)), /工作区指令/, '文件删了就该消失');
  } finally { await f.cleanup(); }
});

test('time-context：第二轮起注入“距上一条消息”', async () => {
  const f = await fixture(() => say('好'));
  try {
    await f.round('第一句');
    const t1 = lastUser(f.provider.requests.at(-1));
    assert.doesNotMatch(t1, /距上一条消息/, '第一轮没有上一条消息');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await f.round('第二句');
    assert.match(lastUser(f.provider.requests.at(-1)), /距上一条消息/, '第二轮要有时间间隔');
  } finally { await f.cleanup(); }
});

test('todo_write：整体替换，做完勾掉，系统提示带着当前清单', async () => {
  const f = await fixture((body) => {
    const results = toolResults(body);
    if (!results.length) return call('todo_write', { todos: [{ content: '搭脚手架', done: true }, { content: '写测试', done: false }, { content: '提交', done: false }] });
    if (results.length === 1) return call('todo_write', { todos: [{ content: '搭脚手架', done: true }, { content: '写测试', done: true }] });
    return say('好');
  });
  try {
    await f.round('列出任务');
    // 一次 send 会循环到模型不再调工具：3 项 → 被第二次 todo_write 整体替换成 2 项。
    const list = f.store.listTodos(f.conversation.id);
    assert.equal(list.items.length, 2, '整体替换，不是追加');
    assert.ok(list.items.every((item) => item.done), '剩下两件都标完了');
    assert.match(systemText(f.provider.requests.at(-1)), /任务清单/, '系统提示要带着当前清单');
    assert.match(systemText(f.provider.requests.at(-1)), /\[x\] 写测试/, '清单内容要能进模型视野');
  } finally { await f.cleanup(); }
});

test('ask_user：拿到用户文字回答；被跳过时明确失败而不是臆造', async () => {
  const answered = await fixture((body) => toolResults(body).length ? say('按你说的来') : call('ask_user', { question: '用 A 还是 B？我推荐 A' }), { answer: '用 A' });
  try {
    await answered.round('决策');
    const result = answered.store.getConversation(answered.conversation.id).messages.at(-1).toolResults.find((item) => item.name === 'ask_user');
    assert.equal(result.ok, true);
    assert.match(result.summary, /用户已回答：用 A/);
    assert.equal(result.detail, '用 A');
  } finally { await answered.cleanup(); }

  const skipped = await fixture((body) => toolResults(body).length ? say('继续') : call('ask_user', { question: '你定' }), { answer: '  ' });
  try {
    await skipped.round('决策');
    const result = skipped.store.getConversation(skipped.conversation.id).messages.at(-1).toolResults.find((item) => item.name === 'ask_user');
    assert.equal(result.ok, false);
    assert.match(result.summary, /跳过了/);
  } finally { await skipped.cleanup(); }
});

test('command-compact：forceCompact 把历史并入摘要并持久化，历史太短会拒绝', async () => {
  const f = await fixture(() => say('好'));
  try {
    // 太短：拒绝
    await f.round('就一句');
    const compactProvider = { kind: 'openai', async chat(args, handlers) {
      assert.deepEqual(args.tools, [], '压缩请求不允许工具');
      handlers.onText(JSON.stringify({ summary: '历史摘要：项目在推进', memories: ['用户偏好中文'] }));
      return { finishReason: 'stop' };
    } };
    await assert.rejects(
      () => forceCompact({ store: f.store, bot: f.bot, conversation: f.conversation, provider: compactProvider, signal: new AbortController().signal, emit: () => {} }),
      /还没有可压缩的历史|历史还很短/,
      '没料可压时不该浪费一次模型调用',
    );

    // 补足历史后压缩
    for (let n = 0; n < 6; n++) {
      f.store.appendMessage(f.conversation.id, { id: `user-${n}`, role: 'user', content: '这是一个比较长的讨论点，用来凑够历史长度，保证压缩判定能通过。'.repeat(10), createdAt: n * 100 });
      f.store.appendMessage(f.conversation.id, { id: `assistant-${n}`, role: 'assistant', content: '对应的回答内容，同样反复出现以增加体积。'.repeat(10), createdAt: n * 100 + 1 });
    }
    // 先塞一个"压缩前"的大快照，验证压缩会把它改小并落盘
    f.store.recordContextUsage(f.conversation.id, { systemTokens: 120, toolTokens: 300, historyTokens: 6000, windowTokens: 8000, reserveTokens: 1000 });
    const context = await forceCompact({ store: f.store, bot: f.bot, conversation: f.conversation, provider: compactProvider, signal: new AbortController().signal, emit: () => {}, system: '你是助手', tools: [] });
    assert.match(context.summary, /项目在推进/);
    assert.ok(context.throughMessageId);
    assert.ok(context.compactedMessages > 0, '要记录压掉了多少条');
    const shrunk = f.store.getContextUsage(f.conversation.id);
    assert.ok(shrunk.historyTokens < 6000, `压缩后历史段应变小，实际 ${shrunk.historyTokens}`);
    const persistedUsage = new Store(f.store.dataDir).getContextUsage(f.conversation.id);
    assert.equal(persistedUsage.historyTokens, shrunk.historyTokens, '三段快照要落盘，重启后读得到');
    const reopened = new Store(f.store.dataDir).getConversation(f.conversation.id);
    assert.equal(reopened.context.summary, context.summary, '摘要要落盘，重启后还在');
    assert.ok(f.store.listMemories(f.bot.id).some((memory) => memory.text.includes('中文')), '压缩提炼的记忆要进长期记忆');
  } finally { await f.cleanup(); }
});