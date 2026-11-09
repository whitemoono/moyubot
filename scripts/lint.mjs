#!/usr/bin/env node
/**
 * 零依赖的"棘轮式"代码体检：只保证**不变得更糟**，不要求一次性还清历史债。
 *
 * 为什么不直接上 ESLint：装 eslint + typescript-eslint 会动 lockfile，而且当前代码里有
 * 64 个 TODO、30 处 any、13 处 console，一次性开规则等于当天 CI 全红、然后被关掉。
 * 这里用基线文件（.lint-baseline.json）记录当前数值：超过基线就失败，降下来就提示可以下调。
 *
 * 用法：
 *   node scripts/lint.mjs                   # 与基线比较（CI 用）
 *   node scripts/lint.mjs --update-baseline # 冻结当前数值为新基线
 *   node scripts/lint.mjs --report          # 只打印当前数值
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(ROOT, '.lint-baseline.json');
const SCAN_ROOTS = [
  path.join(ROOT, 'packages', 'core', 'src'),
  path.join(ROOT, 'apps', 'desktop', 'src'),
  path.join(ROOT, 'apps', 'desktop', 'electron'),
];
const EXTENSIONS = ['.ts', '.tsx'];

const mode = process.argv.includes('--update-baseline') ? 'update'
  : process.argv.includes('--report') ? 'report' : 'check';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((dir) => walk(dir));
const texts = files.map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }));

function count(pattern) {
  return texts.reduce((sum, item) => sum + (item.text.match(pattern) ?? []).length, 0);
}

/** 绝对值指标：越多越糟。 */
const metrics = {
  consoleCalls: count(/console\.(?:log|warn|error|info|debug)\s*\(/g),
  anyTypes: count(/(?::\s*any\b|\bas\s+any\b|<any>)/g),
  tsIgnore: count(/@ts-(?:ignore|expect-error)/g),
  todos: count(/\b(?:TODO|FIXME|HACK)\b/g),
  largestFileChars: Math.max(...texts.map((item) => item.text.length)),
};

/** 0 字节但被 git 跟踪的文件（仓库卫生）。 */
function emptyTrackedFiles() {
  try {
    const listed = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    return listed.filter((file) => {
      const full = path.join(ROOT, file);
      return fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size === 0;
    });
  } catch {
    return [];
  }
}
metrics.emptyTrackedFiles = emptyTrackedFiles().length;

console.log('当前数值：');
for (const [key, value] of Object.entries(metrics)) console.log(`  ${key.padEnd(20)} ${value}`);
if (metrics.emptyTrackedFiles) console.log(`  0 字节跟踪文件：${emptyTrackedFiles().join(', ')}`);

if (mode === 'report') process.exit(0);

if (mode === 'update') {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`\n已写入基线：${path.basename(BASELINE_FILE)}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error(`\n✗ 缺少 ${path.basename(BASELINE_FILE)}，先运行 node scripts/lint.mjs --update-baseline`);
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
const failures = [];
const improvements = [];
for (const [key, value] of Object.entries(metrics)) {
  const allowed = baseline[key];
  if (typeof allowed !== 'number') continue;
  if (value > allowed) failures.push(`${key}: ${allowed} → ${value}（+${value - allowed}）`);
  else if (value < allowed) improvements.push(`${key}: ${allowed} → ${value}`);
}

if (improvements.length) {
  console.log(`\n比基线更好，可以下调基线（node scripts/lint.mjs --update-baseline）：`);
  for (const line of improvements) console.log(`  ${line}`);
}
if (failures.length) {
  console.error(`\n✗ 体检回退（比基线更糟）：`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('\n体检通过：没有比基线更糟');