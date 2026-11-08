import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Store, CapabilityManager, AgentRuntime, CloudHost } from '../packages/core/dist/index.js';
import { testProvider } from './test-provider.mjs';

const root = path.resolve('.work', 'capabilities-tests', String(Date.now()));
let serial = 0;
function fixture() {
  const store = new Store(path.join(root, String(++serial)));
  const manager = new CapabilityManager(store);
  return { store, manager, bot: store.settings.bots[0] };
}
function skillSource(name = 'weekly-report') {
  const dir = path.join(root, `source-${++serial}`);
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: |\n  整理本周进度与计划。\n  包含交付和待办。\n---\n请先读取 references/guide.md。\n`);
  fs.writeFileSync(path.join(dir, 'references', 'guide.md'), '周报资源标记');
  return dir;
}
const call = (name, args) => ({ id: 'call-1', name, arguments: args });

test('skills are copied, persisted, loaded on demand, scoped and constrained to imported directory', async () => {
  const { store, manager, bot } = fixture();
  const source = skillSource();
  manager.importSkill('workspace_cloud', source);
  const skill = store.settings.skills[0];
  assert.notEqual(skill.directory, source);
  assert.match(skill.description, /交付和待办/);
  assert.equal((await manager.call(bot, call('load_skill', { skillId: skill.id }))).ok, false);
  const enabled = store.upsertBot({ ...bot, skillIds: [skill.id] });
  assert.match(manager.catalog(enabled), /weekly-report/);
  assert.ok((await manager.schemas(enabled)).some(s => s.name === 'load_skill'));
  assert.equal(manager.status('workspace_cloud').loadedSkills.length, 0);
  const manifest = await manager.call(enabled, call('load_skill', { skillId: skill.id }));
  assert.equal(manifest.ok, true);
  assert.match(manifest.detail, /references\/guide.md/);
  assert.equal(manager.status('workspace_cloud').loadedSkills.length, 1);
  assert.match((await manager.call(enabled, call('load_skill', { skillId: skill.id, resource: 'references/guide.md' }))).detail, /周报资源标记/);
  assert.equal((await manager.call(enabled, call('load_skill', { skillId: skill.id, resource: '../../settings.json' }))).ok, false);
  assert.throws(() => store.upsertBot({ ...bot, id: 'local-bot', workspaceId: 'workspace_local', skillIds: [skill.id] }), /工作区/);
  const other = store.upsertBot({ ...bot, id: 'other-bot', skillIds: [] });
  assert.equal((await manager.call(other, call('load_skill', { skillId: skill.id }))).ok, false);
  assert.deepEqual(new Store(store.dataDir).getBot(bot.id).skillIds, [skill.id]);
  await manager.remove('skill', skill.id);
  assert.equal((await manager.call(enabled, call('load_skill', { skillId: skill.id }))).ok, false);
  assert.deepEqual(store.getBot(bot.id).skillIds, []);
  await manager.dispose();
});

test('MCP imports validate atomically and keep authentication out of settings', async () => {
  const { store, manager } = fixture();
  await assert.rejects(() => manager.importMcp('workspace_cloud', '{broken-auth-SECRET'), error => !error.message.includes('SECRET'));
  await assert.rejects(() => manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { good: { command: 'node' }, bad: { args: [5] } } })));
  assert.equal(store.settings.mcpServers?.length ?? 0, 0);
  manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { demo: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer fixture-token' } } } }));
  assert.ok(!JSON.stringify(store.settings).includes('fixture-token'));
  const id = store.settings.mcpServers[0].id;
  assert.match(store.secrets.get(`mcp:${id}`), /fixture-token/);
  await manager.remove('mcp', id);
  assert.equal(store.secrets.get(`mcp:${id}`), undefined);
  await manager.dispose();
});

test('stdio uses official MCP lifecycle, lists tools, executes and revokes bindings', async () => {
  const { store, manager, bot } = fixture();
  const server = path.join(store.dataDir, 'fixture-server.cjs');
  fs.writeFileSync(server, `const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); if (request.id === undefined) return;
  const result = request.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
    : request.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
    : request.method === 'tools/call' ? { content: [{ type: 'text', text: 'echo:' + request.params.arguments.text }] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});`);
  manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [server] } } }));
  const id = store.settings.mcpServers[0].id;
  const enabled = store.upsertBot({ ...bot, mcpServerIds: [id] });
  try {
    const schemas = await manager.schemas(enabled);
    assert.equal(schemas.length, 1);
    assert.ok(schemas[0].name.length <= 64);
    assert.equal(manager.status('workspace_cloud').servers[0].state, 'connected');
    const result = await manager.call(enabled, call(schemas[0].name, { text: 'hello' }));
    assert.equal(result.detail, 'echo:hello');
    assert.equal(result.ok, true);
    store.upsertBot({ ...enabled, mcpServerIds: [] });
    assert.equal((await manager.call(enabled, call(schemas[0].name, { text: 'denied' }))).ok, false);
    await manager.remove('mcp', id);
    assert.deepEqual(manager.status('workspace_cloud').servers, []);
  } finally { await manager.dispose(); }
});

test('Streamable HTTP performs initialization and propagates headers', async () => {
  const { store, manager, bot } = fixture();
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer http-fixture');
    if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }
      : (calls++, { content: [{ type: 'text', text: 'pong' }] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  try {
    manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { http: { url: `http://localhost:${server.address().port}/mcp`, headers: { Authorization: 'Bearer http-fixture' } } } }));
    const enabled = store.upsertBot({ ...bot, mcpServerIds: [store.settings.mcpServers[0].id] });
    const schemas = await manager.schemas(enabled);
    assert.equal(schemas.length, 1);
    assert.equal((await manager.call(enabled, call(schemas[0].name, {}))).detail, 'pong');
    assert.equal(calls, 1);
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await manager.call(enabled, call(schemas[0].name, {}), aborted.signal)).ok, false);
    assert.equal(calls, 1);
  } finally { await manager.dispose(); await new Promise(resolve => server.close(resolve)); }
});

