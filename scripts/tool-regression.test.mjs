import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, TOOL_SCHEMAS, runTool, LocalHost, CloudHost } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.work', 'tool-regression', String(Date.now()));
let serial = 0;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 每个用例一个干净的 Store + 工作区 + 假 ComputerHost，互不污染。 */
function makeCtx(options = {}) {
  const dir = path.join(root, String(++serial));
  const workspaceDir = path.join(dir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const store = new Store(dir);
  const settings = store.getSettings();
  // 用一个"全工具" Bot：显式列全 TOOL_SCHEMAS 名字（含默认被排除的 install_*），让每个工具都过 toolNamesFor 门禁。
  const bot = { ...settings.bots[0], model: 'test-model', workspaceId: 'workspace_cloud', tools: TOOL_SCHEMAS.map((tool) => tool.name) };
  store.updateSettings({ bots: [bot] });
  const conversationId = store.botConversation(bot.id).id;
  const writes = [];
  const host = {
    getSettings: () => ({ workspaceDir, machineName: 'mock-cloud', remoteWorkspaceDir: '/data/moyubot' }),
    beginTask() {}, endTask() {}, touch() {}, armIdleIfNeeded() {},
    status: () => ({ state: 'running' }),
    control: { acquire: async () => () => {} },
    exec: async (cmd) => ({ stdout: `ran<${cmd}>`, stderr: '', exitCode: 0, timedOut: false }),
    readText: async (p) => `content-of:${p}`,
    writeText: async (p, c) => { writes.push([p, c]); },
    desktopAction: async (a) => ({ text: `desktop:${a.action}`, screenshot: PNG }),
  };
  const ctx = {
    bot,
    cloud: host,
    workspaceDir,
    imageApiKey: '',
    remember: (text, pinned) => { const fact = store.addMemory(bot.id, text, pinned); return { id: fact.id }; },
    recall: (query) => store.listMemories(bot.id).filter((m) => m.text.toLowerCase().includes(query.toLowerCase())).map((m) => m.text),
    createSchedule: (input) => store.createSchedule(bot.id, input),
    listTasks: (includeClosed) => store.listSchedules().filter((t) => t.botId === bot.id && (includeClosed || !t.closedAt && !t.completedAt)),
    updateTask: (id, patch) => store.updateSchedule(bot.id, id, patch),
    imageGenerator: async () => ({ bytes: PNG, mimeType: 'image/png' }),
    emitStatus() {},
    setGoal: (objective) => store.setGoal({ conversationId, botId: bot.id, objective }),
    updateGoal: (patch) => store.updateGoal(conversationId, patch),
    writeTodos: (items) => { store.writeTodos(conversationId, bot.id, items); },
    askUser: async (question) => options.askAnswer ?? '用户的选择：A（本地测试注入）',
    spawnAgents: async (callId, tasks) => tasks.map((task) => ({ task, ok: true, text: `子代理结论：<${task}>` })),
    runScript: async (callId, script, args, write) => ({ result: 'workflow-ok', agents: 2, phases: ['采集', '汇总'], seconds: 1 }),
    installMcp: async () => ({ target: 'local', names: ['demo-mcp'] }),
    installSkill: async () => ({ target: 'local', name: 'demo-skill' }),
    signal: new AbortController().signal,
    ...options.ctx,
  };
  return { ctx, store, bot, conversationId, workspaceDir, writes };
}

const call = (name, args) => ({ id: `c-${name}`, name, arguments: args });

test('TOOL_SCHEMAS 恰好 25 个内置工具', () => {
  assert.equal(TOOL_SCHEMAS.length, 25);
});

// —— 云端三件套 + 桌面 ——
test('cloud_exec 执行并回传 stdout', async () => {
  const { ctx } = makeCtx();
  const r = await runTool(call('cloud_exec', { cmd: 'ls' }), ctx);
  assert.equal(r.ok, true, r.summary);
  assert.match(r.detail, /ran<ls>/);
});
test('cloud_exec 非零退出码记为失败', async () => {
  const f = makeCtx();
  f.ctx.cloud.exec = async () => ({ stdout: '', stderr: 'boom', exitCode: 3, timedOut: false });
  const r = await runTool(call('cloud_exec', { cmd: 'false' }), f.ctx);
  assert.equal(r.ok, false);
  assert.match(r.summary, /退出码 3/);
});
test('cloud_read 读到内容', async () => {
  const { ctx } = makeCtx();
  const r = await runTool(call('cloud_read', { path: '/data/x.txt' }), ctx);
  assert.equal(r.ok, true);
  assert.match(r.detail, /content-of:\/data\/x.txt/);
});
test('cloud_write 真的写入主机', async () => {
  const { ctx, writes } = makeCtx();
  const r = await runTool(call('cloud_write', { path: '/data/a.txt', content: 'hello' }), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(writes, [['/data/a.txt', 'hello']]);
});
test('desktop_action 保存截图为产物', async () => {
  const { ctx, workspaceDir } = makeCtx();
  const r = await runTool(call('desktop_action', { action: 'screenshot' }), ctx);
  assert.equal(r.ok, true);
  assert.ok(r.artifactPath?.startsWith('images/'));
  assert.ok(fs.existsSync(path.join(workspaceDir, r.artifactPath)));
});

// —— 图像 / 记忆 ——
test('generate_image 落盘到 images/', async () => {
  const { ctx, workspaceDir } = makeCtx();
  const r = await runTool(call('generate_image', { prompt: '一只鲸鱼' }), ctx);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(workspaceDir, r.artifactPath)));
});
test('remember + recall 往返', async () => {
  const { ctx, store, bot } = makeCtx();
  assert.equal((await runTool(call('remember', { text: '用户偏好中文', pinned: true }), ctx)).ok, true);
  const found = await runTool(call('recall', { query: '中文' }), ctx);
  assert.equal(found.ok, true);
  assert.match(found.detail, /用户偏好中文/);
});

