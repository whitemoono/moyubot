import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Store, ScheduleRunner, parseCron, nextCronTime, AgentRuntime, CloudHost, toolNamesFor } from '../packages/core/dist/index.js';

const root = path.resolve('.work', 'schedule-tests', String(Date.now()));
let serial = 0;
function fixture() { const dir = path.join(root, String(++serial)); const store = new Store(dir); const first = { ...store.settings.bots[0], tools: ['schedule_task'] }, second = { ...first, id: 'second', name: 'Nova' }; store.updateSettings({ bots: [first, second], cloud: { ...store.settings.cloud, driver: 'mock' } }); return { dir, store, first, second }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('cron accepts valid recurring schedules and rejects invalid fields without hanging', () => {
  assert.deepEqual(parseCron('*/30 * * * *').minute, [0, 30]);
  assert.deepEqual(parseCron('0 9 * * 5-7').dow, [5, 6, 0]);
  assert.equal(nextCronTime('0 9 * * 1-5', new Date(2026, 9, 30, 9, 1)).getTime(), new Date(2026, 10, 2, 9).getTime());
  for (const invalid of ['*/0 * * * *', '*/no * * * *', '1.5 * * * *', '10-3 * * * *', '60 * * * *', '0 24 * * *', '0 9 * * 8', '0,,1 * * * *', '0 9 * *', '-1 * * * *']) assert.throws(() => parseCron(invalid), invalid);
  assert.equal(nextCronTime('0 9 30 2 *', new Date(2026, 0, 1)), null);
});

test('tasks persist bot ownership, timing edits, pause/resume and closed history; duplicate creates are idempotent', () => {
  const { dir, store, first, second } = fixture();
  const changes = []; store.onSchedulesChanged((tasks) => changes.push(tasks));
  const task = store.createSchedule(first.id, { title: '每日汇报', cron: '0 9 * * *', prompt: '汇报项目进展' });
  assert.ok(task.nextRunAt > Date.now());
  assert.equal(store.createSchedule(first.id, { cron: task.cron, prompt: task.prompt }).id, task.id);
  assert.equal(changes.length, 1);
  assert.throws(() => store.updateSchedule(second.id, task.id, { action: 'pause' }), /当前 Bot/);
  store.updateSchedule(first.id, task.id, { cron: '0 10 * * 1-5', prompt: '汇报最新进展', title: '工作日汇报' });
  assert.equal(store.listSchedules()[0].cron, '0 10 * * 1-5');
  store.updateSchedule(first.id, task.id, { action: 'pause' });
  assert.equal(store.listSchedules()[0].enabled, false); assert.equal(store.listSchedules()[0].nextRunAt, undefined);
  store.updateSchedule(first.id, task.id, { action: 'resume' });
  assert.ok(store.listSchedules()[0].nextRunAt > Date.now());
  const once = store.createSchedule(first.id, { title: '明天提醒', prompt: '提醒汇报', runAt: Date.now() + 86400000 });
  assert.equal(once.kind, 'once'); assert.equal(once.nextRunAt, once.runAt);
  const updated = store.updateSchedule(first.id, once.id, { cron: '0 11 * * *' });
  assert.equal(updated.kind, 'cron'); assert.equal(updated.runAt, undefined);
  store.updateSchedule(first.id, task.id, { action: 'close' });
  const closed = new Store(dir).listSchedules().find((item) => item.id === task.id);
  assert.ok(closed.closedAt); assert.equal(closed.enabled, false);
  assert.throws(() => store.updateSchedule(first.id, task.id, { action: 'resume' }), /已关闭/);
  const before = fs.readFileSync(path.join(dir, 'schedules.json'), 'utf8');
  for (const input of [{ prompt: 'x', cron: '*/0 * * * *' }, { prompt: 'x', runAt: Date.now() - 1 }, { prompt: '', cron: '* * * * *' }, { prompt: 'x', cron: '* * * * *', runAt: Date.now() + 1000 }]) assert.throws(() => store.createSchedule(first.id, input));
  assert.equal(fs.readFileSync(path.join(dir, 'schedules.json'), 'utf8'), before);
  assert.ok(toolNamesFor(first).includes('list_tasks') && toolNamesFor(first).includes('update_task'), 'Existing schedule-capable bots get management tools');
});

test('runner waits for a free bot and the actual completion; one-off tasks finish once and retain concurrent pauses', async () => {
  const { store, first } = fixture();
  const start = Date.now(), task = store.createSchedule(first.id, { prompt: '汇报', runAt: start + 1000 });
  let busy = true, calls = 0, done;
  const runtime = { isRunning: () => busy, runUnattended: async (_botId, prompt) => { calls++; assert.ok(prompt.includes(task.id)); busy = true; await new Promise((resolve) => { done = resolve; }); busy = false; return { conversationId: store.botConversation(first.id).id }; } };
  const runner = new ScheduleRunner({ store, runtime, now: () => start + 2000 });
  runner.tick(); assert.equal(calls, 0, 'Busy bot does not lose the due task');
  busy = false; runner.tick(); assert.equal(calls, 1);
  assert.equal(store.listSchedules()[0].lastStatus, 'running');
  runner.tick(); assert.equal(calls, 1, 'No overlapping executions');
  store.updateSchedule(first.id, task.id, { action: 'pause' });
  done(); await flush();
  const finished = store.listSchedules()[0];
  assert.equal(finished.lastStatus, 'ok'); assert.ok(finished.completedAt); assert.equal(finished.enabled, false);
  runner.tick(); assert.equal(calls, 1, 'Completed one-off cannot run twice');
});

test('failed recurring jobs retain errors and closing during a run prevents subsequent execution', async () => {
  const { store, first } = fixture();
  const task = store.createSchedule(first.id, { prompt: '汇报', cron: '* * * * *' });
  const now = task.nextRunAt + 1;
  let fail;
  const runtime = { isRunning: () => false, runUnattended: () => new Promise((_resolve, reject) => { fail = reject; }) };
  const runner = new ScheduleRunner({ store, runtime, now: () => now });
  runner.tick(); assert.equal(store.listSchedules()[0].lastStatus, 'running');
  store.updateSchedule(first.id, task.id, { action: 'close' });
  fail(new Error('provider failed')); await flush();
  assert.equal(store.listSchedules()[0].lastStatus, 'error');
  assert.equal(store.listSchedules()[0].lastError, 'provider failed');
  assert.ok(store.listSchedules()[0].closedAt); assert.equal(store.listSchedules()[0].enabled, false);
});

test('chat tools create, list, modify, pause, resume and close only the speaking bot tasks', async () => {
  const { dir, store, first, second } = fixture();
  const foreign = store.createSchedule(second.id, { prompt: 'Nova private task', cron: '0 9 * * *' });
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests++;
    const last = body.messages.findLastIndex((message) => message.role === 'user');
    const command = body.messages[last].content;
    const results = body.messages.slice(last + 1).filter((message) => message.role === 'tool');
    let name, args;
    if (command === 'create' && !results.length) { name = 'schedule_task'; args = { title: '晨间汇报', prompt: '汇报进展', cron: '0 9 * * *' }; }
    else if (command === 'once' && !results.length) { name = 'schedule_task'; args = { title: '明天提醒', prompt: '提醒检查', runAt: new Date(Date.now() + 86400000).toISOString() }; }
    else if (command === 'foreign' && !results.length) { name = 'update_task'; args = { taskId: foreign.id, action: 'close' }; }
    else if (!['create', 'once', 'foreign'].includes(command) && !results.length) { name = 'list_tasks'; args = {}; }
    else if (['update', 'pause', 'resume', 'close'].includes(command) && results.length === 1) {
      const listed = JSON.parse(results[0].content); assert.ok(listed.every((task) => task.botId === first.id));
      name = 'update_task'; args = { taskId: listed[0].id, action: command, ...(command === 'update' ? { cron: '0 10 * * *', title: '十点汇报' } : {}) };
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = name ? { tool_calls: [{ index: 0, id: `call-${requests}`, function: { name, arguments: JSON.stringify(args) } }] } : { content: '操作完成' };
    res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`); res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  store.updateSettings({ providers: [{ ...store.settings.providers[0], baseUrl: `http://localhost:${server.address().port}/v1` }] });
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({ store, cloud, emit() {}, requestApproval: async () => true });
  const send = async (text) => { await runtime.runUnattended(first.id, text); return store.listSchedules().find((task) => task.botId === first.id); };
  try {
    let task = await send('create'); assert.equal(task.title, '晨间汇报');
    task = await send('update'); assert.equal(task.cron, '0 10 * * *'); assert.equal(task.title, '十点汇报');
    task = await send('pause'); assert.equal(task.enabled, false);
    task = await send('resume'); assert.equal(task.enabled, true);
    task = await send('close'); assert.ok(task.closedAt);
    await send('once'); assert.equal(store.listSchedules().filter((task) => task.botId === first.id).at(-1).kind, 'once');
    await send('foreign'); assert.equal(store.listSchedules().find((task) => task.id === foreign.id).enabled, true);
    assert.ok(store.botConversation(first.id).messages.at(-1).toolResults.some((result) => !result.ok && /当前 Bot/.test(result.summary)));
    assert.equal(new Store(dir).listSchedules().length, 3);
  } finally { cloud.dispose(); server.close(); }
});

test('unattended runtime reports failure after the final reply rather than on submission', async () => {
  const { store, first } = fixture();
  const cloud = new CloudHost({ settings: store.settings.cloud, apiKey: () => '', onStatus() {} });
  const runtime = new AgentRuntime({ store, cloud, emit() {}, requestApproval: async () => true });
  try { await assert.rejects(runtime.runUnattended(first.id, 'scheduled task'), /API Key/); }
  finally { cloud.dispose(); }
});

test('reopening an interrupted one-off marks it interrupted without re-executing a possibly completed action', () => {
  const { dir, store, first } = fixture();
  const task = store.createSchedule(first.id, { prompt: '一次性操作', runAt: Date.now() + 1000 });
  store.upsertSchedule({ ...task, lastStatus: 'running', lastRunAt: Date.now(), nextRunAt: undefined });
  const reopened = new Store(dir).listSchedules()[0];
  assert.equal(reopened.enabled, false); assert.ok(reopened.completedAt);
  assert.equal(reopened.lastStatus, 'error'); assert.ok(reopened.lastError.includes('中断'));
});
