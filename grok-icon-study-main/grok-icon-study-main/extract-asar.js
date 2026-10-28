#!/usr/bin/env node
// 解析 Electron asar 归档：列出所有文件并提取图标/logo/svg/png 相关资源
// 用法: node extract-asar.js <app.asar 路径> <输出目录>
const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];
const outDir = process.argv[3] || 'extracted';
if (!asarPath) { console.error('usage: node extract-asar.js <app.asar> [outdir]'); process.exit(1); }

const fd = fs.openSync(asarPath, 'r');
// 实际布局: [4B: 4][4B: pickleSize][4B: strLen+5][4B: strLen][JSON @16][1B: \0][数据...]
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const pickleSize = head.readUInt32LE(4);
const strLen = head.readUInt32LE(12);
console.log('pickleSize:', pickleSize, 'strLen:', strLen);

const jsonBuf = Buffer.alloc(strLen);
fs.readSync(fd, jsonBuf, 0, strLen, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 16 + strLen + 1;
console.log('dataStart =', dataStart, '\n');

// 遍历文件树
const interesting = [];
const allFiles = [];
function walk(node, prefix) {
  for (const [name, info] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (info.files) { walk(info, p); continue; }
    allFiles.push({ p, size: info.size, offset: info.offset, unpacked: !!info.unpacked });
    const lower = p.toLowerCase();
    if (/(icon|logo|grok|swirl|sparkle|favicon|mark\b|brand|symbol)/.test(lower) && /\.(svg|png|webp|jpg|jpeg|icns|ico)$/.test(lower)) {
      interesting.push({ p, size: info.size, offset: info.offset, unpacked: !!info.unpacked });
    }
  }
}
walk(header, '');

console.log(`总文件数: ${allFiles.length}`);
console.log(`图标/logo 相关候选: ${interesting.length}\n`);
for (const f of interesting) {
  console.log(`  ${String(f.size).padStart(9)}  ${f.p}${f.unpacked ? '  [unpacked]' : ''}`);
}

// 提取
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const f of interesting) {
  const out = path.join(outDir, f.p);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (f.unpacked) {
    const src = path.join(path.dirname(asarPath) + '.unpacked', f.p);
    if (fs.existsSync(src)) { fs.copyFileSync(src, out); n++; continue; }
  }
  if (f.offset === undefined) continue;
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, dataStart + parseInt(f.offset));
  fs.writeFileSync(out, buf);
  n++;
}
console.log(`\n已提取 ${n} 个文件到 ${outDir}/`);
fs.closeSync(fd);
