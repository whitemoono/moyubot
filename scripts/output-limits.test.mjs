import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { AgentRuntime, CloudHost, Store } from '../packages/core/dist/index.js';
import { outputBudget, contextWindow, prepareContext, messagesFor } from '../packages/core/dist/context.js';
import { TaskOutputBudget, validateModelSettings, validateGeneration } from '../packages/core/dist/generation.js';
import { trackedChat, createChatProvider } from '../packages/core/dist/index.js';
import { OutputLimitError } from '../packages/core/dist/providers/types.js';

const root = path.resolve('.work/output-limit-tests', String(Date.now()));
let serial = 0;
async function fixture(respond, maxSteps) {
  const store = new Store(path.join(root, String(++serial)));
  const requests = [], events = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const chunk of respond(body, requests.length)) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  store.updateSettings({ providers: [{ ...store.settings.providers[0], baseUrl: `http://localhost:${server.address().port}/v1` }], cloud: { driver: 'mock' } });
  const bot = store.upsertBot({ ...store.settings.bots[0], tools: ['remember'] });
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '' });
  const runtime = new AgentRuntime({ store, cloud, emit: event => events.push(event), requestApproval: async () => true, maxSteps });
  return { store, bot, runtime, requests, events, close: async () => { cloud.dispose(); await new Promise(resolve => server.close(resolve)); } };
}
const chunk = (delta, finish_reason) => ({ choices: [{ delta, finish_reason }] });
const memoryCall = (id, args) => chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name: 'remember', arguments: args } }] }, 'tool_calls');

test('reasoning output exhaustion retries only the current model request and retains completed tools', async () => {
  const f = await fixture((body, n) => n === 1 ? [memoryCall('saved', '{"text":"原工具调用只执行一次"}')]
    : n === 2 ? [chunk({ reasoning_content: '思考占满额度' }), chunk({ tool_calls: [{ index: 0, id: 'truncated', function: { name: 'remember', arguments: '{"text":"不完整' } }] }, 'length')]
    : [chunk({ content: '已完成，工具没有重复执行。' }, 'stop')]);
  try {
    await f.runtime.runUnattended(f.bot.id, '测试完成工具后的思考额度恢复');
    assert.equal(f.requests.length, 3);
    assert.ok(f.requests[2].max_tokens > f.requests[1].max_tokens);
    assert.deepEqual(f.requests[2].messages.slice(0, -1), f.requests[1].messages);
    assert.match(f.requests[2].messages.at(-1).content, /未执行/);
    assert.equal(f.store.listMemories(f.bot.id).length, 1);
    const reply = f.store.botConversation(f.bot.id).messages.at(-1);
    assert.equal(reply.error, undefined);
    assert.equal(reply.toolCalls.length, 1);
    assert.match(reply.content, /已完成/);
  } finally { await f.close(); }
});

test('repeated reasoning exhaustion fails visibly instead of accepting an empty successful reply', async () => {
  const f = await fixture(() => [chunk({ reasoning_content: '仅思考，无正文' }, 'length')]);
  try {
    await assert.rejects(f.runtime.runUnattended(f.bot.id, '请继续工作'), /输出额度/);
    assert.equal(f.requests.length, 2);
    const reply = f.store.botConversation(f.bot.id).messages.at(-1);
    assert.match(reply.content, /输出额度/);
    assert.notEqual(reply.content, '（空回复）');
    assert.equal(f.events.findLast(e => e.type === 'run_end').ok, false);
  } finally { await f.close(); }
});

test('partial visible output resumes and truncated tool arguments never execute', async () => {
  const f = await fixture((_body, n) => n === 1 ? [chunk({ content: '页面还没有写完' }), chunk({ tool_calls: [{ index: 0, id: 'partial', function: { name: 'remember', arguments: '{"text":"截断' } }] }, 'length')] : [chunk({ content: '，现在已继续完成。' }, 'stop')]);
  try {
    await f.runtime.runUnattended(f.bot.id, '请生成页面');
    assert.equal(f.requests.length, 2);
    assert.equal(f.store.listMemories(f.bot.id).length, 0);
    const reply = f.store.botConversation(f.bot.id).messages.at(-1);
    assert.equal(reply.content, '页面还没有写完，现在已继续完成。');
    assert.equal(reply.error, undefined);
    assert.match(f.requests[1].messages.at(-1).content, /未执行/);
  } finally { await f.close(); }
});