test('agent exposes enabled skill metadata and returns loaded manifest through tool history', async () => {
  const { store, manager, bot } = fixture();
  manager.importSkill('workspace_cloud', skillSource());
  const skill = store.settings.skills[0];
  const enabled = store.upsertBot({ ...bot, skillIds: [skill.id] });
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests++;
    assert.ok(body.tools.some(t => t.function.name === 'load_skill'));
    assert.ok(JSON.stringify(body.messages).includes(skill.id));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (requests === 1) res.write('data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: { tool_calls: [{ index: 0, id: 'load-1', type: 'function', function: { name: 'load_skill', arguments: JSON.stringify({ skillId: skill.id }) } }] } }] }) + '\n\n');
    else { assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('references/guide.md'))); res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '技能加载完成' }, finish_reason: 'stop' }] }) + '\n\n'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const cloud = new CloudHost({ settings: { ...store.settings.cloud, driver: 'mock' }, apiKey: () => '' });
  try {
    store.updateSettings({ providers: [{ ...testProvider({ baseUrl: `http://localhost:${server.address().port}/v1` }) }] });
    const runtime = new AgentRuntime({ store, cloud, capabilities: manager, emit: () => {}, requestApproval: async () => false });
    const sent = await runtime.runUnattended(enabled.id, '使用周报技能');
    const message = store.getConversation(sent.conversationId).messages.at(-1);
    assert.equal(message.error, undefined);
    assert.equal(message.toolResults[0].ok, true);
    assert.equal(requests, 2);
  } finally { cloud.dispose(); await manager.dispose(); await new Promise(resolve => server.close(resolve)); }
});

