/**
 * Codex 风格补丁解析与执行（对齐 DSH 的 apply_patch）。
 *
 * 格式：
 *   *** Begin Patch
 *   *** Add File: path/to/new.ts
 *   +新增行
 *   *** Update File: path/to/exist.ts
 *   *** Move to: path/to/renamed.ts        （可选）
 *   @@ 上下文定位
 *    未变行（空格前缀）
 *   -删除的行
 *   +新增的行
 *   *** Delete File: path/to/gone.ts
 *   *** End Patch
 *
 * 设计取舍：一次调用改多个文件的多个位置，减少模型往返；按顺序执行，遇错即停，不自动回滚
 * （调用方拿到已应用的清单后可自行重试）。
 */

export interface PatchChange {
  kind: 'add' | 'update' | 'delete';
  path: string;
  moveTo?: string;
  hunks: PatchHunk[];
  addLines?: string[];
}

export interface PatchHunk {
  /** 定位上下文（@@ 后面的文本，可为空） */
  context?: string;
  /** 锚定文件末尾（*** End of File） */
  atEnd?: boolean;
  /** 原文行（保留等行与删除行；前缀已去掉） */
  remove: string[];
  /** 新增行 */
  add: string[];
  /** 原始 hunk 行（用于精确匹配与错误提示） */
  raw: string[];
}

export interface PatchResult {
  ok: boolean;
  applied: { kind: PatchChange['kind']; path: string; moveTo?: string }[];
  error?: string;
}

/** 解析补丁文本；失败时给出可定位的错误（行号 + 原因）。 */
export function parsePatch(input: string): { changes: PatchChange[]; error?: string } {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const changes: PatchChange[] = [];
  let index = 0;
  const fail = (message: string, at: number) => ({ changes, error: `第 ${at + 1} 行：${message}` });

  // 允许前后有空白行
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  if (lines[index]?.trim() !== '*** Begin Patch') return fail('补丁必须以 *** Begin Patch 开头', index);
  index += 1;

  let current: PatchChange | undefined;
  let hunk: PatchHunk | undefined;
  const flushHunk = () => { if (current && hunk) { current.hunks.push(hunk); hunk = undefined; } };

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '*** End Patch') { flushHunk(); return { changes }; }
    if (line.startsWith('*** Add File: ')) {
      flushHunk();
      current = { kind: 'add', path: line.slice('*** Add File: '.length).trim(), hunks: [], addLines: [] };
      changes.push(current);
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      flushHunk();
      current = { kind: 'update', path: line.slice('*** Update File: '.length).trim(), hunks: [] };
      changes.push(current);
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      flushHunk();
      current = { kind: 'delete', path: line.slice('*** Delete File: '.length).trim(), hunks: [] };
      changes.push(current);
      continue;
    }
    if (!current) return fail('补丁内容出现在文件头之前（先写 *** Add/Update/Delete File）', index);
    if (line.startsWith('*** Move to: ')) {
      if (current.kind !== 'update') return fail('只有 *** Update File 可以 *** Move to', index);
      current.moveTo = line.slice('*** Move to: '.length).trim();
      continue;
    }
    if (current.kind === 'add') {
      if (line.startsWith('+')) current.addLines!.push(line.slice(1));
      else if (!line.trim()) current.addLines!.push('');
      else return fail(`新增文件的行必须以 + 开头：${line}`, index);
      continue;
    }
    if (current.kind === 'delete') continue;
    // update 文件
    if (line.startsWith('@@')) {
      flushHunk();
      // raw 只记内容行：@@ 是定位标记，不参与原文匹配。
      hunk = { context: line.slice(2).trim() || undefined, remove: [], add: [], raw: [] };
      continue;
    }
    if (line.trim() === '*** End of File') {
      if (hunk) { hunk.atEnd = true; hunk.raw.push(line); }
      continue;
    }
    if (!hunk) {
      if (!line.trim()) continue;
      return fail('修改块必须从 @@ 或 *** End of File 开始', index);
    }
    hunk.raw.push(line);
    if (line.startsWith('+')) hunk.add.push(line.slice(1));
    else if (line.startsWith('-')) hunk.remove.push(line.slice(1));
    else if (line.startsWith(' ')) { hunk.remove.push(line.slice(1)); hunk.add.push(line.slice(1)); }
    else if (!line.trim()) { hunk.remove.push(''); hunk.add.push(''); }
    else return fail(`修改块的行必须以 +、- 或空格开头：${line}`, index);
  }
  return fail('补丁缺少 *** End Patch', lines.length);
}

/** 在文件文本上应用单个修改块；返回新文本或错误。 */
export function applyHunk(text: string, hunk: PatchHunk): { text?: string; error?: string } {
  const fileLines = text.split('\n');
  const target = hunk.raw.filter((line) => !line.startsWith('+') && line.trim() !== '*** End of File')
    .map((line) => (line.startsWith(' ') || line.startsWith('-') ? line.slice(1) : line));
  const replacement = hunk.raw.filter((line) => !line.startsWith('-') && line.trim() !== '*** End of File')
    .map((line) => (line.startsWith(' ') || line.startsWith('+') ? line.slice(1) : line));

  const findFrom = (start: number) => {
    for (let at = start; at + target.length <= fileLines.length; at += 1) {
      let matched = true;
      for (let offset = 0; offset < target.length; offset += 1) {
        if (fileLines[at + offset] !== target[offset]) { matched = false; break; }
      }
      if (matched) return at;
    }
    return -1;
  };

  let start = 0;
  if (hunk.atEnd) {
    // 锚定到文件末尾：从后往前找
    const expected = target.length;
    start = fileLines.length - expected;
    if (start >= 0 && findFrom(0) === -1) {
      // 精确比对末尾
      for (let at = Math.max(0, fileLines.length - expected); at >= 0; at -= 1) {
        if (findFrom(at) === at) { start = at; break; }
        start = -1;
      }
    }
    if (start < 0) {
      const at = findLastOccurrence(fileLines, target);
      if (at === -1) return { error: `没有找到 End of File 锚定的内容（期望 ${expected} 行）` };
      start = at;
    }
  } else {
    if (hunk.context) {
      const anchor = fileLines.findIndex((line) => line.includes(hunk.context!));
      if (anchor >= 0) {
        const at = findFrom(Math.max(0, anchor - target.length));
        start = at >= 0 ? at : findFrom(0);
      } else start = findFrom(0);
    } else {
      start = findFrom(0);
    }
  }
  if (start < 0) {
    return { error: `修改块没匹配上原文（期望 ${target.length} 行，首行「${target[0] ?? ''}」）；文件可能已变化，先读取再重试` };
  }
  const next = [...fileLines.slice(0, start), ...replacement, ...fileLines.slice(start + target.length)];
  return { text: next.join('\n') };
}

function findLastOccurrence(fileLines: string[], target: string[]): number {
  for (let at = fileLines.length - target.length; at >= 0; at -= 1) {
    let matched = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (fileLines[at + offset] !== target[offset]) { matched = false; break; }
    }
    if (matched) return at;
  }
  return -1;
}