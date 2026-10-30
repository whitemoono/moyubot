const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.work', 'generation-desktop', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron'));
app.disableHardwareAcceleration();
let win, backend;
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function until(fn, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await evaluate(fn)) return; await delay(60); }
  throw new Error('Timed out: ' + label);
}
async function click(selector) {
  assert.ok(await evaluate(s => { const el = document.querySelector(s); el?.click(); return !!el; }, selector), selector);
  await delay(120);
}
async function textClick(selector, text) {
  assert.ok(await evaluate((s, text) => { const el = [...document.querySelectorAll(s)].find(el => el.textContent.trim() === text); el?.click(); return !!el; }, selector, text), text);
  await delay(150);
}
async function input(label, value) {
  await evaluate((label, value) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (!el) throw new Error('Missing input: ' + label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, label, String(value));
  await delay(80);
}
async function capture(name) {
  const [width, height] = win.getSize(); win.setSize(width + 1, height); await delay(100); win.setSize(width, height);
  await delay(300); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  const { MoyuApp } = require('../apps/desktop/dist-electron/app.js');
  const { Store } = require('../packages/core/dist/index.js');
  backend = new MoyuApp(path.join(output, 'data'), '0.1.1');
  const provider = { ...backend.store.settings.providers[0], defaultModel: 'model-a', models: ['model-a', 'model-b'] };
  const bot = { ...backend.store.settings.bots[0], providerId: provider.id, model: 'model-a' };
  backend.store.updateSettings({ providers: [provider], bots: [bot], onboarding: { step: 2, completedAt: Date.now() }, cloud: { driver: 'mock' }, activeBotId: bot.id, activeView: 'chat' });
  backend.start();
  win = new BrowserWindow({ width: 1380, height: 940, show: false, webPreferences: { preload: path.join(root, 'apps/desktop/dist-electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  backend.setWindow(win);
  win.webContents.on('console-message', (_e, entry) => { if (entry.level === 'error') errors.push(entry.message); });
  await win.loadFile(path.join(root, 'apps/desktop/dist/index.html'));
  await until(() => !!document.querySelector('[aria-label="用户菜单"]'), 'app');
  await click('[aria-label="用户菜单"]');
  await textClick('[role="menuitem"]', '设置');
  await textClick('.settings-tabs button', '模型供应商');
  await input('模型上下文上限', 131072);
  await input('模型最大输出', 32768);
  await click('[aria-label="模型思考接口"]');
  await textClick('[role="option"]', 'OpenAI reasoning_effort');
  await click('[aria-label="默认思考强度"]');
  await textClick('[role="option"]', '高');
  await click('[aria-label="思考回传"]');
  await textClick('[role="option"]', '启用 DeepSeek 思考回传');
  await input('配置模型额度', 'model-b');
  assert.equal(await evaluate(() => document.querySelector('[aria-label="模型最大输出"]').value), '');
  await input('模型上下文上限', 16384);
  await input('模型最大输出', 2048);
  await input('配置模型额度', 'model-a');
  assert.equal(await evaluate(() => document.querySelector('[aria-label="模型最大输出"]').value), '32768');
  await evaluate(() => document.querySelector('[aria-label="配置模型额度"]').blur());
  await textClick('.provider-savebar button', '保存更改');
  await until(() => document.querySelector('.provider-savebar')?.textContent.includes('所有更改已保存'), 'provider saved');
  const saved = backend.store.getProvider(provider.id);
  assert.equal(saved.defaultModel, 'model-a');
  assert.equal(saved.modelSettings['model-a'].maxOutputTokens, 32768);
  assert.equal(saved.modelSettings['model-b'].maxOutputTokens, 2048);
  assert.equal(saved.modelSettings['model-a'].reasoningEffort, 'high');
  assert.equal(saved.modelSettings['model-a'].reasoningReplay, true);
  await evaluate(() => document.querySelector('.model-limits').scrollIntoView({ block: 'center' }));
  await capture('model-limits');
  await textClick('.settings-tabs button', 'Bot 管理');
  await click('[aria-label="编辑"]');
  await until(() => !!document.querySelector('[aria-label="Bot 单次输出上限"]'), 'bot editor');
  await input('Bot 单次输出上限', 16384);
  await input('任务生成轮数', 48);
  await input('任务累计生成额度', 262144);
  await input('任务最长时间', 1800);
  await click('[aria-label="Bot 思考强度"]');
  await textClick('[role="option"]', '低');
  await evaluate(() => document.querySelector('[aria-label="任务累计生成额度"]').scrollIntoView({ block: 'center' }));
  await capture('bot-budget');
  await textClick('.sheet__foot button', '保存');
  await until(() => !document.querySelector('.sheet'), 'bot saved');
  const expected = Object.fromEntries([['maxOutputTokens', 16384], ['maxSteps', 48], ['maxTaskOutputTokens', 262144], ['maxDurationSeconds', 1800], ['reasoningEffort', 'low']]);
  assert.deepEqual(backend.store.getBot(bot.id).generation, expected);
  const reopened = new Store(path.join(output, 'data'));
  assert.deepEqual(reopened.getBot(bot.id).generation, expected);
  assert.deepEqual(reopened.getProvider(provider.id).modelSettings, saved.modelSettings);
  await click('[aria-label="关闭设置"]');
  await until(() => !document.querySelector('.settings-dialog'), 'closed');
  await win.reload();
  await until(() => !!document.querySelector('[aria-label="用户菜单"]'), 'reloaded');
  await click('[aria-label="用户菜单"]');
  await textClick('[role="menuitem"]', '设置');
  await textClick('.settings-tabs button', 'Bot 管理');
  await click('[aria-label="编辑"]');
  assert.equal(await evaluate(() => document.querySelector('[aria-label="Bot 单次输出上限"]').value), '16384');
  win.setSize(1000, 780);
  await evaluate(() => document.querySelector('[aria-label="任务累计生成额度"]').scrollIntoView({ block: 'center' }));
  await delay(300);
  assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  await capture('bot-budget-compact');
  const canceled = new AbortController();
  const approval = backend.waitForApproval({ id: 'deadline-test', conversationId: 'test', botId: bot.id, toolName: 'test', summary: 'Test cancellation', createdAt: Date.now() }, canceled.signal);
  canceled.abort();
  assert.equal(await approval, false);
  assert.equal(backend.approvals.size, 0, 'Deadline clears pending approval');
  assert.deepEqual(errors, []);
  console.log('Generation desktop passed. Screenshots: ' + output);
}).catch(async error => {
  console.error(error); process.exitCode = 1;
  if (win && !win.isDestroyed()) await capture('failure');
}).finally(async () => {
  if (backend) { await backend.capabilities.dispose(); backend.dispose(); }
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(process.exitCode || 0);
});
