import { randomBytes } from 'node:crypto';
import path from 'node:path';

export function normalizeRemoteDirectory(value: string): string {
  if (typeof value !== 'string' || !value.trim().startsWith('/') || /[\\\x00\r\n]/.test(value)) throw new Error('云电脑工作路径需要是 Linux 绝对路径，例如 /data/moyubot');
  return path.posix.normalize(value.trim()).replace(/\/$/, '') || '/';
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断 ${text.length - max} 字符）`;
}

/**
 * 模型输入用的首尾保留裁剪。`truncate` 只砍尾巴，但工具输出的结论几乎都在结尾
 * （退出码、最后一个栈帧、JSON 末尾的 error 字段），只留头部恰好丢掉了模型最需要读的那部分。
 * 省略标记计入 `max` 之内，所以返回值一定不超过调用方给出的额度：标记按最宽情况
 * （`dropped = text.length`）预留空间，实际 dropped 更小、数字更短，总长只会 ≤ max。
 */
export function pruneOutput(text: string, max: number, headRatio = 0.4): string {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  const marker = (dropped: number) => `\n…（中间省略 ${dropped} 字符，已保留首尾）…\n`;
  const room = max - marker(text.length).length;
  if (room <= 0) return text.slice(0, max);
  const head = Math.floor(room * headRatio);
  const tail = room - head;
  return `${text.slice(0, head)}${marker(text.length - room)}${text.slice(text.length - tail)}`;
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Quote a value for bash single-quote context. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function summarize(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
