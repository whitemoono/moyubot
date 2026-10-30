import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Store, UsageLedger, normalizeUsage, trackedChat, modelUsageKey, CloudHost, AgentRuntime, createChatProvider } from '../packages/core/dist/index.js';
import { prepareContext } from '../packages/core/dist/context.js';

const root = path.resolve('.work', 'usage-tests', String(Date.now()));
let serial = 0;
function fixture() { const dir = path.join(root, String(++serial)); fs.mkdirSync(dir, { recursive: true }); const store = new Store(dir); return { dir, store, bot: store.settings.bots[0], conversation: store.botConversation(store.settings.bots[0].id) }; }
const query = (extra = {}) => ({ start: Date.now() - 86400000, end: Date.now() + 86400000, interval: 'day', ...extra });
const record = (id, time, extra = {}) => ({ id, createdAt: time, botId: 'a', botName: 'Atlas', providerId: 'p', providerName: 'Provider', model: 'model', conversationId: 'c', purpose: 'chat', status: 'complete', usage: { promptTokens: 100, completionTokens: 25, cachedTokens: 50 }, ...extra });

test('ledger persists exact calls, keeps providers distinct, filters exclusive ranges and recovers interrupted writes', () => {
  const { dir, store } = fixture();
  const start = new Date(2026, 9, 20).getTime(), end = new Date(2026, 9, 22).getTime();
  store.usage.append(record('1', start)); store.usage.append(record('1', start));
  store.usage.append(record('2', start + 1000, { botId: 'b', botName: 'Nova', providerId: 'relay', purpose: 'compaction' }));
  store.usage.append(record('3', start + 86400000, { usage: undefined, status: 'error' }));
  store.usage.append(record('end', end));
  const range = { start, end, interval: 'day' };
  const report = store.usage.query(range);
  assert.equal(report.totals.calls, 3); assert.equal(report.totals.totalTokens, 250);
  assert.equal(report.totals.reportedCalls, 2); assert.equal(report.totals.cacheInputTokens, 200);
  assert.equal(report.totals.cachedTokens, 100); assert.equal(report.totals.compactionCalls, 1);
  assert.equal(report.models.length, 2); assert.deepEqual(report.buckets.map((b) => b.totalTokens), [250, 0]);
  assert.equal(store.usage.query({ ...range, modelKey: modelUsageKey('relay', 'model') }).totals.calls, 1);
  assert.equal(store.usage.query({ ...range, botId: 'a' }).totals.calls, 2);
  assert.equal(store.usage.query({ ...range, botId: 'a' }).options.bots.length, 2);
  fs.appendFileSync(path.join(dir, 'usage.jsonl'), '{"interrupted":');
  const reopened = new UsageLedger(dir);
  reopened.append(record('after', start + 1));
  assert.equal(new UsageLedger(dir).query(range).totals.calls, 4);
  assert.ok(fs.existsSync(path.join(dir, 'usage.jsonl.recovery')));
  assert.throws(() => reopened.query({ ...range, start: end }), /有效/);
  assert.throws(() => reopened.query({ start, end: start + 500 * 86400000, interval: 'hour' }), /粒度/);
  assert.equal(normalizeUsage({ promptTokens: 8, completionTokens: NaN, cachedTokens: 900 }).cachedTokens, 8);
  assert.equal(normalizeUsage({ promptTokens: -1, completionTokens: Infinity }), undefined);
});

test('calendar buckets handle short months and daylight-saving days without gaps', () => {
  const { store } = fixture();
  const start = new Date(2026, 0, 1).getTime(), end = new Date(2026, 3, 1).getTime();
  store.usage.append(record('feb', new Date(2026, 1, 28, 23).getTime()));
  const report = store.usage.query({ start, end, interval: 'month' });
  assert.equal(report.buckets.length, 3); assert.equal(report.buckets[1].totalTokens, 125);
  assert.equal(report.buckets[1].end, new Date(2026, 2, 1).getTime());
  const daily = store.usage.query({ start: new Date(2026, 2, 7).getTime(), end: new Date(2026, 2, 11).getTime(), interval: 'day' });
  assert.equal(daily.buckets.length, 4);
  for (let i = 1; i < daily.buckets.length; i++) assert.equal(daily.buckets[i - 1].end, daily.buckets[i].start);
});

test('historical backfill excludes merged copies and new tracked replies; repeats safely', () => {
  const { dir, store, bot, conversation } = fixture();
  store.appendMessage(conversation.id, { id: 'old', role: 'assistant', content: 'historical text', model: 'old-model', createdAt: Date.now(), usage: { promptTokens: 10, completionTokens: 2 } });
  store.appendMessage(conversation.id, { id: 'tracked', role: 'assistant', content: 'tracked', createdAt: Date.now(), usageTracked: true, usage: { promptTokens: 10, completionTokens: 2 } });
  const merged = { ...conversation, id: 'merged', mergedInto: conversation.id };
  fs.writeFileSync(path.join(dir, 'conversations', 'merged.json'), JSON.stringify(merged));
  const once = new Store(dir), twice = new Store(dir);
  assert.equal(once.usage.query(query()).totals.calls, 1);
  assert.equal(twice.usage.query(query()).totals.totalTokens, 12);
  assert.equal(twice.usage.query(query()).models[0].detail, '历史记录 · 供应商未记录');
  assert.equal(twice.settings.bots[0].id, bot.id);
  assert.ok(!fs.readFileSync(path.join(dir, 'usage.jsonl'), 'utf8').includes('historical text'));
});

