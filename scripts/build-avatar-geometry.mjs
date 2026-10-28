/**
 * Extract the bot-avatar geometry MoyuBot needs from the upstream study repo.
 *
 * The upstream project (https://github.com/blessonism/grok-icon-study) ships no license and
 * asks that its assets not be redistributed, so we do NOT vendor its source files. Instead this
 * script distils the handful of numbers an avatar needs (body path + a few eye pairs) into a
 * small JSON the renderer can draw, and it only runs when someone wants to regenerate that file.
 *
 *   1) download the upstream files (see docs/ASSETS.md for the exact steps)
 *   2) place geometry-data.js next to this checkout, e.g. .work/grok-src/geometry-data.js
 *   3) node scripts/build-avatar-geometry.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * 只用上游标注为 idle 的那一组眼睛（`eyes[0]`，即官方静态 SVG 里的配对）。
 * 其余 24 组是为旋转/倾斜过的身形准备的，直接放到正立的 blob 上会歪到轮廓外，
 * 所以表情差异改由渲染层对同一组眼睛做 transform 来得到（见 BotAvatar.tsx）。
 */
const EYE_PAIRS = [0];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.GROK_GEO ?? path.join(root, '.work', 'grok-src', 'geometry-data.js');
const target = path.join(root, 'apps', 'desktop', 'src', 'assets', 'grok', 'avatar-geometry.json');

if (!fs.existsSync(source)) {
  console.error(`找不到 upstream 几何数据：${source}\n先按 docs/ASSETS.md 下载，或用 GROK_GEO 指定路径。`);
  process.exit(1);
}

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(source, 'utf8'), sandbox);
const geo = sandbox.window.GROK_GEO;

const ringToPath = (ring) => {
  const [first, ...rest] = ring;
  const head = `M${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
  return head + rest.map(([x, y]) => `L${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
};

const eyes = EYE_PAIRS.map((index) => ({
  id: index,
  rings: geo.eyes[index].map(ringToPath),
}));

const payload = {
  source: 'https://github.com/blessonism/grok-icon-study',
  note: 'Geometry distilled from the upstream study repo; character design belongs to xAI. See docs/ASSETS.md.',
  viewBox: [geo.viewBox.minX, geo.viewBox.minY, geo.viewBox.width, geo.viewBox.height],
  body: geo.blobPath,
  eyes,
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const bytes = fs.statSync(target).size;
console.log(`✓ ${path.relative(root, target)} (${(bytes / 1024).toFixed(1)} KB, ${eyes.length} 组眼睛)`);
