/**
 * Office 生成路由：同一份生成逻辑跑在本机或云电脑上。
 *
 * 能力不绑云机模板：任何 driver（instabox / E2B / 未来供应商）只要能 exec + 读写文件，
 * 就能产出与本机相同的文件。云端做法是把「生成逻辑 + 依赖」封装成自包含脚本推上去，
 * 用云机的 node 执行；失败（无 node / 无网络）自动回落本机生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ComputerHost } from './cloud';
import type { DeckSlide, DocBlock, SheetSpec } from './office';

export type OfficeKind = 'xlsx' | 'docx' | 'pptx';

export interface OfficeRequest {
  kind: OfficeKind;
  /** 目标目录（相对工作目录），产物命名为 <name>.<kind> */
  directory: string;
  /** 不含扩展名的文件名 */
  name: string;
  spreadsheet?: SheetSpec[];
  document?: { title?: string; blocks: DocBlock[] };
  slides?: { title?: string; slides: DeckSlide[] };
}

export interface OfficeResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  machine: 'local' | 'cloud';
  error?: string;
}

/** 文件名安全化：保留字母数字、中文、空格、点、连字符、下划线。 */
const SAFE = (value: string) => value
  .replace(/[<>:"/\\|?*]/g, '_')
  .split('')
  .filter((char) => char.charCodeAt(0) >= 32)
  .join('')
  .replace(/^[.\s]+|[.\s]+$/g, '')
  .slice(0, 100) || 'output';

/**
 * 目标目录只接受「相对 Bot 工作目录」的路径。
 * 模型可以自由编 directory，所以这里必须挡住 `..` 与盘符，避免写到工作区外
 * （云侧 workspace 解析不做包含校验，本机 LocalHost 也只是退化成共享根）。
 */
function safeDirectory(value: string): string {
  const cleaned = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '';
  if (/^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith('~')) throw new Error('目录必须是相对 Bot 工作目录的路径');
  if (cleaned.split('/').some((part) => part === '..')) throw new Error('目录不能包含 .. 路径');
  return cleaned;
}

function targetPath(request: OfficeRequest): string {
  const relDir = safeDirectory(request.directory);
  return [relDir, `${SAFE(request.name)}.${request.kind}`].filter(Boolean).join('/');
}

/** 生成出来的自包含运行时（scripts/bundle-office.mjs 产出）。3 MB 级，读一次就缓存。 */
let runtimeCache: string | undefined;
function cloudRuntimeSource(): string {
  if (runtimeCache) return runtimeCache;
  const file = path.join(__dirname, 'office-cloud-runtime.js');
  const raw = fs.readFileSync(file, 'utf8');
  const match = /module\.exports\s*=\s*("(?:[^"\\]|\\.)*")/.exec(raw);
  runtimeCache = match ? JSON.parse(match[1]) as string : raw;
  return runtimeCache;
}

/** 云机上的固定文件名：运行时按内容哈希复用，避免每次生成都上传 3 MB。 */
const CLOUD_RUNTIME = '_office/runtime.cjs';
const CLOUD_RUNTIME_HASH = '_office/runtime.hash';

async function ensureCloudRuntime(host: ComputerHost, botDir: string): Promise<void> {
  const source = cloudRuntimeSource();
  const hash = createHash('sha256').update(source).digest('hex');
  try {
    const existing = await host.readText(CLOUD_RUNTIME_HASH, botDir);
    if (existing.trim() === hash) return;
  } catch { /* 首次执行，或机器被重建：重新上传 */ }
  await host.writeText(CLOUD_RUNTIME, source, botDir);
  await host.writeText(CLOUD_RUNTIME_HASH, hash, botDir);
}

/**
 * 云机侧的启动脚本。
 * 运行时是构建期打好的 **CJS**（module.exports = { run }），所以直接 require 即可；
 * 早前用 `new Function` 求值再去 require.cache 里找，等于把导出丢掉、永远判定「未加载」。
 */
function cloudScript(): string {
  return [
    '#!/usr/bin/env node',
    '// MoyuBot 云端 Office 生成器（自包含）',
    'const fs = require("fs"), path = require("path");',
    'const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const mod = require(path.resolve(process.argv[3]));',
    'if (!mod || typeof mod.run !== "function") { console.error("云机没有加载到生成运行时"); process.exit(2); }',
    'Promise.resolve(mod.run(payload)).then((bytes) => {',
    '  fs.mkdirSync(path.dirname(payload.__target), { recursive: true });',
    '  fs.writeFileSync(payload.__target, bytes);',
    '  console.log("ok:" + bytes.length);',
    '}).catch((error) => { console.error((error && error.stack) || String(error)); process.exit(1); });',
    '',
  ].join('\n');
}

/**
 * 清理本次请求的 payload、启动脚本，顺手扫掉历史遗留（旧版每次都会留下 3 MB 运行时）。
 * payload 里是用户文档全文，不能在云机上长期留存。
 */
async function cleanupCloudFiles(host: ComputerHost, botDir: string): Promise<void> {
  const command = 'rm -f -- _office/payload-*.json _office/build-*.cjs _office/runtime-*.cjs; rmdir _office 2>/dev/null || true';
  try {
    await host.exec(command, { subDirectory: botDir, timeoutSeconds: 20 });
  } catch { /* 清理失败不影响生成结果 */ }
}

/** 本机生成：直接调用 office 的 builder 并写入 Bot 工作目录。 */
export async function buildOfficeLocally(host: ComputerHost, request: OfficeRequest, botDir: string): Promise<OfficeResult> {
  try {
    const { buildDocument, buildSlides, buildSpreadsheet } = await import('./office');
    const bytes = request.kind === 'xlsx' ? await buildSpreadsheet(request.spreadsheet ?? [])
      : request.kind === 'docx' ? await buildDocument(request.document ?? { blocks: [] })
        : await buildSlides(request.slides ?? { slides: [] });
    const relPath = targetPath(request);
    await host.writeBytes(relPath, bytes, botDir);
    return { ok: true, path: relPath, bytes: bytes.length, machine: 'local' };
  } catch (error) {
    return { ok: false, machine: 'local', error: (error as Error).message };
  }
}

/**
 * 云端生成：把「自包含运行时 + 请求」推到 Bot 目录，交给云机 node 执行。
 * 云机只需有 node（instabox / E2B 模板自带），无需预装任何库。
 */
export async function buildOfficeOnCloud(host: ComputerHost, request: OfficeRequest, botDir: string): Promise<OfficeResult> {
  let relPath: string;
  try {
    relPath = targetPath(request);
  } catch (error) {
    return { ok: false, machine: 'cloud', error: (error as Error).message };
  }
  const stamp = Date.now();
  const payloadPath = `_office/payload-${stamp}.json`;
  const scriptPath = `_office/build-${stamp}.cjs`;
  try {
    await ensureCloudRuntime(host, botDir);
    await host.writeText(payloadPath, JSON.stringify({ ...request, __target: relPath }), botDir);
    await host.writeText(scriptPath, cloudScript(), botDir);
    const command = `node ${JSON.stringify(scriptPath)} ${JSON.stringify(payloadPath)} ${JSON.stringify(CLOUD_RUNTIME)}`;
    const result = await host.exec(command, { timeoutSeconds: 240, subDirectory: botDir });
    if (result.exitCode !== 0 || result.timedOut) {
      return { ok: false, machine: 'cloud', error: (result.stderr || result.stdout || '云机执行失败').slice(0, 300) };
    }
    // 脚本已经回报字节数，不必把整份文件下载回来只为数一下大小。
    const reported = /ok:(\d+)/.exec(result.stdout)?.[1];
    const bytes = reported ? Number(reported) : (await host.readBytes(relPath, botDir)).bytes.length;
    if (!bytes) return { ok: false, machine: 'cloud', error: '云机没有产出文件' };
    return { ok: true, path: relPath, bytes, machine: 'cloud' };
  } catch (error) {
    return { ok: false, machine: 'cloud', error: (error as Error).message };
  } finally {
    await cleanupCloudFiles(host, botDir);
  }
}

/** 生成并落盘：优先 Bot 所属机器；云端失败回落本机，功能不断。 */
export async function buildOffice(host: ComputerHost, request: OfficeRequest, botDir: string, options: { prefer: 'local' | 'cloud' }): Promise<OfficeResult> {
  if (options.prefer === 'local') return buildOfficeLocally(host, request, botDir);
  const remote = await buildOfficeOnCloud(host, request, botDir);
  if (remote.ok) return remote;
  const local = await buildOfficeLocally(host, request, botDir);
  // ok:true 但带 error，表示"做出来了，但云机那一步失败了"——调用方要把这句话说出去。
  return { ...local, machine: 'local', error: remote.error ? `${remote.error}（已在本机生成）` : undefined };
}