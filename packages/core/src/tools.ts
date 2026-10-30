import fs from 'node:fs';
import path from 'node:path';
import type { Bot, CloudStatus, Schedule, ScheduleInput, ScheduleUpdate, ToolCall, ToolResult, WebSearchSettings } from './types';
import type { ComputerHost } from './cloud';
import type { GeneratedImage } from './providers';
import { newId, summarize, truncate } from './util';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'desktop_action',
    description: '操作共享云电脑的真实桌面。支持打开网页、截图、点击、输入、按键和滚动。先截图确认位置，不猜坐标；手动接管期间自动等待。截图若模型不能识别，请使用 cloud_exec 配合浏览器 DOM 自动化，不声称看到了画面。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['open', 'screenshot', 'click', 'type', 'press', 'scroll'] },
      url: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' },
      button: { type: 'string', enum: ['left', 'middle', 'right'] }, double: { type: 'boolean' },
      text: { type: 'string' }, keys: { type: 'array', items: { type: 'string' }, description: 'X11 按键，例如 ["ctrl", "l"]、["Return"]' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' },
    }, required: ['action'] },
  },
  {
    name: 'cloud_exec',
    description:
      '在共享云电脑（Linux, 4 vCPU / 8 GB）里执行 shell 命令。云电脑平时休眠，调用这个工具会自动唤醒它。用于安装依赖、运行脚本、处理文件、长任务。',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: '要执行的 bash 命令，例如 "python3 --version"' },
        timeoutSeconds: { type: 'integer', description: '超时秒数（默认 120，最大 900）' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'cloud_read',
    description: '读取云电脑上的文本文件内容。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '绝对路径，例如 /data/moyubot/notes.md' } },
      required: ['path'],
    },
  },
  {
    name: 'cloud_write',
    description: '把文本写入云电脑上的文件（自动创建父目录）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'generate_image',
    description: '通过当前 Bot 供应商的图像 API 生成图片，无需唤醒云电脑。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述，尽可能具体' },
        aspect: {
          type: 'string',
          enum: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
          description: '画面比例，默认沿用 Bot 设置',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'remember',
    description: '把这个 Bot 需要长期记住的事实写入长期记忆（跨会话保留）。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '一条简短、独立可读的事实' },
        pinned: { type: 'boolean', description: '是否固定在每次对话的上下文里' },
      },
      required: ['text'],
    },
  },
  {
    name: 'recall',
    description: '在长期记忆里搜索相关内容（关键词匹配）。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '关键词或短语' } },
      required: ['query'],
    },
  },
  {
    name: 'schedule_task',
    description: 'Schedule work for this Bot. Query first to avoid duplicates. Use either local 5-field cron or a future ISO runAt with timezone. Returns the saved task.',
    parameters: {
      type: 'object',
      properties: {
        cron: { type: 'string', description: '例如 "0 9 * * 1-5" 表示工作日 9:00' },
        runAt: { type: 'string', description: 'One-off ISO time with Z or UTC offset; excludes cron.' },
        title: { type: 'string', description: 'Short display name, at most 100 characters.' },
        prompt: { type: 'string', description: '到点后要执行的完整指令' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List this Bot tasks with IDs, timing, state and last results. Query before changes; ask when target is ambiguous.',
    parameters: { type: 'object', properties: { includeClosed: { type: 'boolean', description: 'Include completed and closed tasks. Default false.' } } },
  },
  {
    name: 'update_task',
    description: 'Update, pause, resume or close a task from list_tasks, owned by this Bot. Close retains history. Running executions continue. Timing uses either cron or runAt.',
    parameters: { type: 'object', properties: {
      taskId: { type: 'string' }, action: { type: 'string', enum: ['update', 'pause', 'resume', 'close'] },
      title: { type: 'string' }, prompt: { type: 'string' }, cron: { type: 'string' },
      runAt: { type: 'string', description: 'One-off ISO time with timezone.' },
    }, required: ['taskId', 'action'] },
  },
  {
    name: 'web_fetch',
    description: '抓取一个公开网页并返回纯文本（只允许 https，最大 200KB）。',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'https:// 开头的地址' } },
      required: ['url'],
    },
  },
  {
    name: 'install_mcp',
    description: '安装 MCP 服务并自动绑定到当前 Bot。json 为标准 mcpServers 配置（与设置页导入格式一致）；stdio 服务的 command 必须是本机存在的绝对路径。这是敏感操作，会请求用户确认。',
    parameters: {
      type: 'object',
      properties: { json: { type: 'string', description: 'mcpServers 配置 JSON 字符串' } },
      required: ['json'],
    },
  },
  {
    name: 'install_skill',
    description: '从当前工作区内的目录安装 Skill（目录需包含带 name/description 的 SKILL.md 头部），并自动绑定到当前 Bot。会请求用户确认。',
    parameters: {
      type: 'object',
      properties: { directory: { type: 'string', description: '技能目录：工作区相对路径，或工作区内的绝对路径' } },
      required: ['directory'],
    },
  },
  {
    name: 'web_search',
    description: '按关键词搜索网页，返回标题、链接和摘要（默认免密钥 Bing 网页，可在设置切换 Serper / Brave / Bing API / SearXNG / DuckDuckGo）。需要正文时用 web_fetch 抓取其中的链接。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        count: { type: 'integer', description: '返回条数 1–10，默认 6' },
      },
      required: ['query'],
    },
  },
];

