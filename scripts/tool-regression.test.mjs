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
    writeBytes: async (p, bytes, sub) => { const target = path.join(workspaceDir, sub ? path.join(sub, p) : p); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); writes.push([target, bytes.length]); },
    readBytes: async (p, sub) => { const target = path.join(workspaceDir, sub ? path.join(sub, p) : p); return { bytes: new Uint8Array(fs.readFileSync(target)), machineId: 'mock' }; },
    desktopAction: async (a) => ({ text: `desktop:${a.action}`, screenshot: PNG }),
  };
  const ctx = {
    bot,
    cloud: host,
    workspaceDir,
    imageApiKey: '',
    remember: (text, pinned) => { const fact = store.addMemory(bot.id, text, pinned); return { id: fact.id }; },
    recall: (query) => store.listMemories(bot.id).filter((m) => m.text.toLowerCase().includes(query.toLowerCase())).map((m) => m.text),
    searchHistory: (query, options) => store.searchHistory(query, { ...options, conversationId: options?.conversationId ?? conversationId }),
    listProjects: () => store.listProjects(bot.id),
    getProject: (name) => store.getProject(bot.id, name),
    upsertProject: (patch) => store.upsertProject(bot.id, patch),
    setActiveProject: (name) => store.setActiveProject(bot.id, name),
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

test('TOOL_SCHEMAS 至少包含 25 个内置工具', () => {
  assert.ok(TOOL_SCHEMAS.length >= 25, `内置工具数量异常：${TOOL_SCHEMAS.length}`);
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

test('history_search 检索原始对话', async () => {
  const { ctx, store, bot, conversationId } = makeCtx();
  store.appendMessage(conversationId, { id: 'hist-1', role: 'user', content: '上次讨论过为什么放弃那个 API', createdAt: Date.now() });
  store.appendMessage(conversationId, { id: 'hist-2', role: 'assistant', content: '因为中转商经常 502，决定换 DeepSeek 直连。', createdAt: Date.now() + 1 });
  const result = await runTool(call('history_search', { query: '放弃 API' }), ctx);
  assert.equal(result.ok, true);
  assert.match(result.detail, /放弃那个 API|助手/);
  assert.match(result.summary, /找到/);
});

test('project 三件套：upsert → list → switch', async () => {
  const { ctx } = makeCtx();
  const created = await runTool(call('project_upsert', { name: 'MoyuBot 记忆改造', currentGoal: '完成分层记忆', nextActions: ['Project State', 'History Search'] }), ctx);
  assert.equal(created.ok, true, created.summary);
  assert.match(created.summary, /已保存/);
  const listed = await runTool(call('project_list', {}), ctx);
  assert.equal(listed.ok, true);
  assert.match(listed.detail, /MoyuBot 记忆改造/);
  const switched = await runTool(call('project_switch', { name: 'MoyuBot 记忆改造' }), ctx);
  assert.equal(switched.ok, true);
  assert.match(switched.summary, /已聚焦/);
  // 切换不存在项目应清晰报错
  const missing = await runTool(call('project_switch', { name: '不存在' }), ctx);
  assert.equal(missing.ok, false);
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

test('Office 工具：结构化输入生成三种格式并写入工作区', async () => {
  const f = makeCtx();
  // makeCtx 不注入 makeOffice：这里直接绑到本机生成器，验证 office-router + office 的完整链路。
  const officeRouter = await import('../packages/core/dist/office-router.js');
  f.ctx.makeOffice = (request) => officeRouter.buildOfficeLocally(f.ctx.cloud, request, '');
  const calls = [
    { name: 'make_spreadsheet', args: { name: '报表', sheets: [{ name: '汇总', title: '销售', columns: [{ header: '月份' }, { header: '金额' }], rows: [['1月', 12000]] }] } },
    { name: 'make_document', args: { name: '周报', title: '周报', blocks: [{ type: 'heading1', text: '进展' }, { type: 'paragraph', text: '正文' }] } },
    { name: 'make_slides', args: { name: '汇报', title: '封面', slides: [{ title: '背景', bullets: ['要点'] }] } },
  ];
  for (const item of calls) {
    const result = await runTool(call(item.name, item.args), f.ctx);
    assert.equal(result.ok, true, item.name + ': ' + result.summary);
  }
  const walk = (current, out) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const full = path.join(current, entry.name); if (entry.isDirectory()) walk(full, out); else out.push(full); } };
  const files = []; walk(f.workspaceDir, files);
  for (const ext of ['xlsx', 'docx', 'pptx']) {
    const hit = files.filter((file) => file.endsWith('.' + ext));
    assert.ok(hit.length > 0, '没有生成 .' + ext);
    assert.equal(fs.readFileSync(hit[0]).slice(0, 2).toString(), 'PK', '.' + ext + ' 不是合法 zip');
  }
});
test('apply_patch 一条补丁改多个文件，read_files 批量读回', async () => {
  const f = makeCtx();
  const router = await import('../packages/core/dist/patch.js');
  f.ctx.applyPatch = async (patchText) => {
    const parsed = router.parsePatch(patchText);
    if (parsed.error) return { ok: false, applied: [], error: parsed.error };
    const applied = [];
    for (const change of parsed.changes) {
      const target = path.join(f.workspaceDir, change.path);
      if (change.kind === 'add') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, (change.addLines ?? []).join('\n') + '\n'); }
      else if (change.kind === 'delete') fs.rmSync(target, { force: true });
      else {
        let text = fs.readFileSync(target, 'utf8');
        for (const hunk of change.hunks) { const next = router.applyHunk(text, hunk); if (next.error) return { ok: false, applied, error: next.error }; text = next.text; }
        fs.writeFileSync(target, text);
      }
      applied.push({ kind: change.kind, path: change.path });
    }
    return { ok: true, applied };
  };
  f.ctx.readFiles = async (paths) => paths.map((p) => ({ path: p, text: fs.readFileSync(path.join(f.workspaceDir, p), 'utf8') }));
  fs.writeFileSync(path.join(f.workspaceDir, 'a.ts'), 'export const a = 1\nexport const b = 2\n');
  const patch = ['*** Begin Patch', '*** Update File: a.ts', '@@', ' export const a = 1', '-export const b = 2', '+export const b = 20', '*** Add File: c.ts', '+export const c = 3', '*** End Patch'].join('\n');
  const applied = await runTool(call('apply_patch', { input: patch }), f.ctx);
  assert.equal(applied.ok, true, applied.summary);
  assert.match(applied.summary, /2 个文件/);
  const read = await runTool(call('read_files', { paths: ['a.ts', 'c.ts'] }), f.ctx);
  assert.equal(read.ok, true, read.summary);
  assert.match(read.detail, /export const b = 20/);
  assert.match(read.detail, /export const c = 3/);
});

test('apply_patch 匹配失败时不静默写入', async () => {
  const f = makeCtx();
  const router = await import('../packages/core/dist/patch.js');
  const next = router.applyHunk('only line\n', { raw: ['-missing line', '+replacement'], context: undefined, remove: ['missing line'], add: ['replacement'] });
  assert.ok(next.error, '找不到原文必须报错');
  assert.match(next.error, /没匹配上/);
});
test('每个内置 schema 工具都在回归表里被覆盖', async () => {
  // 兜底：防止将来加了新工具却忘记加回归。此测试枚举 TOOL_SCHEMAS，
  // 与上面手写用例覆盖到的名字对比（维护时在 covered 里补一项）。
  const covered = new Set(['cloud_exec', 'cloud_read', 'cloud_write', 'desktop_action', 'generate_image', 'remember', 'recall', 'history_search', 'project_list', 'project_upsert', 'project_switch', 'schedule_task', 'list_tasks', 'update_task', 'web_fetch', 'web_search', 'install_mcp', 'install_skill', 'set_goal', 'update_goal', 'todo_write', 'ask_user', 'spawn_agent', 'run_script', 'job_list', 'job_kill', 'subagent_list_agents', 'subagent_control', 'subagent_fork', 'make_spreadsheet', 'make_document', 'make_slides', 'apply_patch', 'read_files', 'local_read_file', 'local_list_files', 'local_write_file', 'cloud_stage_file', 'deliver_file']);
  const missing = TOOL_SCHEMAS.map((tool) => tool.name).filter((name) => !covered.has(name));
  assert.deepEqual(missing, [], `这些新工具还没有回归用例：${missing.join(', ')}`);
});

test('Office 云机链路：生成的启动脚本在本机 node 上真能跑通', async () => {
  const f = makeCtx();
  const officeRouter = await import('../packages/core/dist/office-router.js');
  const { execFileSync } = await import('node:child_process');
  const inDir = (p, sub) => path.join(f.workspaceDir, sub ? path.join(sub, p) : p);
  const uploads = [];
  const host = {
    getSettings: () => ({ workspaceDir: f.workspaceDir, machineName: 'mock-cloud', remoteWorkspaceDir: '/data/moyubot' }),
    beginTask() {}, endTask() {}, touch() {}, armIdleIfNeeded() {},
    status: () => ({ state: 'running' }),
    control: { acquire: async () => () => {} },
    writeText: async (p, content, sub) => {
      const target = inDir(p, sub);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      uploads.push([p, content.length]);
    },
    writeBytes: async (p, bytes, sub) => {
      const target = inDir(p, sub);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    },
    readText: async (p, sub) => fs.readFileSync(inDir(p, sub), 'utf8'),
    readBytes: async (p, sub) => ({ bytes: new Uint8Array(fs.readFileSync(inDir(p, sub))), machineId: 'mock' }),
    // 云机 exec 的替身：把生成器下发的那条命令原样交给本机 node 执行。
    exec: async (cmd, options = {}) => {
      const cwd = options.subDirectory ? path.join(f.workspaceDir, options.subDirectory) : f.workspaceDir;
      if (cmd.startsWith('rm -f --')) {
        const officeDir = path.join(cwd, '_office');
        if (fs.existsSync(officeDir)) {
          for (const name of fs.readdirSync(officeDir)) {
            if (/^(payload-.*\.json|build-.*\.cjs|runtime-.*\.cjs)$/.test(name)) fs.unlinkSync(path.join(officeDir, name));
          }
        }
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      }
      const match = /^node "(.+)" "(.+)" "(.+)"$/.exec(cmd);
      if (!match) return { stdout: '', stderr: 'unsupported: ' + cmd, exitCode: 127, timedOut: false };
      try {
        const stdout = execFileSync(process.execPath, [match[1], match[2], match[3]], { cwd, encoding: 'utf8' });
        return { stdout, stderr: '', exitCode: 0, timedOut: false };
      } catch (error) {
        return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message), exitCode: error.status ?? 1, timedOut: false };
      }
    },
  };

  const request = { kind: 'docx', name: '云周报', directory: '', document: { title: '周报', blocks: [{ type: 'paragraph', text: '正文' }] } };
  const first = await officeRouter.buildOfficeOnCloud(host, request, 'bot-x');
  assert.equal(first.ok, true, '云机生成应成功：' + (first.error ?? ''));
  assert.equal(first.machine, 'cloud');
  assert.ok((first.bytes ?? 0) > 0, '应回报字节数，避免再整份下载回来');

  const produced = path.join(f.workspaceDir, 'bot-x', '云周报.docx');
  assert.equal(fs.readFileSync(produced).subarray(0, 2).toString(), 'PK', 'docx 不是合法 zip');

  // payload 里有用户文档全文，不能在云机上留存
  const officeDir = path.join(f.workspaceDir, 'bot-x', '_office');
  const leftovers = fs.existsSync(officeDir) ? fs.readdirSync(officeDir).filter((n) => n.startsWith('payload-') || n.startsWith('build-')) : [];
  assert.deepEqual(leftovers, [], '云机上残留了 payload / 启动脚本');

  // 运行时按内容哈希复用：第二次生成不再上传 3 MB
  const runtimeUploads = () => uploads.filter(([p]) => p === '_office/runtime.cjs').length;
  assert.equal(runtimeUploads(), 1, '首次应上传一次运行时');
  const second = await officeRouter.buildOfficeOnCloud(host, request, 'bot-x');
  assert.equal(second.ok, true, '第二次也应成功：' + (second.error ?? ''));
  assert.equal(runtimeUploads(), 1, '运行时不应重复上传');

  // 目录逃逸必须挡住（模型可以自由编 directory）
  const evil = await officeRouter.buildOfficeOnCloud(host, { ...request, directory: '../../etc' }, 'bot-x');
  assert.equal(evil.ok, false, '目录逃逸应被拒绝');
  assert.match(evil.error ?? '', /\.\./);
});

test('install_skill：云 Bot 传云机绝对路径时不再被本地工作区校验挡住', async () => {
  const seen = [];
  const f = makeCtx({ ctx: { installSkill: async (target) => { seen.push(target); return { target: 'cloud', name: 'seedance-2-prompts' }; } } });
  const result = await runTool({ id: 'c-skill', name: 'install_skill', arguments: { directory: '/data/home/moyubot/skills/seedance-2-prompts' } }, f.ctx);
  assert.equal(result.ok, true, '云机路径应被接受：' + result.summary);
  assert.deepEqual(seen, ['/data/home/moyubot/skills/seedance-2-prompts'], '必须把云机路径原样交给 installSkill');
  assert.match(result.summary, /云电脑/);

  // 本地工作区之外的路径仍然要挡住（本机安全边界不能松）
  const outside = await runTool({ id: 'c-skill-2', name: 'install_skill', arguments: { directory: '../../../etc' } }, f.ctx);
  assert.equal(outside.ok, false, '相对路径逃逸仍应被拒');
  assert.match(outside.summary, /工作区内/);
});