test('unavailable MCP servers report failure without exposing authentication or preventing chat tools', async () => {
  const { store, manager, bot } = fixture();
  manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { missing: { command: path.join(root, 'does-not-exist.exe'), env: { PRIVATE_VALUE: 'fixture-private' } } } }));
  const id = store.settings.mcpServers[0].id;
  const enabled = store.upsertBot({ ...bot, mcpServerIds: [id] });
  try {
    assert.deepEqual(await manager.schemas(enabled), []);
    const state = manager.status('workspace_cloud').servers[0];
    assert.equal(state.state, 'error');
    assert.ok(!JSON.stringify(state).includes('fixture-private'));
    await assert.rejects(manager.test(id), /连接失败/);
  } finally { await manager.dispose(); }
});

test('cloud inventory is local-first: serves persisted list offline, survives probe failures, never wakes the machine', async () => {
  const { store } = fixture();
  let sleeping = true, failProbe = false, execs = 0, wakes = 0;
  store.writeCloudInventory({
    at: Date.now() - 10 * 60_000,
    servers: [{ id: 'moyu-shared-mcp-0', name: 'demo', transport: 'http', url: 'https://example.com/mcp', source: '共享 · .moyu/shared' }],
    skills: [{ id: 'moyu-shared-skill-0', name: 'weekly-report', path: '/data/moyubot/.moyu/shared/skills/weekly-report', source: '共享 · .moyu/shared' }],
  });
  const host = {
    status: () => ({ state: sleeping ? 'suspended' : 'ready' }),
    ensureAwake: async () => { wakes++; return { id: 'fixture' }; },
    exec: async (cmd) => {
      execs++;
      if (failProbe) return { stdout: '', stderr: 'connection refused', exitCode: 1, timedOut: false };
      if (cmd.includes('.migrated-from-claude')) return { stdout: 'migrated:1,1', stderr: '', exitCode: 0, timedOut: false };
      return { stdout: JSON.stringify({ shared: { mcp: [{ name: 'fresh', transport: 'http', url: 'https://example.com/mcp' }], skills: [{ name: 'fresh-skill', path: '/data/moyubot/.moyu/shared/skills/fresh-skill' }] }, bots: {} }), stderr: '', exitCode: 0, timedOut: false };
    },
    writeText: async () => {},
  };
  const manager = new CapabilityManager(store, () => host);
  // 云电脑休眠：直接回落盘的上次清单，不探测、不唤醒
  const offline = await manager.inventoryCloud();
  assert.equal(offline.servers[0].name, 'demo');
  assert.equal(offline.skills[0].name, 'weekly-report');
  assert.equal(execs, 0);
  assert.equal(wakes, 0);
  // 云电脑在线但探测失败：保留旧清单，且不用空结果覆盖落盘文件
  sleeping = false;
  failProbe = true;
  const failed = await manager.inventoryCloud();
  assert.equal(failed.servers[0].name, 'demo');
  assert.equal(store.readCloudInventory().servers[0].name, 'demo');
  // 探测成功：刷新清单并落盘
  failProbe = false;
  const fresh = await manager.inventoryCloud();
  assert.equal(fresh.servers[0].name, 'fresh');
  assert.equal(fresh.skills[0].name, 'fresh-skill');
  assert.equal(store.readCloudInventory().servers[0].name, 'fresh');
  await manager.dispose();
});

test('cloud inventory without any persisted history stays empty while offline', async () => {
  const { store } = fixture();
  let execs = 0;
  const host = {
    status: () => ({ state: 'off' }),
    ensureAwake: async () => { throw new Error('must not wake'); },
    exec: async () => { execs++; return { stdout: '{}', stderr: '', exitCode: 0, timedOut: false }; },
    writeText: async () => {},
  };
  const manager = new CapabilityManager(store, () => host);
  const inventory = await manager.inventoryCloud();
  assert.deepEqual(inventory, { servers: [], skills: [] });
  assert.equal(execs, 0);
  assert.equal(store.readCloudInventory(), undefined);
  await manager.dispose();
});

