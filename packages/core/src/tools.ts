import fs from 'node:fs';
import path from 'node:path';
import type { Bot, CloudStatus, Schedule, ScheduleInput, ScheduleUpdate, ToolCall, ToolResult } from './types';
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
  imageGenerator: (request: { prompt: string; aspect: Bot['image']['aspect'] }) => Promise<GeneratedImage>;
  emitStatus: (status: CloudStatus, note?: string) => void;
  signal?: AbortSignal;
}

export function toolNamesFor(bot: Bot): string[] {
  const names = bot.tools.length ? bot.tools : TOOL_SCHEMAS.map((tool) => tool.name);
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