// —— 定时任务三件套 ——
test('schedule_task → list_tasks → update_task 全链', async () => {
  const { ctx } = makeCtx();
  const created = await runTool(call('schedule_task', { prompt: '每日晨报', title: '晨报', cron: '0 9 * * *' }), ctx);
  assert.equal(created.ok, true, created.summary);
  const listed = await runTool(call('list_tasks', {}), ctx);
  assert.equal(listed.ok, true);
  assert.match(listed.summary, /1 个任务/);
  const id = JSON.parse(listed.detail)[0].id;
  const paused = await runTool(call('update_task', { taskId: id, action: 'pause' }), ctx);
  assert.equal(paused.ok, true, paused.summary);
});

// —— 联网两件套（注入假 fetch，离线可重跑）——
test('web_fetch 抓取并解析正文', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '<html><body><h1>鲸鱼报告</h1><script>x=1</script></body></html>' });
  try {
    const { ctx } = makeCtx();
    const r = await runTool(call('web_fetch', { url: 'https://example.com/report' }), ctx);
    assert.equal(r.ok, true, r.summary);
    assert.match(r.detail, /鲸鱼报告/);
    assert.ok(!r.detail.includes('x=1'), 'script 内容应被剔除');
  } finally { globalThis.fetch = original; }
});
test('web_fetch 拒绝内网与 http', async () => {
  const { ctx } = makeCtx();
  assert.equal((await runTool(call('web_fetch', { url: 'http://example.com' }), ctx)).ok, false);
  assert.equal((await runTool(call('web_fetch', { url: 'https://127.0.0.1/x' }), ctx)).ok, false);
});
test('web_search 归一化为统一命中结构', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ organic: [{ title: 'DeepSeek', link: 'https://x.com/a', snippet: 'desc' }] }) });
  try {
    const { ctx } = makeCtx();
    ctx.webSearch = { provider: 'serper', apiKey: 'test-key' };
    const r = await runTool(call('web_search', { query: 'deepseek', count: 3 }), ctx);
    assert.equal(r.ok, true, r.summary);
    assert.match(r.detail, /DeepSeek/);
    assert.match(r.detail, /https:\/\/x.com\/a/);
  } finally { globalThis.fetch = original; }
});

