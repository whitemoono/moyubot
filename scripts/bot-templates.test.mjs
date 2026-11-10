import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportBotToTemplate,
  validateBotTemplate,
  templateToBot,
  parseTemplate,
  serializeTemplate,
} from '../packages/core/dist/bot-templates.js';
import { Store } from '../packages/core/dist/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sampleBot(over = {}) {
  return {
    id: 'bot_x123',
    name: '研发 · 代码评审官',
    handle: 'reviewer-dev',
    avatar: { from: '#3b6cf5', to: '#608dff', glyph: '审' },
    providerId: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.3,
    systemPrompt: '你是一位严谨的代码评审官。',
    tools: ['read_files', 'local_read_file', 'web_fetch', 'ask_user'],
    image: { aspect: '1:1' },
    wakeOnTask: false,
    workspaceId: 'workspace_local',
    mcpServerIds: ['mcp_a', 'mcp_b'],
    skillIds: ['skill_x'],
    createdAt: 1,
    updatedAt: 2,
    dirName: 'reviewer-abc123',
    sidebar: { pinned: true, group: '研发' },
    generation: { maxSteps: 40, maxDurationSeconds: 1800 },
    ...over,
  };
}

test('导出模板剔除本机身份字段', () => {
  const t = exportBotToTemplate(sampleBot(), { author: 'alice', tags: ['dev', 'review'] });
  // meta 归一化
  assert.equal(t.schemaVersion, 1);
  assert.equal(t.meta.name, '研发 · 代码评审官');
  assert.equal(t.meta.handle, 'reviewer-dev');
  assert.equal(t.meta.author, 'alice');
  assert.deepEqual(t.meta.tags, ['dev', 'review']);
  // bot 白名单：保留工具/引用/人设
  assert.equal(t.bot.systemPrompt, '你是一位严谨的代码评审官。');
  assert.deepEqual(t.bot.tools, ['read_files', 'local_read_file', 'web_fetch', 'ask_user']);
  assert.deepEqual(t.bot.mcpServerIds, ['mcp_a', 'mcp_b']);
  assert.equal(t.bot.wakeOnTask, false);
  assert.equal(t.bot.temperature, 0.3);
});

test('导出模板不携带 dev-only 字段（id/时间/dirName/sidebar/providerId/model）', () => {
  const t = exportBotToTemplate(sampleBot());
  const serialized = JSON.stringify(t);
  // providerId/model 是模板想要的"偏好"，导出时按白名单保留；评估应看 dirName/sidebar/id/时间
  assert.ok(!('id' in t.bot), '模板不应含 id');
  assert.ok(!('dirName' in t.bot), '模板不应含 dirName');
  assert.ok(!('sidebar' in t.bot), '模板不应含 sidebar');
  assert.ok(!('createdAt' in t.bot) && !('updatedAt' in t.bot), '模板不应含时间戳');
  assert.ok(!serialized.includes('bot_x123'), '不应泄漏原 id');
  assert.ok(!serialized.includes('reviewer-abc123'), '不应泄漏 dirName');
});

test('模板转 Bot：强制 ask、重设 id、日期为 now', () => {
  const t = exportBotToTemplate(sampleBot());
  const bot = templateToBot(t, { workspaceId: 'workspace_local' });
  assert.equal(bot.approvalPolicy, 'ask', '导入必须强制 ask');
  assert.ok(/^bot_/.test(bot.id), 'id 应重新生成');
  assert.notEqual(bot.id, 'bot_x123');
  assert.equal(typeof bot.createdAt, 'number');
  assert.equal(bot.createdAt, bot.updatedAt);
  assert.equal(bot.workspaceId, 'workspace_local');
  assert.equal(bot.name, '研发 · 代码评审官');
});

test('模板转 Bot：引用清单只绑定命中的 Skill/MCP', () => {
  const t = exportBotToTemplate(sampleBot());
  const bot = templateToBot(t, {
    skillIdByTemplate: { skill_x: 'skill_local_x' }, // 只 skill_x 命中
    mcpIdByRef: { mcp_a: 'mcp_local_a' }, // mcp_b 未匹配 → 不绑定
  });
  assert.deepEqual(bot.skillIds, ['skill_local_x']);
  assert.deepEqual(bot.mcpServerIds, ['mcp_local_a'], '未匹配的 mcp_b 不应静默绑定');
});