test('agent asks before MCP calls and honors a declined approval', async () => {
  const { store, bot } = fixture();
  let approvals = 0, calls = 0, requests = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = requests === 1 ? { tool_calls: [{ index: 0, id: 'external-1', type: 'function', function: { name: 'mcp_fixture_0', arguments: '{}' } }] } : { content: '调用未获批准' };
    if (requests > 1) assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('已拒绝 MCP')));
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  store.updateSettings({ providers: [{ ...testProvider({ baseUrl: `http://localhost:${server.address().port}/v1` }) }] });
  store.upsertBot({ ...bot, approvalPolicy: 'ask' });
  const cloud = new CloudHost({ settings: { ...store.settings.cloud, driver: 'mock' }, apiKey: () => '' });
  const capabilities = { catalog: () => '', schemas: async () => [{ name: 'mcp_fixture_0', description: 'Test external tool', parameters: { type: 'object' } }], call: async () => { calls++; throw new Error('Declined calls must never execute'); } };
  try {
    const runtime = new AgentRuntime({ store, cloud, capabilities, emit: () => {}, requestApproval: async () => { approvals++; return false; } });
    await runtime.runUnattended(bot.id, '调用测试服务');
    assert.equal(approvals, 1); assert.equal(calls, 0); assert.equal(requests, 2);
  } finally { cloud.dispose(); await new Promise(resolve => server.close(resolve)); }
});

test('云端盘点分两档（自有/共享），探针不读 ~/.claude，Bot 安装写入它的 .moyu', async () => {
  const store = new Store(path.join(root, String(++serial)));
  const bot = { ...store.settings.bots[0], workspaceId: 'workspace_cloud' };
  store.updateSettings({ bots: [bot] });
  const dirName = store.botDirName(bot.id);
  const probe = {
    shared: { mcp: [{ name: 'shared-mcp', transport: 'http', url: 'https://x.example/mcp' }], skills: [{ name: 'shared-skill', path: `/data/moyubot/.moyu/shared/skills/shared-skill` }] },
    bots: { [dirName]: { mcp: [{ name: 'bot-mcp', transport: 'stdio', command: 'node' }], skills: [{ name: 'bot-skill', path: `/data/moyubot/${dirName}/.moyu/skills/bot-skill` }] } },
  };
  const execs = [];
  const host = {
    status: () => ({ state: 'ready', lastTransitionAt: Date.now(), awakeMs: 0, wakeCount: 0 }),
    ensureAwake: async () => ({ id: 'm1', name: 'mock', state: 'running', autoSuspendAfterSeconds: null }),
    writeText: async () => {},
    exec: async (cmd) => {
      execs.push(cmd);
      const body = /python3|node -e/.test(cmd) && !cmd.includes('.migrated-from-claude') ? JSON.stringify(probe) : 'migrated:0,0';
      return { stdout: body + '\n', stderr: '', exitCode: 0, timedOut: false, truncated: false };
    },
  };
  const manager = new CapabilityManager(store, () => host);
  const inventory = await manager.inventoryCloud(true);
  assert.ok(inventory.servers.some(s => s.name === 'shared-mcp' && !s.botId && s.source.includes('共享')));
  const own = inventory.servers.find(s => s.name === 'bot-mcp');
  assert.equal(own.botId, bot.id, 'Bot 家目录里的 MCP 要标记归属');
  assert.equal(own.botDirName, dirName);
  assert.ok(own.source.includes('自有'));
  const ownSkill = inventory.skills.find(s => s.name === 'bot-skill');
  assert.equal(ownSkill.botId, bot.id);
  // 探针不得读 ~/.claude
  const probeCmd = execs.find(c => (c.includes('python3') || c.includes('node -e')) && !c.includes('.migrated-from-claude'));
  assert.ok(probeCmd && !probeCmd.includes('.claude'), '盘点探针不得出现 .claude');
  // Bot 在对话里安装 MCP → 写它自己的 .moyu/mcp.json（并先创建目录）
  await manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { demo: { command: 'node' } } }), { botDirName: dirName });
  const perBot = execs.find(c => c.includes('deployed:') && c.includes(dirName));
  assert.ok(perBot, '部署脚本必须指向该 Bot 家目录的 .moyu/mcp.json');
  assert.ok(perBot.includes('".moyu"') && perBot.includes('"mcp.json"'));
  assert.ok(perBot.includes('mkdirSync'), '家目录可能不存在，部署前要先创建');
  assert.ok(!perBot.includes('.claude'), 'moyubot 不得写入 ~/.claude');
  // 设置页导入（不带 bot）→ 写 .moyu/shared/mcp.json，同样不碰 ~/.claude
  await manager.importMcp('workspace_cloud', JSON.stringify({ mcpServers: { demo2: { command: 'node' } } }));
  const shared = execs.find(c => c.includes('deployed:') && c.includes('"shared"'));
  assert.ok(shared && shared.includes('".moyu"'), '共享部署写 .moyu/shared/mcp.json');
  assert.ok(!shared.includes('.claude'), '共享部署不得写 ~/.claude');
  await manager.dispose();
});