// —— 安装两件套 ——
test('install_mcp 安装并回报绑定', async () => {
  const { ctx } = makeCtx();
  const r = await runTool(call('install_mcp', { json: JSON.stringify({ mcpServers: { demo: { url: 'https://m.example.com/mcp' } } }) }), ctx);
  assert.equal(r.ok, true, r.summary);
  assert.match(r.summary, /demo-mcp/);
});
test('install_skill 需工作区内且有 SKILL.md', async () => {
  const { ctx, workspaceDir } = makeCtx();
  const bad = await runTool(call('install_skill', { directory: '../../etc' }), ctx);
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /工作区/);
  const dir = path.join(workspaceDir, 'demo-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody');
  const ok = await runTool(call('install_skill', { directory: 'demo-skill' }), ctx);
  assert.equal(ok.ok, true, ok.summary);
});

// —— 目标 / 清单 / 提问 ——
test('set_goal → update_goal 生命周期', async () => {
  const { ctx, store, conversationId } = makeCtx();
  assert.equal((await runTool(call('set_goal', { objective: '重构登录模块，含测试' }), ctx)).ok, true);
  assert.equal(store.activeGoal(conversationId).status, 'active');
  const done = await runTool(call('update_goal', { status: 'complete', note: '已合并' }), ctx);
  assert.equal(done.ok, true);
  assert.equal(store.activeGoal(conversationId), undefined);
});
test('todo_write 整体替换清单', async () => {
  const { ctx, store, conversationId } = makeCtx();
  await runTool(call('todo_write', { todos: [{ content: 'A', done: false }, { content: 'B', done: false }] }), ctx);
  await runTool(call('todo_write', { todos: [{ content: 'A', done: true }] }), ctx);
  const list = store.listTodos(conversationId);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].done, true);
});
test('ask_user 拿到回答 / 被跳过', async () => {
  const answered = makeCtx();
  const ok = await runTool(call('ask_user', { question: '选 A 还是 B？' }), answered.ctx);
  assert.equal(ok.ok, true);
  assert.match(ok.summary, /用户已回答/);
  const skipped = makeCtx({ askAnswer: '   ' });
  const skip = await runTool(call('ask_user', { question: '随便' }), skipped.ctx);
  assert.equal(skip.ok, false);
  assert.match(skip.summary, /跳过/);
});

// —— 子代理 / 工作流 ——
test('spawn_agent 单发与并行', async () => {
  const { ctx } = makeCtx();
  const one = await runTool(call('spawn_agent', { task: '读 README' }), ctx);
  assert.equal(one.ok, true, one.summary);
  assert.match(one.detail, /子代理结论：<读 README>/);
  const many = await runTool(call('spawn_agent', { tasks: ['a', 'b'] }), ctx);
  assert.equal(many.ok, true);
  assert.match(many.summary, /2 个子智能体/);
});
test('run_script 汇总编排结果', async () => {
  const { ctx } = makeCtx();
  const r = await runTool(call('run_script', { script: 'return 1' }), ctx);
  assert.equal(r.ok, true);
  assert.match(r.summary, /2 个子代理/);
  assert.match(r.summary, /只读/);
  const w = await runTool(call('run_script', { script: 'return 1', write: true }), ctx);
  assert.match(w.summary, /完整权限/);
});