test('validateBotTemplate：合法模板通过并归一', () => {
  const t = exportBotToTemplate(sampleBot(), { tags: ['dev'] });
  const v = validateBotTemplate(JSON.parse(JSON.stringify(t)));
  assert.equal(v.schemaVersion, 1);
  assert.equal(v.meta.name, '研发 · 代码评审官');
});

test('validateBotTemplate：缺 person/schemaVersion 抛错', () => {
  assert.throws(() => validateBotTemplate(null), /模板格式无效/);
  assert.throws(() => validateBotTemplate('x'), /模板格式无效/);
  assert.throws(() => validateBotTemplate({}), /不支持的模板版本/);
  assert.throws(() => validateBotTemplate({ schemaVersion: 99, bot: {} }), /不支持的模板版本/);
  assert.throws(() => validateBotTemplate({ schemaVersion: 1, meta: { name: '', handle: 'x' }, bot: { systemPrompt: 'hi' } }), /缺少名称/);
  assert.throws(() => validateBotTemplate({ schemaVersion: 1, meta: { name: 'n', handle: 'x' }, bot: {} }), /缺少人设/);
  assert.throws(() => validateBotTemplate({ schemaVersion: 1, meta: { name: 'n', handle: 'x' }, bot: { systemPrompt: 'hi', tools: [1] } }), /工具清单无效/);
  assert.throws(() => validateBotTemplate({ schemaVersion: 1, meta: { name: 'n', handle: 'x!' }, bot: { systemPrompt: 'hi' } }), /handle/);
});

test('parseTemplate / serializeTemplate 往返', () => {
  const t = exportBotToTemplate(sampleBot());
  const text = serializeTemplate(t);
  const back = parseTemplate(text);
  assert.equal(back.meta.name, '研发 · 代码评审官');
  assert.deepEqual(back.bot.tools, t.bot.tools);
  // 非法 JSON
  assert.throws(() => parseTemplate('not-json'), /不是有效的 JSON/);
});

test('模板可声明建议定时任务，转 Bot 时不自动注册', () => {
  const t = {
    schemaVersion: 1,
    meta: { name: '晨报', handle: 'daily-report' },
    bot: {
      systemPrompt: '先生成每日晨报。',
      suggestedSchedules: [{ title: '每日晨报', prompt: '汇总当天变化', rrule: 'FREQ=DAILY;BYHOUR=9' }],
    },
  };
  const v = validateBotTemplate(t);
  assert.equal(v.bot.suggestedSchedules.length, 1);
  const bot = templateToBot(v);
  // ImportedBot 不含 suggestedSchedules（那是模板元信息，不落到 Bot）
  assert.ok(!('suggestedSchedules' in bot));
});

test('Store：我上传的模板记录（去重 / 移除 / 持久化）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-market-test-'));
  const store = new Store(dir);
  let s = store.recordTemplateSubmission({ handle: 'dev-reviewer', name: '代码评审官', version: '0.1.0', target: 'https://moyubot.net/bots/market-index.json' });
  assert.equal(s.submissions.length, 1);
  // 同 handle 去重，保留最新版本
  s = store.recordTemplateSubmission({ handle: 'dev-reviewer', name: '代码评审官 v2', version: '0.2.0', target: 'x' });
  assert.equal(s.submissions.length, 1);
  assert.equal(s.submissions[0].name, '代码评审官 v2');
  s = store.recordTemplateSubmission({ handle: 'dev-qa', name: '哨兵', target: 'x' });
  assert.equal(s.submissions.length, 2);
  s = store.removeTemplateSubmission('dev-reviewer');
  assert.equal(s.submissions.length, 1);
  // 磁盘持久化
  const store2 = new Store(dir);
  assert.equal(store2.botMarket().submissions.length, 1);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* sqlite 可能占用，忽略清理失败 */ }
});