export interface ToolContext {
  bot: Bot;
  cloud: ComputerHost;
  workspaceDir: string;
  imageApiKey: string;
  requestApproval?: (call: ToolCall, summary: string) => Promise<boolean>;
  remember: (text: string, pinned: boolean) => { id: string };
  recall: (query: string) => string[];
  createSchedule: (input: ScheduleInput) => Schedule;
  listTasks: (includeClosed: boolean) => Schedule[];
  updateTask: (id: string, patch: ScheduleUpdate) => Schedule;
  installMcp?: (json: string) => { added: string[] };
  installSkill?: (directory: string) => { id?: string; name?: string };
  webSearch?: WebSearchSettings;
  imageGenerator: (request: { prompt: string; aspect: Bot['image']['aspect'] }) => Promise<GeneratedImage>;
  emitStatus: (status: CloudStatus, note?: string) => void;
  signal?: AbortSignal;
}

export function toolNamesFor(bot: Bot): string[] {
  // Installation tools are opt-in: never part of the implicit "all tools" default.
  const names = bot.tools.length ? bot.tools : TOOL_SCHEMAS.map((tool) => tool.name).filter((name) => name !== 'install_mcp' && name !== 'install_skill');
  const expanded = names.includes('schedule_task') ? [...names, 'list_tasks', 'update_task'] : [...names];
  if (bot.workspaceId !== 'workspace_local' && names.includes('cloud_exec')) expanded.push('desktop_action');
  return [...new Set(expanded)].filter((name) => bot.workspaceId !== 'workspace_local' || name !== 'desktop_action');
}