// —— 任务管理（tool-jobs）——
test('job_list 列出运行中任务', async () => {
  const f = makeCtx();
  f.ctx.listJobs = () => [{ conversationId: 'conv_x', kind: 'subagent', label: '子任务：读 README', seconds: 12 }];
  const r = await runTool(call('job_list', {}), f.ctx);
  assert.equal(r.ok, true);
  assert.match(r.summary, /1 个任务在运行/);
  assert.match(r.detail, /conv_x/);
  const empty = makeCtx();
  empty.ctx.listJobs = () => [];
  assert.match((await runTool(call('job_list', {}), empty.ctx)).summary, /没有正在运行/);
});
test('job_kill 停止运行中任务 / 不存在的拒绝', async () => {
  const f = makeCtx();
  let killed;
  f.ctx.killJob = (id) => { killed = id; return true; };
  const r = await runTool(call('job_kill', { id: 'conv_x' }), f.ctx);
  assert.equal(r.ok, true);
  assert.equal(killed, 'conv_x');
  const miss = makeCtx();
  miss.ctx.killJob = () => false;
  const r2 = await runTool(call('job_kill', { id: 'gone' }), miss.ctx);
  assert.equal(r2.ok, false);
});
// —— 子代理清单 / 续聊 / 分身 ——
test('subagent_list_agents 列出子代理线程', async () => {
  const f = makeCtx();
  f.ctx.listAgents = () => [{ conversationId: 'sub_1', task: '读源码', running: false, updatedAt: Date.now() }];
  const r = await runTool(call('subagent_list_agents', {}), f.ctx);
  assert.equal(r.ok, true);
  assert.match(r.detail, /sub_1/);
  assert.match(r.detail, /已结束/);
});
test('subagent_control send 续聊拿到新结论 / stop 停运行中的', async () => {
  const f = makeCtx();
  f.ctx.controlAgent = async (id, action, message) => ({ ok: true, text: `针对「${message}」的补充结论` });
  f.ctx.killJob = () => true;
  const sent = await runTool(call('subagent_control', { id: 'sub_1', action: 'send', message: '再查测试' }), f.ctx);
  assert.equal(sent.ok, true, sent.summary);
  assert.match(sent.detail, /补充结论/);
  const stopped = await runTool(call('subagent_control', { id: 'sub_1', action: 'stop' }), f.ctx);
  assert.equal(stopped.ok, true);
  const bad = await runTool(call('subagent_control', { id: 'sub_1', action: 'pause' }), f.ctx);
  assert.equal(bad.ok, false);
});
test('subagent_fork 分身返回结论与 id', async () => {
  const f = makeCtx();
  f.ctx.forkAgent = async (prompt) => ({ ok: true, conversationId: 'sub_9', text: `分身完成：${prompt}` });
  const r = await runTool(call('subagent_fork', { prompt: '顺着结论查边界情况' }), f.ctx);
  assert.equal(r.ok, true);
  assert.match(r.summary, /sub_9/);
  assert.match(r.detail, /分身完成/);
});

// —— 计划模式出口（第 21 个行为）——
test('exit_plan_mode 必须经批准才切执行', async () => {
  const denied = makeCtx({ ctx: { conversationMode: 'plan', requireApproval: async () => false } });
  const rejected = await runTool(call('exit_plan_mode', { plan: '先只读排查', steps: ['读日志'] }), denied.ctx);
  assert.equal(rejected.ok, false);
  assert.match(rejected.summary, /未批准/);

  let approved = false;
  const yes = makeCtx({ ctx: { conversationMode: 'plan', requireApproval: async () => true, approvePlan: () => { approved = true; } } });
  const r = await runTool(call('exit_plan_mode', { plan: '先只读排查', steps: ['读日志'] }), yes.ctx);
  assert.equal(r.ok, true, r.summary);
  assert.ok(approved, '批准后要回调落库');
});

test('未知工具被安全拒绝', async () => {
  const { ctx } = makeCtx();
  const r = await runTool(call('definitely_not_a_tool', {}), ctx);
  assert.equal(r.ok, false);
  assert.match(r.summary, /未知工具/);
});

