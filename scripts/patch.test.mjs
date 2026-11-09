import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch, applyHunk, assertSafePatchPath } from '../packages/core/dist/patch.js';

/** 把补丁里唯一的 hunk 应用到给定文本。 */
function applyOne(patchText, fileText) {
  const parsed = parsePatch(patchText);
  assert.equal(parsed.error, undefined, '补丁应能解析：' + parsed.error);
  assert.ok(parsed.changes[0]?.hunks[0], '应有一个修改块');
  return applyHunk(fileText, parsed.changes[0].hunks[0]);
}

test('*** End of File 在目标不在末尾时报错，而不是把内容复制到尾部', () => {
  const file = ['line A', 'target', 'line C', 'line D', 'line E'].join('\n');
  const patch = `*** Begin Patch
*** Update File: demo.txt
@@
 target
+added
*** End of File
*** End Patch`;
  const result = applyOne(patch, file);
  assert.match(result.error ?? '', /End of File 锚定失败/, '必须报错');
  assert.equal(result.text, undefined, '不能产出被改坏的文本');
});

test('*** End of File 在目标确实贴末尾时正常应用', () => {
  const file = ['line A', 'line B', 'target'].join('\n');
  const patch = `*** Begin Patch
*** Update File: demo.txt
@@
 target
+added
*** End of File
*** End Patch`;
  const result = applyOne(patch, file);
  assert.equal(result.error, undefined);
  assert.equal(result.text, ['line A', 'line B', 'target', 'added'].join('\n'));
});

test('普通修改块：按上下文定位，删一行加一行', () => {
  const file = ['alpha', 'beta', 'gamma'].join('\n');
  const patch = `*** Begin Patch
*** Update File: demo.txt
@@ beta
-beta
+BETA
*** End Patch`;
  const result = applyOne(patch, file);
  assert.equal(result.error, undefined);
  assert.equal(result.text, ['alpha', 'BETA', 'gamma'].join('\n'));
});

test('修改块匹配不上时报错并说明可能已变化', () => {
  const result = applyOne(`*** Begin Patch
*** Update File: demo.txt
@@
-不存在的行
*** End Patch`, ['alpha', 'beta'].join('\n'));
  assert.match(result.error ?? '', /没匹配上原文/);
});

test('补丁路径：只接受相对 Bot 工作目录的路径', () => {
  for (const bad of ['../escape.txt', '../../etc/passwd', '/etc/passwd', 'C:/Windows/System32/x.dll', '~/secrets']) {
    assert.throws(() => assertSafePatchPath(bad), /工作区|相对|不能包含/, bad + ' 应被拒绝');
  }
  for (const good of ['a/b.md', './docs/x.md', 'notes.txt']) {
    assert.equal(assertSafePatchPath(good), good, good + ' 应被接受');
  }
});