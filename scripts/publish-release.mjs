#!/usr/bin/env node
/**
 * 发布当前版本到 GitHub Releases（whitemoono/moyubot）。
 * 凭据来源：环境变量 GH_TOKEN / GITHUB_TOKEN，或系统 git 凭据（git credential fill）。
 * 更新器（apps/desktop/electron/updates.ts）要求：
 *   - 最新 release 的 tag 为 v<版本>
 *   - 资产名精确为 MoyuBot.Setup.<版本>.exe
 *   - 同 release 内有 SHA256SUMS.txt（或 GitHub 的 asset digest）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = 'whitemoono/moyubot';
const root = process.cwd();
// 版本号默认取 apps/desktop/package.json，可用 `pnpm release:github -- 0.1.7` 指定（重建某个版本的 release）。
const version = (process.argv[2] ?? JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version).replace(/^v/, '');
const tag = `v${version}`;
const releaseFile = path.join(root, 'apps/desktop/release');
/** 手写说明文件：pnpm release:github -- 0.1.7 --notes=docs/release-0.1.7.md（可选）。 */
const notesArg = process.argv.slice(2).find((arg) => arg.startsWith('--notes='))?.slice('--notes='.length);
const compareUrl = `https://github.com/${REPO}/compare`;

/** 生成 release 说明：优先用手写文件，否则用「上个 tag..当前 tag」的提交列表。 */
function buildNotes() {
  if (notesArg) {
    const file = path.resolve(root, notesArg);
    if (fs.existsSync(file)) console.log(`使用手写说明：${notesArg}`);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  let previous = '';
  try { previous = execFileSync('git', ['describe', '--tags', '--abbrev=0', `${tag}^`], { encoding: 'utf8' }).trim(); } catch { /* 没有上一个 tag */ }
  let commits = '';
  try {
    commits = execFileSync('git', ['log', `${previous || tag}..${tag}`, '--pretty=format:- %s'], { encoding: 'utf8' }).trim();
  } catch { commits = ''; }
  const lines = commits ? commits.split('\n') : [`- 版本 ${version}`];
  const compare = previous ? `**Full Changelog**: ${compareUrl}/${previous}...${tag}` : '';
  return ['## 更新内容', '', ...lines, '', compare].filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n').trim();
}

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  for (const host of ['github.com', 'https://github.com']) {
    try {
      const out = execFileSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=${host.replace(/^https:\/\//, '')}\n\n`, encoding: 'utf8' });
      const password = out.split('\n').find((line) => line.startsWith('password='))?.slice('password='.length);
      if (password) return password.trim();
    } catch { /* 试下一个 host 形式 */ }
  }
  throw new Error('没有 GitHub 凭据：请设置 GH_TOKEN 或先 git auth（credential fill 能取到 token）');
}

const headers = () => ({
  Authorization: `Bearer ${token()}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'moyubot-release',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function api(route, options = {}) {
  const response = await fetch(`https://api.github.com${route}`, { ...options, headers: { ...headers(), ...(options.headers ?? {}) } });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function ensureRelease() {
  const existing = await api(`/repos/${REPO}/releases/tags/${tag}`);
  if (existing.ok) {
    console.log(`release ${tag} 已存在（id ${existing.data.id}）`);
    if (existing.data.draft) console.log('  注意：该 release 目前是 draft，更新器不会看到它');
    if (!existing.data.body || existing.data.body.length < 120) {
      const body = buildNotes();
      await api(`/repos/${REPO}/releases/${existing.data.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      console.log('  已补充更新说明（原说明为空或过短）');
    }
    return existing.data;
  }
  const created = await api(`/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `MoyuBot ${version}`,
      draft: false,
      prerelease: false,
      body: buildNotes(),
    }),
  });
  if (!created.ok) throw new Error(`创建 release 失败：${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
  console.log(`release ${tag} 已创建（id ${created.data.id}）`);
  return created.data;
}

async function upload(releaseId, filePath, name) {
  const existing = (await api(`/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`)).data;
  if (Array.isArray(existing) && existing.length) {
    for (const asset of existing) {
      if (asset.name !== name) continue;
      await api(`/repos/${REPO}/releases/assets/${asset.id}`, { method: 'DELETE' });
      console.log(`  删除旧资产 ${name}`);
    }
  }
  const bytes = fs.readFileSync(filePath);
  const response = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) },
    body: bytes,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`上传 ${name} 失败：${response.status} ${text.slice(0, 300)}`);
  const asset = JSON.parse(text);
  console.log(`  已上传 ${name}（${(bytes.length / 1024 / 1024).toFixed(1)} MB）→ ${asset.browser_download_url ?? ''}`);
  return asset;
}

const installer = path.join(releaseFile, `MoyuBot.Setup.${version}.exe`);
if (!fs.existsSync(installer)) throw new Error(`找不到安装包：${installer}（先运行 pnpm --filter @moyu/desktop dist）`);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
const sums = path.join(releaseFile, 'SHA256SUMS.txt');
fs.writeFileSync(sums, `${sha256}  MoyuBot.Setup.${version}.exe\n`, 'utf8');
console.log(`SHA256 ${sha256}`);

const release = await ensureRelease();
await upload(release.id, sums, 'SHA256SUMS.txt');
await upload(release.id, installer, `MoyuBot.Setup.${version}.exe`);
const blockmap = `${installer}.blockmap`;
if (fs.existsSync(blockmap)) await upload(release.id, blockmap, path.basename(blockmap));

const latest = await api(`/repos/${REPO}/releases/latest`);
console.log(`\n最新 release：${latest.data?.tag_name}（draft=${latest.data?.draft}）`);
console.log(`页面：https://github.com/${REPO}/releases/tag/${tag}`);