test('botDirName：净化、同名避让、持久化', () => {
  const f = makeCtx();
  const name = f.store.botDirName(f.bot.id);
  assert.ok(name.length > 0 && !/[\\/:*?"<>|]/.test(name), name);
  assert.equal(f.store.getBot(f.bot.id).dirName, name, '首次推导要落盘，之后改名不影响目录');
  assert.equal(f.store.botDirName(f.bot.id), name, '再次调用必须稳定');
  f.store.upsertBot({ ...f.bot, id: 'bot_dup01', name: f.bot.name });
  assert.notEqual(f.store.botDirName('bot_dup01'), name, '同名 Bot 目录名必须避让');
  f.store.upsertBot({ ...f.bot, id: 'bot_weird1', name: 'a/b:c*?"<>|' });
  const weird = f.store.botDirName('bot_weird1');
  assert.ok(!/[\\/:*?"<>|]/.test(weird), `非法字符必须被净化：${weird}`);
});

test('每 Bot 工作目录：本地文件隔离 + cwd 锚定 + 云端目录拼接', async () => {
  const { LocalHost, CloudHost } = await import('../packages/core/dist/index.js');
  const dir = path.join(root, 'perbot-local');
  fs.mkdirSync(dir, { recursive: true });
  const host = new LocalHost({ workspaceDir: dir });
  await host.writeText('notes.md', 'A 的数据', '大肥鱼');
  await host.writeText('notes.md', 'B 的数据', '小龙娘');
  assert.equal(await host.readText('notes.md', '大肥鱼'), 'A 的数据');
  assert.equal(await host.readText('notes.md', '小龙娘'), 'B 的数据');
  assert.ok(fs.existsSync(path.join(dir, '大肥鱼', 'notes.md')), '文件必须落在 bot 自己的文件夹里');
  const pwd = await host.exec(process.platform === 'win32' ? '(Get-Location).Path' : 'pwd', { subDirectory: '大肥鱼' });
  assert.ok(pwd.stdout.includes('大肥鱼'), `命令 cwd 应锚定 bot 目录：${pwd.stdout.trim()}`);
  await assert.rejects(() => host.readText('notes.md'), '共享根不应看到 bot 目录里的同名文件');
  // 云端：mock pwd 回显 req.cwd，验证目录拼接
  const cloud = new CloudHost({ settings: { driver: 'mock', workspaceDir: dir, remoteWorkspaceDir: '/data/home/moyubot' }, apiKey: () => '' });
  try {
    const remote = await cloud.exec('pwd', { subDirectory: '大肥鱼' });
    assert.ok(remote.stdout.includes('/data/home/moyubot/大肥鱼'), `云端 cwd 应为 <root>/<botDir>：${remote.stdout.trim()}`);
  } finally { cloud.dispose(); }
});

test('每个内置 schema 工具都在回归表里被覆盖', async () => {
  // 兜底：防止将来加了新工具却忘记加回归。此测试枚举 TOOL_SCHEMAS，
  // 与上面手写用例覆盖到的名字对比（维护时在 covered 里补一项）。
  const covered = new Set(['cloud_exec', 'cloud_read', 'cloud_write', 'desktop_action', 'generate_image', 'remember', 'recall', 'schedule_task', 'list_tasks', 'update_task', 'web_fetch', 'web_search', 'install_mcp', 'install_skill', 'set_goal', 'update_goal', 'todo_write', 'ask_user', 'spawn_agent', 'run_script', 'job_list', 'job_kill', 'subagent_list_agents', 'subagent_control', 'subagent_fork']);
  const missing = TOOL_SCHEMAS.map((tool) => tool.name).filter((name) => !covered.has(name));
  assert.deepEqual(missing, [], `这些新工具还没有回归用例：${missing.join(', ')}`);
});