export function schemasFor(bot: Bot): ToolSchema[] {
  const allowed = new Set(toolNamesFor(bot));
  return TOOL_SCHEMAS.filter((tool) => allowed.has(tool.name)).map((tool) => bot.workspaceId !== 'workspace_local' || !tool.name.startsWith('cloud_') ? tool : { ...tool, description: tool.name === 'cloud_exec' ? '在本机 Windows 工作区运行 PowerShell 命令（兼容工具名），不使用云电脑。' : tool.name === 'cloud_read' ? '读取本机工作区目录内的文本文件，可使用相对路径。' : '写入本机工作区目录内的文件，可使用相对路径。' });
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${key} 必须是非空字符串`);
  return value;
}

function taskTime(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('runAt 必须是包含时区的 ISO 8601 时间');
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || Number(value.slice(11, 13)) > 23) throw new Error('runAt 日期或时间无效');
  return Date.parse(value);
}

const IMAGE_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
]);

async function saveImage(workspaceDir: string, image: GeneratedImage): Promise<{ relPath: string; absPath: string }> {
  const dir = path.join(workspaceDir, 'images');
  fs.mkdirSync(dir, { recursive: true });
  const ext = IMAGE_EXT.get(image.mimeType.split(';')[0] ?? '') ?? 'png';
  const name = `${newId('img')}.${ext}`;
  const absPath = path.join(dir, name);
  fs.writeFileSync(absPath, image.bytes);
  return { relPath: `images/${name}`, absPath };
}

interface SearchHit { title: string; url: string; snippet: string }

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DuckDuckGo wraps result links in a redirect; pull the real target out of it. */
function unwrapDdg(href: string): string {
  const raw = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith('duckduckgo.com')) {
      const target = url.searchParams.get('uddg');
      if (target) return target;
    }
  } catch { /* keep whatever we got */ }
  return raw;
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
  return res.json();
}

const requireKey = (key: string | undefined, label: string) => {
  if (!key) throw new Error(`${label} 需要在「设置 → 能力 → 联网搜索」填写 API Key`);
  return key;
};

/** Search backends share one shape so the tool result is identical across providers. */
async function searchWeb(query: string, count: number, settings: WebSearchSettings | undefined, signal?: AbortSignal): Promise<SearchHit[]> {
  const provider = settings?.provider ?? 'bing-web';
  const key = settings?.apiKey?.trim();
  const limit = (rows: any[], map: (row: any) => SearchHit) => (Array.isArray(rows) ? rows : []).slice(0, count).map(map);
  if (provider === 'serper') {
    const data = await fetchJson('https://google.serper.dev/search', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'X-API-KEY': requireKey(key, 'Serper') }, body: JSON.stringify({ q: query, num: count }) });
    return limit(data.organic, (row) => ({ title: decodeEntities(String(row.title ?? '')), url: String(row.link ?? ''), snippet: decodeEntities(String(row.snippet ?? '')) }));
  }
  if (provider === 'brave') {
    const data = await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, { signal, headers: { accept: 'application/json', 'X-Subscription-Token': requireKey(key, 'Brave Search') } });
    return limit(data.web?.results, (row) => ({ title: decodeEntities(String(row.title ?? '')), url: String(row.url ?? ''), snippet: decodeEntities(String(row.description ?? '')) }));
  }
  if (provider === 'bing') {
    const data = await fetchJson(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}&mkt=zh-CN`, { signal, headers: { 'Ocp-Apim-Subscription-Key': requireKey(key, 'Bing Search') } });
    return limit(data.webSearch?.value, (row) => ({ title: decodeEntities(String(row.name ?? '')), url: String(row.url ?? ''), snippet: decodeEntities(String(row.snippet ?? '')) }));
  }
  if (provider === 'searxng') {
    const base = settings?.endpoint?.trim();
    if (!base) throw new Error('SearXNG 需要在「设置 → 能力 → 联网搜索」填写实例地址');
    const data = await fetchJson(`${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json`, { signal, headers: { 'user-agent': BROWSER_UA } });
    return limit(data.results, (row) => ({ title: decodeEntities(String(row.title ?? '')), url: String(row.url ?? ''), snippet: decodeEntities(String(row.content ?? '')) }));
  }
  // Keyless default: scrape Bing's result page, reachable from CN networks (DuckDuckGo usually is not).
  if (provider === 'bing-web') {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(count, 10)}`, { signal, headers: { 'user-agent': BROWSER_UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
    if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
    const page = await res.text();
    const hits: SearchHit[] = [];
    for (const block of page.split('<li class="b_algo"').slice(1)) {
      const link = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
      if (!link?.[1]) continue;
      const url = decodeEntities(link[1]);
      if (!/^https?:\/\//i.test(url)) continue;
      const snippet = /<p[^>]*class="[^"]*b_(?:lineclamp|alwayshide|caption)[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '';
      hits.push({ title: decodeEntities(link[2] ?? ''), url, snippet: decodeEntities(snippet) });
      if (hits.length >= count) break;
    }
    return hits;
  }
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER_UA },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (res.status === 403 || res.status === 429) throw new Error('DuckDuckGo 正在限流，稍后重试或在设置里更换搜索后端');
  if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  for (const block of html.split('result__body').slice(1)) {
    const link = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link?.[1]) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    hits.push({ title: decodeEntities(link[2] ?? ''), url: unwrapDdg(decodeEntities(link[1])), snippet: decodeEntities(snippet) });
    if (hits.length >= count) break;
  }
  return hits.filter((hit) => /^https?:\/\//i.test(hit.url));
}

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const startedAt = Date.now();
  const finish = (result: Omit<ToolResult, 'id' | 'name' | 'durationMs'>): ToolResult => ({
    id: call.id,
    name: call.name,
    durationMs: Date.now() - startedAt,
    ...result,
  });
  const args = call.arguments ?? {};
  const computerLabel = ctx.bot.workspaceId === 'workspace_local' ? '本机工作区' : '云电脑';
  let releaseComputer: (() => void) | undefined;
  const acquireComputer = async () => { releaseComputer = await ctx.cloud.control?.acquire(ctx.signal); };
  try {
    switch (call.name) {
      case 'desktop_action': {
        if (ctx.bot.workspaceId === 'workspace_local' || !ctx.cloud.desktopAction || !toolNamesFor(ctx.bot).includes(call.name)) throw new Error('此 Bot 未启用云电脑桌面操作');
        if (ctx.requestApproval) {
          const approved = await ctx.requestApproval(call, `操作云电脑桌面：${String(args.action)}`);
          if (!approved) return finish({ ok: false, summary: '已拒绝桌面操作' });
        }
        await acquireComputer();
        ctx.cloud.beginTask('Bot 操作桌面');
        try {
          const result = await ctx.cloud.desktopAction(args, ctx.signal);
          const saved = result.screenshot ? await saveImage(ctx.workspaceDir, { bytes: result.screenshot, mimeType: 'image/png' }) : undefined;
          return finish({ ok: true, summary: result.text, artifactPath: saved?.relPath });
        } finally { ctx.cloud.endTask(); }
      }
      case 'cloud_exec': {
        const cmd = requireString(args, 'cmd');
        const timeoutSeconds = Math.min(Math.max(Number(args.timeoutSeconds ?? 120) || 120, 5), 900);
        if (ctx.requestApproval) {
          const approved = await ctx.requestApproval(call, `在${computerLabel}执行：${summarize(cmd, 240)}`);
          if (!approved) return finish({ ok: false, summary: '已拒绝执行', detail: cmd });
        }
        await acquireComputer();
        ctx.cloud.beginTask('在云电脑执行命令');
        try {
          ctx.emitStatus(ctx.cloud.status(), '正在云电脑执行命令');
          const result = await ctx.cloud.exec(cmd, {
            timeoutSeconds,
            signal: ctx.signal,
          });
          const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
          return finish({
            ok: result.exitCode === 0 && !result.timedOut,
            summary:
              result.timedOut
                ? `命令超时（${timeoutSeconds}s）`
                : result.exitCode === 0
                  ? `命令执行成功${output ? ` · ${output.split('\n').length} 行输出` : ''}`
                  : `命令退出码 ${result.exitCode}`,
            detail: truncate(output || '(无输出)', 12000),
          });
        } finally {
          ctx.cloud.endTask();
        }
      }
      case 'cloud_read': {
        const remotePath = requireString(args, 'path');
        await acquireComputer();
        ctx.cloud.beginTask('读取云电脑文件');
        try {
          const text = await ctx.cloud.readText(remotePath);
          return finish({ ok: true, summary: `读取 ${remotePath}（${text.length} 字符）`, detail: truncate(text, 20000) });
        } finally {
          ctx.cloud.endTask();
        }
      }
      case 'cloud_write': {
        const remotePath = requireString(args, 'path');
        const content = typeof args.content === 'string' ? args.content : JSON.stringify(args.content ?? '');
        if (ctx.requestApproval) {
          const approved = await ctx.requestApproval(call, `写入${computerLabel}文件：${remotePath}（${content.length} 字符）`);
          if (!approved) return finish({ ok: false, summary: '已拒绝写入' });
        }
        await acquireComputer();
        ctx.cloud.beginTask('写入云电脑文件');
        try {
          await ctx.cloud.writeText(remotePath, content);
          return finish({ ok: true, summary: `已写入 ${remotePath}（${content.length} 字符）` });
        } finally {
          ctx.cloud.endTask();
        }
      }
      case 'generate_image': {
        const prompt = requireString(args, 'prompt');
        const aspect = (typeof args.aspect === 'string' ? args.aspect : ctx.bot.image.aspect) as BotImageAspect;
        const image = await ctx.imageGenerator({ prompt, aspect });
        const saved = await saveImage(ctx.workspaceDir, image);
        return finish({
          ok: true,
          summary: `图片已生成（${aspect}）`,
          artifactPath: saved.relPath,
          detail: image.revisedPrompt ? `改写后的提示词：${image.revisedPrompt}` : undefined,
        });
      }
      case 'remember': {
        const text = requireString(args, 'text');
        const fact = ctx.remember(text, Boolean(args.pinned));
        return finish({ ok: true, summary: `已记住：${summarize(text, 80)}`, detail: `记忆 id ${fact.id}` });
      }
      case 'recall': {
        const query = requireString(args, 'query');
        const hits = ctx.recall(query);
        return finish({
          ok: true,
          summary: hits.length ? `找到 ${hits.length} 条记忆` : '没有匹配的记忆',
          detail: hits.join('\n'),
        });
      }
      case 'schedule_task': {
        if (!toolNamesFor(ctx.bot).includes(call.name)) throw new Error('当前 Bot 未启用定时任务工具');
        const prompt = requireString(args, 'prompt');
        const schedule = ctx.createSchedule({ prompt, title: args.title as string | undefined, cron: args.cron as string | undefined, runAt: taskTime(args.runAt) });
        return finish({
          ok: true,
          summary: `任务已安排：${schedule.title || schedule.prompt.slice(0, 50)}`,
          detail: JSON.stringify(schedule),
        });
      }
      case 'list_tasks': {
        if (!toolNamesFor(ctx.bot).includes(call.name)) throw new Error('当前 Bot 未启用定时任务工具');
        const tasks = ctx.listTasks(args.includeClosed === true);
        return finish({ ok: true, summary: `找到 ${tasks.length} 个任务`, detail: JSON.stringify(tasks) });
      }
      case 'update_task': {
        if (!toolNamesFor(ctx.bot).includes(call.name)) throw new Error('当前 Bot 未启用定时任务工具');
        const schedule = ctx.updateTask(requireString(args, 'taskId'), { action: requireString(args, 'action') as ScheduleUpdate['action'], title: args.title as string | undefined, prompt: args.prompt as string | undefined, cron: args.cron as string | undefined, runAt: taskTime(args.runAt) });
        return finish({ ok: true, summary: `任务已${args.action === 'pause' ? '暂停' : args.action === 'resume' ? '恢复' : args.action === 'close' ? '关闭' : '更新'}：${schedule.title || schedule.prompt.slice(0, 50)}`, detail: JSON.stringify(schedule) });
      }
      case 'web_fetch': {
        const url = requireString(args, 'url');
        if (!/^https:\/\//i.test(url)) return finish({ ok: false, summary: '只允许 https:// 地址' });
        const host = new URL(url).hostname;
        if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(host)) {
          return finish({ ok: false, summary: '拒绝访问内网地址' });
        }
        const res = await fetch(url, { signal: ctx.signal, headers: { 'user-agent': 'MoyuBot/0.1' } });
        if (!res.ok) return finish({ ok: false, summary: `抓取失败：HTTP ${res.status}` });
        const html = (await res.text()).slice(0, 200_000);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return finish({ ok: true, summary: `抓取 ${host}（${text.length} 字符）`, detail: truncate(text, 16000) });
      }
      case 'install_mcp': {
        if (!toolNamesFor(ctx.bot).includes(call.name)) throw new Error('当前 Bot 未启用安装 MCP 工具');
        if (!ctx.installMcp) throw new Error('当前环境不支持安装 MCP');
        const json = requireString(args, 'json');
        let parsed: any;
        try { parsed = JSON.parse(json); } catch { throw new Error('MCP JSON 格式无效'); }
        const servers = Object.entries(parsed?.mcpServers ?? {}) as [string, any][];
        if (!servers.length) throw new Error('JSON 需包含 mcpServers');
        for (const [name, item] of servers) {
          if (item?.url) continue;
          const command = typeof item?.command === 'string' ? item.command : '';
          if (!command || !path.isAbsolute(command) || !fs.existsSync(command)) throw new Error(`MCP「${name}」的 command 必须是本机存在的绝对路径（当前：${command || '空'}）`);
        }
        if (ctx.requestApproval && !(await ctx.requestApproval(call, `安装 MCP：${servers.map(([name]) => name).join('、')}`))) return finish({ ok: false, summary: '已取消安装 MCP' });
        const result = ctx.installMcp(json);
        return finish({ ok: true, summary: `已安装 MCP：${result.added.join('、') || '（无新增）'}`, detail: '已自动绑定到当前 Bot，重启对话或下次请求即可使用' });
      }
      case 'install_skill': {
        if (!toolNamesFor(ctx.bot).includes(call.name)) throw new Error('当前 Bot 未启用安装 Skill 工具');
        if (!ctx.installSkill) throw new Error('当前环境不支持安装 Skill');
        const base = path.resolve(ctx.workspaceDir);
        const resolved = path.resolve(base, requireString(args, 'directory'));
        if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('技能目录必须在当前工作区内');
        if (!fs.existsSync(path.join(resolved, 'SKILL.md'))) throw new Error('目录内没有 SKILL.md');
        if (ctx.requestApproval && !(await ctx.requestApproval(call, `安装技能：${path.basename(resolved)}`))) return finish({ ok: false, summary: '已取消安装技能' });
        const result = ctx.installSkill(resolved);
        return finish({ ok: true, summary: `已安装技能：${result.name ?? result.id ?? ''}`, detail: '已自动绑定到当前 Bot' });
      }
      case 'web_search': {
        const query = requireString(args, 'query');
        const count = Math.max(1, Math.min(10, Number.isFinite(Number(args.count)) && args.count !== undefined ? Math.floor(Number(args.count)) : 6));
        const hits = await searchWeb(query, count, ctx.webSearch, ctx.signal);
        if (!hits.length) return finish({ ok: true, summary: `没有搜到「${summarize(query, 40)}」的结果` });
        return finish({
          ok: true,
          summary: `搜索「${summarize(query, 40)}」：${hits.length} 条结果`,
          detail: truncate(hits.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`).join('\n'), 8000),
        });
      }
      default:
        return finish({ ok: false, summary: `未知工具：${call.name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ ok: false, summary: `执行失败：${summarize(message, 140)}`, detail: message });
  } finally {
    releaseComputer?.();
  }
}

type BotImageAspect = Bot['image']['aspect'];
