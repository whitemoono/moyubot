#!/usr/bin/env node
/**
 * 统一测试入口：自动发现 scripts/*.test.{mjs,cjs}，按运行时分两层跑。
 *
 *  - node 层：纯 Node 用例（node --test），ubuntu / windows CI 都跑
 *  - electron 层：用例里 require('electron')，必须用 Electron 二进制跑（本机或 Windows CI）
 *
 * 用法：
 *   node scripts/test-all.mjs                 # 两层全跑（缺 Electron 就跳过 electron 层）
 *   node scripts/test-all.mjs --layer=node    # 只跑纯 Node 层（CI 默认）
 *   node scripts/test-all.mjs --filter=office # 只跑文件名含关键字的
 *   node scripts/test-all.mjs --list          # 只列文件与分层，不执行
 *   node scripts/test-all.mjs --jobs=4 --timeout=300
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const CORE_ENTRY = path.join(ROOT, 'packages', 'core', 'dist', 'index.js');
const ELECTRON_BIN = path.join(
  ROOT, 'apps', 'desktop', 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

const args = { layer: 'node', jobs: 4, timeout: 300, list: false, filter: '' };
  // 默认只跑 node 层：electron 层依赖 GUI 与构建产物，本机不一定具备，CI 单独一个 job 跑。
for (const arg of process.argv.slice(2)) {
  if (arg === '--list') args.list = true;
  else if (arg.startsWith('--layer=')) args.layer = arg.slice('--layer='.length);
  else if (arg.startsWith('--filter=')) args.filter = arg.slice('--filter='.length);
  else if (arg.startsWith('--jobs=')) args.jobs = Math.max(1, Number(arg.slice('--jobs='.length)) || 1);
  else if (arg.startsWith('--timeout=')) args.timeout = Math.max(10, Number(arg.slice('--timeout='.length)) || 300);
}

/** 用例里出现 require('electron') / from 'electron' 就必须用 Electron 二进制跑。 */
function needsElectron(file) {
  const text = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
  return /require\(['"]electron['"]\)|from\s+['"]electron['"]/.test(text);
}

function discover() {
  return fs.readdirSync(SCRIPTS)
    .filter((name) => /\.test\.(mjs|cjs)$/.test(name))
    .filter((name) => !args.filter || name.includes(args.filter))
    .sort()
    .map((name) => ({ name, layer: needsElectron(name) ? 'electron' : 'node' }));
}

function parseCounts(output) {
  const counts = { pass: 0, fail: 0, tests: 0, found: false };
  for (const match of output.matchAll(/^# (tests|pass|fail) (\d+)\s*$/gm)) {
    counts[match[1]] = Number(match[2]);
    counts.found = true;
  }
  return counts;
}

function runFile(entry) {
  const file = path.join(SCRIPTS, entry.name);
  const command = entry.layer === 'electron' ? ELECTRON_BIN : process.execPath;
  const argv = entry.layer === 'electron' ? ['--no-sandbox', file] : ['--test', file];
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, argv, {
      cwd: ROOT,
      env: {
        ...process.env,
        MOYU_TEST: '1',
        // Electron 不能把自身当 Node 用：用例需要一个真实的 node 可执行文件来起 MCP 桩。
        CAPABILITY_TEST_NODE: process.env.CAPABILITY_TEST_NODE ?? process.execPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, args.timeout * 1000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ...entry, ok: false, code: -1, seconds: 0, counts: parseCounts(''), output: `启动失败：${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const counts = parseCounts(output);
      resolve({
        ...entry,
        ok: !timedOut && code === 0 && counts.fail === 0,
        code,
        timedOut,
        seconds: (Date.now() - startedAt) / 1000,
        counts,
        output,
      });
    });
  });
}

async function runPool(entries) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(args.jobs, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const result = await runFile(entry);
      const mark = result.ok ? '✓' : '✗';
      const detail = result.counts.found ? `${result.counts.pass} pass / ${result.counts.fail} fail` : `exit ${result.code}`;
      process.stdout.write(`${mark} ${result.name.padEnd(34)} ${detail.padEnd(20)} ${result.seconds.toFixed(1)}s${result.timedOut ? '  (超时)' : ''}\n`);
      results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

const entries = discover();
const selected = entries.filter((entry) => args.layer === 'all' || entry.layer === args.layer);

if (args.list) {
  for (const entry of entries) console.log(`${entry.layer.padEnd(9)} ${entry.name}`);
  console.log(`\n共 ${entries.length} 个用例文件（node ${entries.filter((e) => e.layer === 'node').length} / electron ${entries.filter((e) => e.layer === 'electron').length}）`);
  process.exit(0);
}

if (!selected.length) {
  console.log(`没有匹配的用例文件（layer=${args.layer} filter=${args.filter || '无'}）`);
  process.exit(0);
}

if (!fs.existsSync(CORE_ENTRY)) {
  console.error('✗ 找不到 packages/core/dist/index.js，请先构建：pnpm --filter @moyu/core build');
  process.exit(2);
}

const ELECTRON_ARTIFACTS = [
  path.join(ROOT, 'apps', 'desktop', 'dist', 'index.html'),
  path.join(ROOT, 'apps', 'desktop', 'dist-electron', 'app.js'),
];
const electronAvailable = fs.existsSync(ELECTRON_BIN) && ELECTRON_ARTIFACTS.every((artifact) => fs.existsSync(artifact));
const runnable = selected.filter((entry) => entry.layer === 'node' || electronAvailable);
const skipped = selected.filter((entry) => entry.layer === 'electron' && !electronAvailable);

if (skipped.length) {
  const missing = !fs.existsSync(ELECTRON_BIN)
    ? `没找到 ${path.relative(ROOT, ELECTRON_BIN)}`
    : '缺少桌面构建产物（先跑 pnpm --filter @moyu/desktop build）';
  console.log(`跳过 ${skipped.length} 个需要 Electron 的用例：${missing}`);
}
console.log(`跑 ${runnable.length} 个用例文件（jobs=${args.jobs}）\n`);

const startedAt = Date.now();
const results = await runPool(runnable);
const failed = results.filter((result) => !result.ok);
const totals = results.reduce((sum, item) => ({
  pass: sum.pass + (item.counts.pass ?? 0),
  fail: sum.fail + (item.counts.fail ?? 0),
}), { pass: 0, fail: 0 });

console.log(`\n合计：${totals.pass} pass / ${totals.fail} fail，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

if (failed.length) {
  console.log(`\n失败文件（${failed.length}）：`);
  for (const item of failed) {
    console.log(`\n=== ${item.name} ===`);
    const lines = item.output.split('\n');
    const interesting = lines.filter((line) => /not ok|error:|Error:|assert|expected|actual/i.test(line)).slice(0, 12);
    console.log((interesting.length ? interesting : lines.slice(-15)).join('\n').trim());
  }
  process.exit(1);
}
console.log('全部通过');