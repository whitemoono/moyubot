const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.work', 'capabilities-desktop', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron'));
app.disableHardwareAcceleration();
let win, backend;
const errors = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function until(fn, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await evaluate(fn)) return; await delay(60); }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) {
  assert.ok(await evaluate(s => { const el = document.querySelector(s); el?.click(); return !!el; }, selector), selector);
  await delay(150);
}
async function input(selector, value) {
  await evaluate((s, value) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
}
async function capture(name) {
  // Hidden windows may retain their previous compositor frame until resized.
  const [width, height] = win.getSize(); win.setSize(width + 1, height); await delay(100); win.setSize(width, height);
  await delay(350); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  const { MoyuApp } = require('../apps/desktop/dist-electron/app.js');
  backend = new MoyuApp(path.join(output, 'data'), '0.1.1');
  const bot = backend.store.settings.bots[0];
  backend.store.updateSettings({ onboarding: { step: 2, completedAt: Date.now() }, cloud: { driver: 'mock' }, activeBotId: bot.id, activeView: 'chat' });
  const source = path.join(output, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: 周报整理\ndescription: 汇总本周工作，整理交付成果与下周待办。\n---\n先整理项目，再按进度分组。');
  const server = path.join(output, 'server.cjs');
  fs.writeFileSync(server, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const r=JSON.parse(line); if(r.id===undefined)return;
    const result=r.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'demo',version:'1'}}:r.method==='tools/list'?{tools:[{name:'search_projects',description:'搜索项目资料',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'完成'}]};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
  });`);
  // Node executable provided by the launcher: Electron cannot run this fixture as plain Node.
  const nodeExe = process.env.CAPABILITY_TEST_NODE;
  assert.ok(nodeExe, 'CAPABILITY_TEST_NODE');
  backend.start();
  win = new BrowserWindow({ width: 1380, height: 940, show: false, webPreferences: { preload: path.join(root, 'apps/desktop/dist-electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  backend.setWindow(win);
  win.webContents.on('console-message', (_e, entry) => { if (entry.level === 'error') errors.push(entry.message); });
  await win.loadFile(path.join(root, 'apps/desktop/dist/index.html'));
  await until(() => !!document.querySelector('.messenger-bot'), 'bots');
  await click('.messenger-bot');
  await until(() => !!document.querySelector('.chat__who'), 'chat');
  await click('.chat__who');
  await click('#inspector-tab-details');
  await until(() => !!document.querySelector('.bot-capabilities'), 'capabilities in inspector');
  await click('.bot-capabilities .btn');
  await until(() => !!document.querySelector('.capabilities-settings'), 'capability settings');
  await input('[aria-label="MCP JSON 配置"]', JSON.stringify({ mcpServers: { '项目搜索': { command: nodeExe, args: [server] } } }));
  await evaluate(() => [...document.querySelectorAll('.capabilities-settings button')].find(b => b.textContent === '导入服务').click());
  await until(() => !!document.querySelector('.capability-config'), 'imported MCP');
  await evaluate(() => [...document.querySelectorAll('.capability-config button')].find(b => b.textContent === '测试连接').click());
  await until(() => document.querySelector('.capability-config')?.textContent.includes('已连接'), 'MCP connected');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  await evaluate(() => [...document.querySelectorAll('.capabilities-settings button')].find(b => b.textContent === '导入技能目录').click());
  await until(() => document.querySelector('.capabilities-settings')?.textContent.includes('周报整理'), 'skill imported via IPC');
  await capture('settings-dark');
  await click('[aria-label="关闭设置"]');
  await until(() => !document.querySelector('.settings-dialog'), 'settings closed');
  await until(() => document.querySelectorAll('.bot-capabilities .switch button').length === 2, 'bindings available');
  await click('.bot-capabilities .switch button');
  await until(() => document.querySelector('.bot-capabilities .switch button')?.getAttribute('aria-checked') === 'true', 'MCP enabled');
  await click('.bot-capabilities section:nth-child(2) .switch button');
  await until(() => document.querySelector('.bot-capabilities section:nth-child(2) .switch button')?.getAttribute('aria-checked') === 'true', 'skill enabled');
  const saved = backend.store.getBot(bot.id);
  assert.equal(saved.mcpServerIds.length, 1); assert.equal(saved.skillIds.length, 1);
  const loaded = await backend.capabilities.call(saved, { id: 'load-demo', name: 'load_skill', arguments: { skillId: saved.skillIds[0] } });
  assert.ok(loaded.ok);
  await until(() => document.querySelector('.bot-capabilities')?.textContent.includes('最近加载'), 'loaded status');
  await evaluate(() => document.querySelectorAll('.bot-capabilities details').forEach(d => d.open = true));
  await capture('inspector-dark');
  await evaluate(() => document.documentElement.dataset.theme = 'light');
  await capture('inspector-light');
  win.setSize(1000, 780); await delay(300);
  assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  await capture('inspector-compact');
  assert.deepEqual(errors, []);
  console.log('Capabilities desktop passed. Screenshots: ' + output);
}).catch(async e => {
  console.error(e); process.exitCode = 1;
  if (win && !win.isDestroyed()) await capture('failure');
}).finally(async () => {
  if (backend) { await backend.capabilities.dispose(); backend.dispose(); }
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(process.exitCode || 0);
});
