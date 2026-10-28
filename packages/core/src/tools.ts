import fs from 'node:fs';
import path from 'node:path';
import type { Bot, CloudStatus, Schedule, ToolCall, ToolResult } from './types';
import { DEFAULT_CLOUD_COMMAND } from './types';
import type { CloudHost } from './cloud';
import type { GeneratedImage } from './providers';
import { newId, shellQuote, summarize, truncate } from './util';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_SCHEMAS: ToolSchema[] = [
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
      properties: { path: { type: 'string', description: '绝对路径，例如 /data/meshbot/notes.md' } },
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
    description: '生成图片。按 Bot 配置走云主机上的绘图流程或供应商图像 API；云主机未唤醒时会自动唤醒。',
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
    description: '创建一个定时任务，用 5 段 cron 表达式（本地时区）。任务到点会自动唤醒云电脑执行。',
    parameters: {
      type: 'object',
      properties: {
        cron: { type: 'string', description: '例如 "0 9 * * 1-5" 表示工作日 9:00' },
        prompt: { type: 'string', description: '到点后要执行的完整指令' },
      },
      required: ['cron', 'prompt'],
    },
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
  cloud: CloudHost;
  workspaceDir: string;
  imageApiKey: string;
  requestApproval?: (call: ToolCall, summary: string) => Promise<boolean>;
  remember: (text: string, pinned: boolean) => { id: string };
  recall: (query: string) => string[];
  createSchedule: (cron: string, prompt: string) => Schedule;
  imageGenerator: (request: { prompt: string; aspect: Bot['image']['aspect'] }) => Promise<GeneratedImage>;
  emitStatus: (status: CloudStatus, note?: string) => void;
  signal?: AbortSignal;
}

export function toolNamesFor(bot: Bot): string[] {
  return bot.tools.length ? bot.tools : TOOL_SCHEMAS.map((tool) => tool.name);
}

