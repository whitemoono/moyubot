/**
 * Office 生成路由：同一份生成逻辑跑在本机或云电脑上。
 *
 * 能力不绑云机模板：任何 driver（instabox / E2B / 未来供应商）只要能 exec + 读写文件，
 * 就能产出与本机相同的文件。云端做法是把「生成逻辑 + 依赖」封装成自包含脚本推上去，
 * 用云机的 node 执行；失败（无 node / 无网络）自动回落本机生成。
 */
import fs from 'node:fs';
import path from 'node:path';
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

function targetPath(request: OfficeRequest): string {
  const relDir = request.directory.trim().replace(/^\/+|\/+$/g, '');
  return [relDir, `${SAFE(request.name)}.${request.kind}`].filter(Boolean).join('/');
}

/** 读取构建产物里的自包含 Office 运行时源码（由 scripts/bundle-office.mjs 生成）。 */
function cloudRuntimeSource(): string {
  const file = path.join(__dirname, 'office-cloud-runtime.js');
  const raw = fs.readFileSync(file, 'utf8');
  const match = /module\.exports\s*=\s*("(?:[^"\\]|\\.)*")/.exec(raw);
  return match ? JSON.parse(match[1]) as string : raw;
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
  const relPath = targetPath(request);
  const stamp = Date.now();
  const runtimePath = `_office/runtime-${stamp}.cjs`;
  const payloadPath = `_office/payload-${stamp}.json`;
  const scriptPath = `_office/build-${stamp}.cjs`;
  const script = [
    '#!/usr/bin/env node',
    '// MoyuBot 云端 Office 生成器（自包含）',
    'const fs = require("fs"), path = require("path");',
    'const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const runtime = fs.readFileSync(process.argv[3], "utf8");',
    'const list = Object.keys(require.cache).map(Number).filter((n) => Number.isFinite(n));',
    'new Function("module", "exports", "require", runtime)({ exports: {} }, {}, require);',
    'const loaded = Object.keys(require.cache).filter((k) => k.includes("runtime-" )).pop();',
    'const mod = loaded ? require(loaded) : undefined;',
    'if (!mod || typeof mod.run !== "function") { console.error("云机未加载生成运行时（node 版本或缓存问题）"); process.exit(2); }',
    'mod.run(payload).then((bytes) => {',
    '  fs.mkdirSync(path.dirname(payload.__target), { recursive: true });',
    '  fs.writeFileSync(payload.__target, bytes);',
    '  console.log("ok:" + bytes.length);',
    '}).catch((error) => { console.error(error && error.stack || String(error)); process.exit(1); });',
    '',
  ].join('\n');
  try {
    await host.writeText(runtimePath, cloudRuntimeSource(), botDir);
    await host.writeText(payloadPath, JSON.stringify({ ...request, __target: relPath }), botDir);
    await host.writeText(scriptPath, script, botDir);
    const command = `node ${JSON.stringify(scriptPath)} ${JSON.stringify(payloadPath)} ${JSON.stringify(runtimePath)}`;
    const result = await host.exec(command, { timeoutSeconds: 240, subDirectory: botDir });
    if (result.exitCode !== 0 || result.timedOut) {
      return { ok: false, machine: 'cloud', error: (result.stderr || result.stdout || '云机执行失败').slice(0, 300) };
    }
    const { bytes } = await host.readBytes(relPath, botDir);
    if (!bytes.length) return { ok: false, machine: 'cloud', error: '云机没有产出文件' };
    return { ok: true, path: relPath, bytes: bytes.length, machine: 'cloud' };
  } catch (error) {
    return { ok: false, machine: 'cloud', error: (error as Error).message };
  }
}

/** 生成并落盘：优先 Bot 所属机器；云端失败回落本机，功能不断。 */
export async function buildOffice(host: ComputerHost, request: OfficeRequest, botDir: string, options: { prefer: 'local' | 'cloud' }): Promise<OfficeResult> {
  if (options.prefer === 'local') return buildOfficeLocally(host, request, botDir);
  const remote = await buildOfficeOnCloud(host, request, botDir);
  if (remote.ok) return remote;
  const local = await buildOfficeLocally(host, request, botDir);
  return { ...local, machine: 'local', error: remote.error ? `${remote.error}（已在本机生成）` : undefined };
}