test('tool-step exhaustion reports unfinished work and retains successful results', async () => {
  const f = await fixture(() => [memoryCall('step-limit', '{"text":"已执行但尚未总结"}')], 1);
  try {
    await assert.rejects(f.runtime.runUnattended(f.bot.id, '执行任务'), /轮数上限/);
    assert.equal(f.requests.length, 1);
    const reply = f.store.botConversation(f.bot.id).messages.at(-1);
    assert.match(reply.error, /尚未确认完成/);
    assert.equal(reply.toolResults[0].ok, true);
  } finally { await f.close(); }
});

test('model-specific limits persist independently; Bot overrides are capped by model output', () => {
  const store = new Store(path.join(root, String(++serial)));
  const provider = { ...store.settings.providers[0], modelSettings: {
    'large-model': { contextWindowTokens: 262144, maxOutputTokens: 65536, reasoningControl: 'openai-effort', reasoningEffort: 'high' },
    'small-model': { contextWindowTokens: 16384, maxOutputTokens: 2048 },
  } };
  store.updateSettings({ providers: [provider] });
  const bot = { ...store.settings.bots[0], model: 'large-model' };
  assert.equal(contextWindow(store, bot), 262144);
  assert.equal(outputBudget(store, bot), 65536);
  assert.equal(outputBudget(store, { ...bot, generation: { maxOutputTokens: 32768 } }), 32768);
  assert.equal(outputBudget(store, { ...bot, generation: { maxOutputTokens: 131072 } }), 65536);
  assert.equal(outputBudget(store, { ...bot, model: 'small-model' }), 2048);
  assert.equal(outputBudget(store, { ...bot, model: 'unknown' }), 8192);
  assert.deepEqual(new Store(store.dataDir).settings.providers[0].modelSettings, provider.modelSettings);
  assert.throws(() => validateModelSettings({ contextWindowTokens: 8192, maxOutputTokens: 8192 }, 'openai'), /预留/);
  assert.throws(() => validateModelSettings({ reasoningControl: 'anthropic-budget' }, 'openai'), /不匹配/);
  assert.throws(() => validateGeneration({ maxSteps: 0 }), /任务轮数/);
});

test('manual output limit is strict and Bot thinking overrides reach the request', async () => {
  const f = await fixture(() => [chunk({ content: '已按配置回答' }, 'stop')]);
  try {
    const provider = f.store.settings.providers[0];
    f.store.updateSettings({ providers: [{ ...provider, modelSettings: { [f.bot.model]: { contextWindowTokens: 131072, maxOutputTokens: 32768, reasoningControl: 'openai-effort', reasoningEffort: 'low', outputTokenParameter: 'max_completion_tokens' } } }] });
    f.store.upsertBot({ ...f.bot, generation: { maxOutputTokens: 16384, reasoningEffort: 'high' } });
    await f.runtime.runUnattended(f.bot.id, '检查配置');
    assert.equal(f.requests[0].max_completion_tokens, 16384);
    assert.equal(f.requests[0].max_tokens, undefined);
    assert.equal(f.requests[0].reasoning_effort, 'high');
  } finally { await f.close(); }
  const strict = await fixture(() => [chunk({ reasoning_content: '额度不够' }, 'length')]);
  try {
    strict.store.upsertBot({ ...strict.bot, generation: { maxOutputTokens: 4096 } });
    await assert.rejects(strict.runtime.runUnattended(strict.bot.id, '检查严格上限'), /输出额度/);
    assert.equal(strict.requests.length, 1);
  } finally { await strict.close(); }
});

test('task budget includes failed requests and compaction and stops before replaying tools', async () => {
  const f = await fixture(() => [memoryCall('budget-call', '{"text":"只执行一次"}')]);
  try {
    f.store.upsertBot({ ...f.bot, generation: { maxTaskOutputTokens: 1024 } });
    await assert.rejects(f.runtime.runUnattended(f.bot.id, '执行到预算用尽'), /累计生成额度/);
    assert.equal(f.requests[0].max_tokens, 1024);
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.listMemories(f.bot.id).length, 1);
  } finally { await f.close(); }
  const store = new Store(path.join(root, String(++serial)));
  const bot = store.settings.bots[0], conversation = store.botConversation(bot.id);
  const budget = new TaskOutputBudget(1024);
  const provider = { kind: 'openai', async chat(args, handlers) { handlers.onUsage({ completionTokens: 800 }); throw new Error('failed-stream'); } };
  const args = { model: bot.model, system: '', messages: [], tools: [], temperature: 0, maxTokens: 1024 };
  await assert.rejects(trackedChat(store, bot, conversation.id, 'compaction', provider, args, { onText() {}, onToolCall() {} }, undefined, budget), /failed-stream/);
  assert.equal(budget.used, 800);
  await assert.rejects(trackedChat(store, bot, conversation.id, 'chat', provider, args, { onText() {}, onToolCall() {} }, undefined, budget), /累计生成额度/);
});

