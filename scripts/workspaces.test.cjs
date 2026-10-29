const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, LocalHost, CloudHost, AgentRuntime, runTool } = require('../packages/core/dist/index.js');
const temporary = (t) => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-workspaces-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; };

test('legacy migration backs up original data and keeps conversation identities', (t) => {
  const directory = temporary(t), original = new Store(directory);
  const bot = original.getSettings().bots[0], conversation = original.botConversation(bot.id);
  original.appendMessage(conversation.id, { id: 'history', role: 'user', content: '原始聊天', createdAt: Date.now() });
  original.addMemory(bot.id, '独立记忆');
  const legacy = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json')));
  delete legacy.workspaces; delete legacy.activeWorkspaceId; legacy.bots.forEach((item) => delete item.workspaceId);
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(legacy));
  const migrated = new Store(directory);
  assert.equal(migrated.getBot(bot.id).workspaceId, 'workspace_cloud');
  assert.equal(migrated.botConversation(bot.id).id, conversation.id);
  assert.equal(migrated.botConversation(bot.id).messages[0].content, '原始聊天');
  assert.ok(fs.existsSync(path.join(directory, 'backup-before-workspaces', 'conversations', conversation.id + '.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'backup-before-workspaces', 'settings.json'))).workspaces, undefined);
  assert.equal(new Store(directory).getSettings().workspaces.length, 2);
});

test('Bot groups, conversations, usage and memberships stay in their workspace', (t) => {
  const store = new Store(temporary(t)), cloud = store.getSettings().bots[0];
  const local = store.upsertBot({ ...cloud, id: 'local', workspaceId: 'workspace_local', name: '本地', sidebar: { group: '项目' } });
  store.updateBotMetadata(cloud.id, { sidebar: { group: '项目' } });
  store.updateBotGroup('项目', { type: 'rename', name: '本地项目' }, 'workspace_local');
  assert.equal(store.getBot(cloud.id).sidebar.group, '项目');
  assert.equal(store.getBot(local.id).sidebar.group, '本地项目');
  store.updateBotGroup('本地项目', { type: 'collapse', collapsed: true }, 'workspace_local');
  const reopened = new Store(store.dataDir);
  assert.deepEqual(reopened.listBotGroups('workspace_local'), [{ name: '本地项目', collapsed: true }]);
  assert.deepEqual(reopened.listBotGroups('workspace_cloud'), [{ name: '项目', collapsed: false }]);
  assert.throws(() => store.createGroup('不能混用', [cloud.id, local.id]), /跨工作区/);
  assert.throws(() => store.upsertBot({ ...local, workspaceId: 'workspace_cloud' }), /不能直接转移/);
  assert.equal(store.botConversation(local.id).workspaceId, 'workspace_local');
  for (const bot of [cloud, local]) store.usage.append({ id: bot.id, workspaceId: bot.workspaceId, createdAt: Date.now(), botId: bot.id, botName: bot.name, providerId: 'provider', providerName: 'provider', model: 'model', conversationId: 'c', purpose: 'chat', status: 'complete', usage: { promptTokens: 3, completionTokens: 2 } });
  const report = store.usage.query({ workspaceId: 'workspace_local', start: Date.now() - 10000, end: Date.now() + 10000, interval: 'hour' });
  assert.equal(report.totals.totalTokens, 5);
  assert.deepEqual(report.options.bots.map((item) => item.id), ['local']);
});

test('local execution uses the local folder, supports UTF-8, timeout and cancellation', async (t) => {
  const store = new Store(temporary(t)), folder = path.join(store.dataDir, 'local');
  fs.mkdirSync(folder);
  const host = new LocalHost({ ...store.getSettings().cloud, workspaceDir: folder });
  t.after(() => host.dispose());
  const result = await host.exec(process.platform === 'win32' ? 'Write-Output "本机输出"; (Get-Location).Path' : 'printf "本机输出\\n"; pwd');
  assert.equal(result.exitCode, 0); assert.match(result.stdout, /本机输出/); assert.ok(result.stdout.includes(folder));
  const failure = await host.exec(process.platform === 'win32' ? 'exit 7' : 'exit 7');
  assert.equal(failure.exitCode, 7);
  const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10';
  let started = Date.now();
  const timed = await host.exec(command, { timeoutSeconds: 1 });
  assert.equal(timed.timedOut, true);
  assert.ok(Date.now() - started < 8000, 'Timeout must stop the process promptly');
  const controller = new AbortController();
  started = Date.now();
  const pending = host.exec(command, { signal: controller.signal });
  setTimeout(() => controller.abort(), 400);
  await assert.rejects(pending, /已停止/);
  assert.ok(Date.now() - started < 8000, 'Cancellation must stop the process promptly');
  assert.equal(host.status().state, 'ready');
});

test('a local Bot keeps its executor and memories while the active workspace changes', async (t) => {
  const store = new Store(temporary(t)), folder = path.join(store.dataDir, 'local'); fs.mkdirSync(folder);
  const cloudBot = store.getSettings().bots[0];
  const bot = store.upsertBot({ ...cloudBot, id: 'local-runtime', workspaceId: 'workspace_local', tools: ['cloud_exec'], approvalPolicy: 'ask' });
  store.addMemory(bot.id, '本地独立记忆'); store.addMemory(cloudBot.id, '云端私有记忆');
  const local = new LocalHost({ ...store.getSettings().cloud, workspaceDir: folder });
  const cloud = new CloudHost({ settings: { ...store.getSettings().cloud, driver: 'mock' }, apiKey: () => '' });
  t.after(() => { local.dispose(); cloud.dispose(); });
  cloud.exec = cloud.ensureAwake = async () => { throw new Error('Local Bot must not access the cloud'); };
  let calls = 0, approvals = 0;
  const events = [];
  const runtime = new AgentRuntime({ store, cloud, computers: { workspace_local: local }, emit: (event) => events.push(event), requestApproval: async () => { approvals++; return true; } });
  runtime.providerFor = () => ({ provider: { kind: 'openai', async chat(args, handlers) {
    assert.match(args.system, /本地独立记忆/); assert.ok(!args.system.includes('云端私有记忆'));
    assert.match(args.system, /PowerShell/);
    if (!calls++) {
      store.updateSettings({ activeWorkspaceId: 'workspace_cloud' });
      handlers.onToolCall({ id: 'local-run', name: 'cloud_exec', arguments: { cmd: process.platform === 'win32' ? 'Write-Output "local-agent-success"' : 'printf local-agent-success' } });
      return { finishReason: 'tool_calls' };
    }
    handlers.onText('本机已完成'); return { finishReason: 'stop' };
  } } });
  const result = await runtime.send({ botId: bot.id, text: '检查本机' });
  const deadline = Date.now() + 15000;
  while (runtime.isRunning(result.conversationId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.isRunning(result.conversationId), false);
  assert.equal(approvals, 1);
  const conversation = store.getConversation(result.conversationId);
  assert.match(conversation.messages.at(-1).toolResults[0].detail, /local-agent-success/);
  assert.equal(conversation.messages.at(-1).content, '本机已完成');
  assert.equal(events.some((event) => event.type === 'cloud'), false);
  assert.equal(store.botConversation(cloudBot.id).messages.length, 0);
});

test('local file tools reject directory traversal and junction escapes', async (t) => {
  const directory = temporary(t), store = new Store(directory), folder = path.join(directory, 'local'), outside = path.join(directory, 'outside');
  fs.mkdirSync(folder); fs.mkdirSync(outside);
  const host = new LocalHost({ ...store.getSettings().cloud, workspaceDir: folder });
  await host.writeText('notes/a.txt', '本地文件');
  assert.equal(await host.readText('notes/a.txt'), '本地文件');
  await assert.rejects(host.writeText('../outside/leak.txt', 'bad'), /工作区/);
  fs.symlinkSync(outside, path.join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(host.writeText('link/leak.txt', 'bad'), /工作区/);
  assert.equal(fs.existsSync(path.join(outside, 'leak.txt')), false);
});

test('local API image generation never wakes the cloud, and commands respect approval', async (t) => {
  const store = new Store(temporary(t)), folder = path.join(store.dataDir, 'local'); fs.mkdirSync(folder);
  const bot = { ...store.getSettings().bots[0], workspaceId: 'workspace_local' };
  const host = new LocalHost({ ...store.getSettings().cloud, workspaceDir: folder });
  host.ensureAwake = () => { throw new Error('should not wake'); };
  const context = { bot, cloud: host, workspaceDir: folder, imageGenerator: async () => ({ bytes: new Uint8Array([1, 2]), mimeType: 'image/png' }), emitStatus() {} };
  const image = await runTool({ id: 'image', name: 'generate_image', arguments: { prompt: 'test' } }, context);
  assert.equal(image.ok, true);
  const result = await runTool({ id: 'command', name: 'cloud_exec', arguments: { cmd: 'exit 0' } }, { ...context, requestApproval: async () => false });
  assert.equal(result.ok, false); assert.match(result.summary, /拒绝/);
});

test('remote directory settings persist without changing local artifact or workspace folders', (t) => {
  const store = new Store(temporary(t));
  const original = store.getSettings();
  const artifacts = original.cloud.workspaceDir, local = original.workspaces.find((item) => item.kind === 'local').directory;
  store.updateSettings({ cloud: { remoteWorkspaceDir: '/data/team files/project/../current/' } });
  const saved = new Store(store.dataDir).getSettings();
  assert.equal(saved.cloud.remoteWorkspaceDir, '/data/team files/current');
  assert.equal(saved.cloud.workspaceDir, artifacts);
  assert.equal(saved.workspaces.find((item) => item.kind === 'local').directory, local);
  for (const invalid of ['relative', 'D:\\work', '/data/a\nb', '/data/\x00bad', '']) assert.throws(() => store.updateSettings({ cloud: { remoteWorkspaceDir: invalid } }), /绝对路径/);
  assert.equal(store.getSettings().cloud.remoteWorkspaceDir, '/data/team files/current');
});

test('cloud commands and relative file tools use the selected remote directory and preserve failures', async (t) => {
  const store = new Store(temporary(t)), requests = [], reads = [], writes = [];
  const directory = "/data/client's work";
  const cloud = new CloudHost({ settings: { ...store.getSettings().cloud, driver: 'mock', remoteWorkspaceDir: directory }, apiKey: () => '' });
  t.after(() => cloud.dispose());
  const driver = {
    async exec(id, request) { requests.push(request); return { stdout: request.cmd === 'pwd' ? request.cwd : '', stderr: '', exitCode: request.cmd === 'exit 7' ? 7 : 0, timedOut: false, truncated: false }; },
    async readFile(id, file) { reads.push(file); return Buffer.from('remote file'); },
    async writeFile(id, file, content) { writes.push([file, content]); },
  };
  Object.defineProperty(cloud, 'driver', { get: () => driver });
  cloud.ensureAwake = async () => ({ id: 'test-cloud' });
  assert.equal((await cloud.exec('pwd')).stdout, directory);
  assert.equal(requests[0].cmd, "mkdir -p -- '/data/client'\\''s work'");
  assert.equal(requests[1].cwd, directory);
  assert.equal((await cloud.exec('exit 7')).exitCode, 7);
  assert.equal(requests.length, 3, 'Create the selected directory once per machine');
  assert.equal(await cloud.readText('notes/a.txt'), 'remote file');
  await cloud.readBytes('/etc/os-release');
  await cloud.writeText('notes/new.txt', 'hello');
  assert.deepEqual(reads, [directory + '/notes/a.txt', '/etc/os-release']);
  assert.deepEqual(writes, [[directory + '/notes/new.txt', 'hello']]);
  cloud.settings = { ...cloud.getSettings(), remoteWorkspaceDir: '/data/another' };
  assert.equal((await cloud.exec('pwd')).stdout, '/data/another');
  assert.equal(requests.at(-1).cwd, '/data/another');
});
