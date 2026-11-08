/**
 * 把 office.ts 打成一个自包含的 CJS 运行时（依赖全部内联），
 * 用于推到云电脑执行——云机不需要预装 exceljs/docx/pptxgenjs。
 *
 * 产物：packages/core/dist/office-cloud-runtime.js（导出 default 字符串）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/office-runner.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // 云机只需 node，标准库保持外部
  external: ['node:fs', 'node:path', 'node:buffer', 'node:stream', 'node:crypto', 'node:util', 'node:os', 'node:url', 'node:zlib', 'node:http', 'node:https', 'node:events', 'node:child_process', 'node:assert'],
  logLevel: 'silent',
});
const code = result.outputFiles[0]?.text ?? '';
if (!code) throw new Error('esbuild 没有产出 office 运行时');
const banner = '// MoyuBot 云端 Office 运行时（自包含，由 @moyu/core 构建生成）\n';
const module = `${banner}module.exports = ${JSON.stringify(code)};\n`;
fs.writeFileSync(path.join(outDir, 'office-cloud-runtime.js'), module, 'utf8');
// 供 office-router 的 TS 引用：运行时就是一段源码字符串；bundle 脚本先跑，tsc 后跑，所以占位即可
if (!fs.existsSync(path.join(outDir, 'office-cloud-runtime.d.ts'))) {
  fs.writeFileSync(path.join(outDir, 'office-cloud-runtime.d.ts'), 'declare const source: string;\nexport default source;\n', 'utf8');
}
console.log(`office 运行时已生成：${(code.length / 1024).toFixed(0)} KB`);