test('reasoning parameters are opt-in and mapped to Anthropic and Gemini protocol bodies', async () => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); received.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url.includes('/messages')) {
      const events = [
        { type: 'message_start', message: { id: 'msg-test', usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ];
      res.end(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''));
    }
    else res.end('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }) + '\n\n');
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const args = { model: 'test-model', system: '', messages: [{ role: 'user', content: 'hello' }], tools: [], temperature: .7, maxTokens: 8192 };
  const handlers = { onText() {}, onToolCall() {} };
  try {
    for (const kind of ['anthropic', 'gemini']) {
      const provider = createChatProvider({ id: kind, name: kind, kind, baseUrl: `http://localhost:${server.address().port}`, models: [], defaultModel: 'test-model', createdAt: 0 }, 'fixture-key');
      await provider.chat(args, handlers);
      await provider.chat({ ...args, reasoning: { reasoningControl: kind === 'anthropic' ? 'anthropic-budget' : 'gemini-budget', thinkingBudgetTokens: 2048 } }, handlers);
    }
    assert.equal(received[0].thinking, undefined);
    assert.deepEqual(received[1].thinking, { type: 'enabled', budget_tokens: 2048, display: 'summarized' });
    assert.equal(received[1].temperature, undefined);
    assert.equal(received[2].generationConfig.thinkingConfig, undefined);
    assert.deepEqual(received[3].generationConfig.thinkingConfig, { includeThoughts: true, thinkingBudget: 2048 });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('compaction honors model output ceiling and output parameter without enabling thinking', async () => {
  const store = new Store(path.join(root, String(++serial)));
  const bot = store.settings.bots[0];
  const settings = Object.fromEntries([['contextWindowTokens', 4096], ['maxOutputTokens', 512], ['outputTokenParameter', 'max_completion_tokens']]);
  store.updateSettings({ providers: [{ ...store.settings.providers[0], modelSettings: { [bot.model]: settings } }] });
  const conversation = store.botConversation(bot.id);
  store.appendMessage(conversation.id, { id: 'old', role: 'user', content: '项目历史。'.repeat(900), createdAt: 1 });
  store.appendMessage(conversation.id, { id: 'current', role: 'user', content: '继续', createdAt: 2 });
  const requests = [];
  const provider = { kind: 'openai', async chat(args, handlers) {
    requests.push(args);
    handlers.onText(JSON.stringify({ summary: '继续项目。', memories: [] }));
    return { finishReason: 'stop', usage: { completionTokens: 10 } };
  } };
  const budget = new TaskOutputBudget(2048);
  await prepareContext({ store, bot, provider, conversation, userMessageId: 'current', live: [{ role: 'user', content: '继续' }], system: '中文助手', tools: [], signal: new AbortController().signal, emit() {}, taskBudget: budget });
  assert.ok(requests.length > 0);
  assert.ok(requests.every(args => args.maxTokens >= 256 && args.maxTokens <= 512 && Object.values(args.reasoning).includes('max_completion_tokens') && !args.reasoning.reasoningControl));
  assert.equal(budget.used, requests.length * 10);
});

test('reasoning-heavy compaction grows its budget and commits only the complete replacement summary', async () => {
  const store = new Store(path.join(root, String(++serial)));
  const bot = { ...store.settings.bots[0], model: 'vendor/reasoning-model' };
  store.updateSettings({ bots: [bot], providers: [{ ...store.settings.providers[0], contextWindowTokens: 32768 }] });
  const conversation = store.botConversation(bot.id);
  store.appendMessage(conversation.id, { id: 'long-history', role: 'user', content: '历史资料'.repeat(5000), createdAt: 1 });
  store.appendMessage(conversation.id, { id: 'hello-now', role: 'user', content: '你好', createdAt: 2 });
  const requests = [], events = [], budget = new TaskOutputBudget(131072);
  const provider = { kind: 'openai', async chat(args, handlers) {
    requests.push(args);
    if (requests.length === 1) {
      handlers.onReasoning?.('仅思考，没有完整摘要'); handlers.onText('{"summary":');
      handlers.onUsage({ completionTokens: args.maxTokens });
      throw new OutputLimitError({ text: '{"summary":', reasoning: '仅思考', tools: [] });
    }
    handlers.onText(JSON.stringify({ summary: '保留的历史信息', memories: ['已完成摘要'] }));
    handlers.onUsage({ completionTokens: 200 });
    return { finishReason: 'stop' };
  } };
  const result = await prepareContext({ store, bot, provider, conversation, userMessageId: 'hello-now', live: [{ role: 'user', content: '你好' }],
    system: '中文助手', tools: [], signal: new AbortController().signal, emit: event => events.push(event), taskBudget: budget });
  assert.equal(requests[0].maxTokens, 8192);
  assert.equal(requests[1].maxTokens, 16384);
  assert.deepEqual(requests[0].tools, []); assert.deepEqual(requests[1].tools, []);
  assert.ok(requests[1].messages[0].content.includes('历史资料'));
  assert.equal(conversation.context.summary, '保留的历史信息');
  assert.equal(result.messages.at(-1).content, '你好');
  assert.equal(budget.used, 8192 + 200 * (requests.length - 1));
  assert.ok(events.some(event => event.type === 'log' && /历史摘要/.test(event.text)));
  const usage = fs.readFileSync(path.join(store.dataDir, 'usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(usage[0].purpose, 'compaction'); assert.equal(usage[0].status, 'error');
  assert.equal(usage[1].status, 'complete');
});

test('compaction respects manual caps and reports its own failure without advancing history', async () => {
  const store = new Store(path.join(root, String(++serial)));
  const bot = { ...store.settings.bots[0], generation: { maxOutputTokens: 2048 } };
  store.updateSettings({ bots: [bot], providers: [{ ...store.settings.providers[0], contextWindowTokens: 32768 }] });
  const conversation = store.botConversation(bot.id);
  store.appendMessage(conversation.id, { id: 'long', role: 'user', content: '旧资料'.repeat(6000), createdAt: 1 });
  store.appendMessage(conversation.id, { id: 'current', role: 'user', content: '你好', createdAt: 2 });
  let calls = 0;
  await assert.rejects(prepareContext({ store, bot, conversation, userMessageId: 'current', live: [{ role: 'user', content: '你好' }], system: '助手', tools: [],
    signal: new AbortController().signal, emit() {}, taskBudget: new TaskOutputBudget(131072),
    provider: { kind: 'openai', async chat(args, handlers) {
      calls++; assert.equal(args.maxTokens, 2048); handlers.onUsage({ completionTokens: 2048 });
      throw new OutputLimitError({ text: '', reasoning: '仅思考', tools: [] });
    } } }), /历史摘要压缩未完成.*2048/);
  assert.equal(calls, 1); assert.equal(conversation.context, undefined);
  assert.equal(store.listMemories(bot.id).length, 0); assert.equal(conversation.messages.length, 2);
});

test('runtime continues a long tool task after compaction without repeating successful actions', async () => {
  const f = await fixture(() => []);
  let steps = 0, summaries = 0;
  try {
    f.store.updateSettings({ providers: [{ ...f.store.settings.providers[0], contextWindowTokens: 8192 }] });
    const original = f.runtime.providerFor.bind(f.runtime);
    f.runtime.providerFor = bot => {
      const result = original(bot);
      result.provider.chat = async (args, handlers) => {
        if (args.system.includes('你负责压缩')) {
          summaries++;
          handlers.onText(JSON.stringify({ summary: '已完成的记忆写入均成功，按最近结果继续，不能重复执行。', memories: [] }));
        } else if (steps < 8) {
          steps++;
          handlers.onReasoning('分析当前步骤。'.repeat(180));
          handlers.onToolCall({ id: `long-step-${steps}`, name: 'remember', arguments: { text: `成功动作-${steps}` } });
        } else handlers.onText('八步任务已全部完成。');
        return { finishReason: 'stop', usage: { completionTokens: 100 } };
      };
      return result;
    };
    await f.runtime.runUnattended(f.bot.id, '完成八步任务');
    const reply = f.store.botConversation(f.bot.id).messages.at(-1);
    assert.equal(reply.error, undefined); assert.match(reply.content, /全部完成/);
    assert.equal(reply.toolResults.length, 8); assert.equal(f.store.listMemories(f.bot.id).length, 8);
    assert.ok(summaries > 0 && summaries < steps, 'Compaction must leave room for several subsequent steps');
    assert.equal(new Set(reply.toolResults.map(result => result.id)).size, 8);
  } finally { await f.close(); }
});

test('task deadline aborts an in-flight model request and retains prior successful tool results', async () => {
  const f = await fixture((_body, n) => n === 1 ? [memoryCall('before-deadline', '{"text":"超时前已完成"}')] : []);
  const original = globalThis.setTimeout;
  try {
    f.store.upsertBot({ ...f.bot, generation: { maxDurationSeconds: 30 } });
    const respond = f.runtime.providerFor.bind(f.runtime);
    f.runtime.providerFor = bot => {
      const result = respond(bot), chat = result.provider.chat.bind(result.provider);
      let calls = 0;
      result.provider.chat = async (args, handlers) => {
        if (++calls === 1) return chat(args, handlers);
        return new Promise((_resolve, reject) => {
          const canceled = () => reject(args.signal.reason);
          args.signal.addEventListener('abort', canceled, { once: true });
          if (args.signal.aborted) canceled();
        });
      };
      return result;
    };
    // Shorten only the task deadline; no real-time 30-second test delay.
    globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 30000 ? 100 : ms, ...args);
    await assert.rejects(f.runtime.runUnattended(f.bot.id, '测试超时'), /任务最长时间/);
    assert.equal(f.store.listMemories(f.bot.id).length, 1);
    assert.equal(f.store.botConversation(f.bot.id).messages.at(-1).toolResults[0].ok, true);
  } finally { globalThis.setTimeout = original; await f.close(); }
});

test('DeepSeek model profile reserves real reasoning capacity; tool thinking replays per turn and survives reload', async () => {
  const f = await fixture((_body, n) => n === 1 ? [chunk({ reasoning_content: '第一步思考状态' }), memoryCall('first', '{"text":"第一条事实"}')]
    : n === 2 ? [chunk({ reasoning_content: '第二步基于前一步继续' }), memoryCall('second', '{"text":"第二条事实"}')]
    : [chunk({ reasoning_content: '结果检查完成' }), chunk({ content: '完成' }, 'stop')]);
  try {
    const bot = f.store.upsertBot({ ...f.bot, model: 'deepseek-flash' });
    // This fixture reports real usage so the conservative unknown-usage policy
    // does not charge the entire 64K reservation for each tiny tool response.
    const providerFor = f.runtime.providerFor.bind(f.runtime);
    f.runtime.providerFor = bot => {
      const result = providerFor(bot), chat = result.provider.chat.bind(result.provider);
      result.provider.chat = async (args, handlers) => { const outcome = await chat(args, handlers); return { ...outcome, usage: { promptTokens: 100, completionTokens: 100 } }; };
      return result;
    };
    assert.equal(contextWindow(f.store, bot), 1000000);
    assert.equal(outputBudget(f.store, bot), 65536);
    await f.runtime.runUnattended(bot.id, '运行工具循环');
    assert.equal(f.requests[0].max_tokens, 65536);
    const thinking = f.requests[2].messages.filter(message => message.role === 'assistant').map(message => message.reasoning_content);
    assert.deepEqual(thinking, ['第一步思考状态', '第二步基于前一步继续']);
    const reopened = new Store(f.store.dataDir);
    const reply = reopened.botConversation(bot.id).messages.at(-1);
    assert.equal(reply.modelTurns.length, 3);
    const history = messagesFor([reply]);
    assert.deepEqual(history.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    assert.equal(history[2].reasoning, '第二步基于前一步继续');
    const other = { ...bot, model: 'unknown' };
    assert.equal(contextWindow(f.store, other), 32768);
  } finally { await f.close(); }
});

test('increased output stays in effect across tool rounds; manual ceiling recovers without raising it', async () => {
  for (const strict of [false, true]) {
    const f = await fixture((_body, n) => n === 1 ? [chunk({ tool_calls: [{ index: 0, id: 'partial', function: { name: 'remember', arguments: '{"text":"截断' } }] }, 'length')]
      : n === 2 ? [memoryCall('complete', '{"text":"重新生成的完整调用"}')] : [chunk({ content: '完成' }, 'stop')]);
    try {
      if (strict) f.store.upsertBot({ ...f.bot, generation: { maxOutputTokens: 4096 } });
      await f.runtime.runUnattended(f.bot.id, '恢复完整工具调用');
      assert.deepEqual(f.requests.map(body => body.max_tokens), strict ? [4096, 4096, 4096] : [8192, 16384, 16384]);
      assert.equal(f.store.listMemories(f.bot.id).length, 1);
      assert.equal(f.store.botConversation(f.bot.id).messages.at(-1).toolCalls.length, 1);
    } finally { await f.close(); }
  }
});

test('persistent truncated tool calls stop after a bounded recovery count without executing partial calls', async () => {
  const f = await fixture(() => [chunk({ tool_calls: [{ index: 0, id: 'partial', function: { name: 'remember', arguments: '{"text":' } }] }, 'length')]);
  try {
    await assert.rejects(f.runtime.runUnattended(f.bot.id, '持续截断'), /自动恢复未能完成/);
    assert.equal(f.requests.length, 4);
    assert.equal(f.store.listMemories(f.bot.id).length, 0);
  } finally { await f.close(); }
});