test('cumulative stream snapshots record once; errors retain reported usage and missing counts stay unknown', async () => {
  const { store, bot, conversation } = fixture();
  const args = { model: 'm', system: '', messages: [], tools: [], temperature: 0 };
  const handlers = { onText() {}, onToolCall() {} };
  await trackedChat(store, bot, conversation.id, 'chat', { async chat(_args, h) { h.onUsage({ promptTokens: 20, completionTokens: 2 }); h.onUsage({ promptTokens: 20, completionTokens: 8 }); return { finishReason: 'stop', usage: { promptTokens: 20, completionTokens: 8 } }; } }, args, handlers);
  await assert.rejects(trackedChat(store, bot, conversation.id, 'chat', { async chat(_args, h) { h.onUsage({ promptTokens: 30 }); throw new Error('stream stopped'); } }, args, handlers));
  await trackedChat(store, bot, conversation.id, 'chat', { async chat() { return { finishReason: 'stop' }; } }, args, handlers);
  const report = store.usage.query(query());
  assert.equal(report.totals.calls, 3); assert.equal(report.totals.totalTokens, 58);
  assert.equal(report.totals.reportedCalls, 1); assert.equal(report.totals.cacheReportedCalls, 0);
});

test('real SSE adapters normalize OpenAI cache, Anthropic cache writes, and Gemini reasoning', async () => {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; bodies.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = req.url.includes('messages') ? [
      { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 70, cache_creation_input_tokens: 30 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ] : req.url.includes('streamGenerateContent') ? [{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 10, thoughtsTokenCount: 15, cachedContentTokenCount: 80 } }] : [
      { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 25, prompt_cache_hit_tokens: 80 } },
    ];
    for (const event of events) res.write(`${req.url.includes('messages') ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
    res.end(req.url.includes('messages') || req.url.includes('streamGenerateContent') ? '' : 'data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  try {
    const results = [];
    for (const kind of ['openai', 'anthropic', 'gemini']) {
      const provider = createChatProvider({ id: kind, name: kind, kind, baseUrl: `http://localhost:${server.address().port}/v1`, defaultModel: 'test', createdAt: 0 }, 'test-only');
      const result = await provider.chat({ model: 'test', system: '', messages: [{ role: 'user', content: 'hello' }], tools: [], temperature: 0 }, { onText() {}, onToolCall() {} });
      results.push(result.usage);
    }
    assert.deepEqual(results, [{ promptTokens: 200, completionTokens: 25, cachedTokens: 80 }, { promptTokens: 200, completionTokens: 20, cachedTokens: 70 }, { promptTokens: 200, completionTokens: 25, cachedTokens: 80 }]);
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  } finally { server.close(); }
});

test('tool rounds, group participants and automatic compaction all reach the durable ledger', async () => {
  const { dir, store, bot, conversation } = fixture();
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const tool = !body.messages.some((message) => message.role === 'tool');
    const delta = tool ? { tool_calls: [{ index: 0, id: 'remember-call', function: { name: 'remember', arguments: JSON.stringify({ text: 'remembered fact' }) } }] } : { content: 'done' };
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const first = { ...bot, model: 'm1', tools: ['remember'] }, second = { ...first, id: 'b2', name: 'Nova', model: 'm2' };
  store.updateSettings({ bots: [first, second], providers: [{ ...store.settings.providers[0], baseUrl: `http://localhost:${server.address().port}/v1`, contextWindowTokens: 4096 }], cloud: { ...store.settings.cloud, driver: 'mock' } });
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus: () => {} });
  const runtime = new AgentRuntime({ store, cloud, emit() {}, requestApproval: async () => true });
  const wait = async (id) => { const end = Date.now() + 5000; while (runtime.isRunning(id) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(runtime.isRunning(id), false); };
  try {
    const run = await runtime.send({ botId: bot.id, text: 'remember' }); await wait(run.conversationId);
    assert.equal(conversation.messages.at(-1).error, undefined);
    // cachedTokens accumulates across tool rounds (it used to be dropped entirely).
    assert.deepEqual(conversation.messages.at(-1).usage, { promptTokens: 200, completionTokens: 40, cachedTokens: 80 });
    assert.equal(store.usage.query(query()).totals.totalTokens, 240);
    const group = store.createGroup('Test group', [first.id, second.id]);
    const groupRun = await runtime.send({ botId: first.id, conversationId: group.id, text: 'remember' }); await wait(groupRun.conversationId);
    assert.equal(store.usage.query(query()).totals.calls, 6);
    assert.equal(store.usage.query(query({ botId: second.id })).totals.calls, 2);
    // Force history compression through the real context preparation entry point.
    for (let n = 0; n < 6; n++) {
      store.appendMessage(conversation.id, { id: `old-u-${n}`, role: 'user', content: '长期项目资料与约束。'.repeat(80), createdAt: Date.now() });
      store.appendMessage(conversation.id, { id: `old-a-${n}`, role: 'assistant', content: '已整理', createdAt: Date.now() });
    }
    store.appendMessage(conversation.id, { id: 'current', role: 'user', content: '继续', createdAt: Date.now() });
    let compactCalls = 0;
    await prepareContext({ store, bot: first, conversation, userMessageId: 'current', live: [{ role: 'user', content: '继续' }], system: '助手', tools: [], signal: new AbortController().signal, emit() {}, provider: { async chat(_args, h) { compactCalls++; h.onText(JSON.stringify({ summary: '保留约束与进展', memories: [] })); return { finishReason: 'stop', usage: { promptTokens: 90, completionTokens: 10 } }; } } });
    assert.ok(compactCalls > 0);
    const report = store.usage.query(query());
    assert.equal(report.totals.compactionCalls, compactCalls);
    assert.equal(report.totals.totalTokens, 720 + compactCalls * 100);
    assert.equal(new Store(dir).usage.query(query()).totals.totalTokens, report.totals.totalTokens, 'No backfill double counting on restart');
  } finally { cloud.dispose(); server.close(); }
});