test('一次性迁移：云机 claude 的 MCP/技能复制进 .moyu/shared，之后探针不再读 ~/.claude', async () => {
  const store = new Store(path.join(root, String(++serial)));
  const bot = { ...store.settings.bots[0], workspaceId: 'workspace_cloud' };
  store.updateSettings({ bots: [bot] });
  const execs = [];
  const host = {
    status: () => ({ state: 'ready', lastTransitionAt: Date.now(), awakeMs: 0, wakeCount: 0 }),
    ensureAwake: async () => ({ id: 'm1', name: 'mock', state: 'running', autoSuspendAfterSeconds: null }),
    writeText: async () => {},
    exec: async (cmd) => {
      execs.push(cmd);
      const body = (cmd.includes('python3') || cmd.includes('node -e')) && !cmd.includes('.migrated-from-claude') ? JSON.stringify({ shared: { mcp: [{ name: 'migrated-mcp', transport: 'http', url: 'https://m.example/mcp' }], skills: [] }, bots: {} }) : 'migrated:2,26';
      return { stdout: body + '\n', stderr: '', exitCode: 0, timedOut: false, truncated: false };
    },
  };
  const manager = new CapabilityManager(store, () => host);
  const inventory = await manager.inventoryCloud(true);
  const migration = execs.find(c => c.includes('.migrated-from-claude'));
  assert.ok(migration, '必须先跑迁移脚本');
  assert.ok(migration.includes('.claude.json'), '迁移读取云机 claude 的 mcpServers');
  assert.ok(migration.includes('cpSync'), '迁移复制技能目录');
  assert.ok(migration.includes('...(conf.mcpServers||{})'), '已有 .moyu 条目优先，不被 claude 覆盖');
  // 迁移成功后：清单里是 .moyu/shared 的内容，探针脚本不再含 .claude
  assert.ok(inventory.servers.some(s => s.name === 'migrated-mcp' && s.source.includes('共享')));
  const probeCmd = execs.find(c => c.includes('const out={shared'));
  assert.ok(probeCmd && !probeCmd.includes('.claude'), '迁移后的探针不读 ~/.claude');
  await manager.dispose();
});

test('persisted pre-moyu entries (claude-sourced) stay hidden until a fresh .moyu probe', async () => {
  const store = new Store(path.join(root, String(++serial)));
  store.writeCloudInventory({
    at: Date.now() - 60_000,
    servers: [{ id: 'claude-mcp-0', name: 'old', transport: 'http', url: 'https://x.example/mcp', source: 'claude（外部）' }],
    skills: [{ id: 'claude-skill-0', name: 'old-skill', path: '/root/.claude/skills/old-skill', source: '~/.claude/skills' }],
  });
  const host = {
    status: () => ({ state: 'suspended' }),
    ensureAwake: async () => ({ id: 'fixture' }),
    writeText: async () => {},
    exec: async () => ({ stdout: '', stderr: 'offline', exitCode: 1, timedOut: false }),
  };
  const manager = new CapabilityManager(store, () => host);
  const offline = await manager.inventoryCloud();
  assert.equal(offline.servers.length, 0, '迁移前的 claude 条目不应再展示');
  assert.equal(offline.skills.length, 0, '迁移前的 ~/.claude 技能不应再展示');
  await manager.dispose();
});