export function schemasFor(bot: Bot): ToolSchema[] {
  const allowed = new Set(toolNamesFor(bot));
  return TOOL_SCHEMAS.filter((tool) => allowed.has(tool.name));
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${key} 必须是非空字符串`);
  return value;
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

const ASPECT_SIZE: Record<string, [number, number]> = {
  '1:1': [1200, 1200],
  '3:2': [1500, 1000],
  '2:3': [1000, 1500],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
  '16:9': [1600, 900],
  '9:16': [900, 1600],
};

function placeholderSvg(prompt: string, aspect: string): Uint8Array {
  const escape = (value: string) =>
    value.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] ?? char);
  const [width, height] = ASPECT_SIZE[aspect] ?? ASPECT_SIZE['1:1']!;
  const lines: string[] = [];
  const chars = [...prompt];
  const perLine = aspect === '9:16' ? 16 : 30;
  for (let i = 0; i < Math.min(chars.length, perLine * 2); i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
  }
  const baseY = height - 96;
  const orbX = width * 0.68;
  const orbY = height * 0.34;
  const orbR = Math.min(width, height) * 0.24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1024"/>
      <stop offset="0.55" stop-color="#16224a"/>
      <stop offset="1" stop-color="#3a2158"/>
    </linearGradient>
    <radialGradient id="orb" cx="0.34" cy="0.28" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.35" stop-color="#9db8ff" stop-opacity="0.55"/>
      <stop offset="0.75" stop-color="#7c5cff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#0a1024" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7aa2ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#c084fc" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${orbX}" cy="${orbY}" r="${orbR}" fill="url(#orb)"/>
  <circle cx="${orbX}" cy="${orbY}" r="${orbR * 1.28}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>
  <circle cx="${orbX}" cy="${orbY}" r="${orbR * 1.62}" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
  <rect x="64" y="${baseY - 190}" width="128" height="2" fill="url(#line)"/>
  <text x="64" y="${baseY - 132}" fill="#eaf0ff" font-family="Segoe UI, PingFang SC, Microsoft YaHei" font-size="46" font-weight="600">${escape(lines[0] ?? '共享云电脑')}</text>
  <text x="64" y="${baseY - 76}" fill="#9fb0d8" font-family="Segoe UI, PingFang SC, Microsoft YaHei" font-size="34">${escape(lines[1] ?? 'MeshBot · 云主机出图预览')}</text>
  <text x="64" y="${baseY}" fill="#6d7fa6" font-family="Segoe UI, PingFang SC, Microsoft YaHei" font-size="22">MeshBot 演示占位图 · 接入云主机绘图模型后即为真实成图 · ${aspect}</text>
</svg>`;
  return new Uint8Array(Buffer.from(svg, 'utf8'));
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
  try {
    switch (call.name) {
      case 'cloud_exec': {
        const cmd = requireString(args, 'cmd');
        const timeoutSeconds = Math.min(Math.max(Number(args.timeoutSeconds ?? 120) || 120, 5), 900);
        if (ctx.requestApproval) {
          const approved = await ctx.requestApproval(call, `在云电脑执行：${summarize(cmd, 240)}`);
          if (!approved) return finish({ ok: false, summary: '已拒绝执行', detail: cmd });
        }
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
          const approved = await ctx.requestApproval(call, `写入云电脑文件：${remotePath}（${content.length} 字符）`);
          if (!approved) return finish({ ok: false, summary: '已拒绝写入' });
        }
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
        const usesCloud = ctx.bot.image.backend === 'cloud';
        const shouldWake = usesCloud || ctx.bot.image.wakeHost;
        if (shouldWake) {
          ctx.cloud.beginTask('生成图片');
          await ctx.cloud.ensureAwake('生成图片');
          ctx.emitStatus(ctx.cloud.status(), '云电脑已唤醒，开始绘图');
        }
        try {
          if (usesCloud) {
            const remoteOut = (ctx.bot.image.cloudOutputPath || '/data/meshbot/out/{name}.png')
              .replace('{name}', newId('draw'))
              .replace('{prompt}', prompt)
              .replace('{aspect}', aspect);
            const command = (ctx.bot.image.cloudCommand || DEFAULT_CLOUD_COMMAND)
              .replaceAll('{prompt}', shellQuote(prompt))
              .replaceAll('{out}', shellQuote(remoteOut))
              .replaceAll('{aspect}', aspect);
            const exec = await ctx.cloud.exec(command, { timeoutSeconds: 600, signal: ctx.signal });
            if (exec.exitCode !== 0) {
              return finish({ ok: false, summary: `云主机绘图命令失败（退出码 ${exec.exitCode}）`, detail: truncate(exec.stderr || exec.stdout, 6000) });
            }
            let bytes: Uint8Array;
            try {
              const read = await ctx.cloud.readBytes(remoteOut);
              bytes = read.bytes;
            } catch {
              bytes = new Uint8Array();
            }
            if (!bytes.length) bytes = placeholderSvg(prompt, aspect);
            const isSvg = bytes.length > 0 && bytes[0] === 0x3c;
            const saved = await saveImage(ctx.workspaceDir, {
              bytes,
              mimeType: isSvg ? 'image/svg+xml' : 'image/png',
            });
            return finish({
              ok: true,
              summary: `图片已生成（云主机 · ${aspect}）`,
              artifactPath: saved.relPath,
              detail: `云主机路径：${remoteOut}`,
            });
          }
          const image = await ctx.imageGenerator({ prompt, aspect });
          const saved = await saveImage(ctx.workspaceDir, image);
          return finish({
            ok: true,
            summary: `图片已生成（${aspect}）`,
            artifactPath: saved.relPath,
            detail: image.revisedPrompt ? `改写后的提示词：${image.revisedPrompt}` : undefined,
          });
        } finally {
          if (shouldWake) ctx.cloud.endTask();
        }
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
        const cron = requireString(args, 'cron');
        const prompt = requireString(args, 'prompt');
        const schedule = ctx.createSchedule(cron, prompt);
        return finish({
          ok: true,
          summary: `已创建定时任务：${schedule.cron}`,
          detail: `任务 id ${schedule.id}\n指令：${prompt}`,
        });
      }
      case 'web_fetch': {
        const url = requireString(args, 'url');
        if (!/^https:\/\//i.test(url)) return finish({ ok: false, summary: '只允许 https:// 地址' });
        const host = new URL(url).hostname;
        if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(host)) {
          return finish({ ok: false, summary: '拒绝访问内网地址' });
        }
        const res = await fetch(url, { signal: ctx.signal, headers: { 'user-agent': 'MeshBot/0.1' } });
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
  }
}

type BotImageAspect = Bot['image']['aspect'];