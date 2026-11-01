import fs from 'node:fs';
import path from 'node:path';
import type { MemoryFact } from './types';
import { newId, summarize } from './util';

/**
 * 长期记忆的 Markdown 资料库：每个 Bot / 群聊一个目录，索引为 MEMORY.md，
 * 单条记忆是带 front-matter 的独立 Markdown 文件。人可以直接在编辑器里
 * 浏览、修改、增删；应用启动时把目录内容读回内存（无 front-matter 的文件
 * 会被收编为一条新记忆并补上元数据）。
 *
 * 目录 layout：
 *   <root>/<scopeId>/MEMORY.md          索引：一行一条，链接到具体文件
 *   <root>/<scopeId>/<主题>-<id6>.md    单条记忆：front-matter + 正文
 */

export const MEMORY_INDEX_FILE = 'MEMORY.md';

const ENTRY_ID_PATTERN = /^mem_[A-Za-z0-9_-]+$/;

interface EntryMeta {
  id: string;
  scope?: string;
  pinned?: boolean;
  source?: string;
  createdAt?: number;
  lastUsedAt?: number;
}

export interface AdoptedEntry {
  fact: MemoryFact;
  /** 被收编的原始文件，收编后应删除以免重复加载。 */
  file: string;
}

/** Windows 文件名禁止字符、控制字符、Markdown 链接里会破格或引起歧义解码的字符。 */
const FILENAME_FORBIDDEN = /[\\/:*?"<>|\x00-\x1f\x7f[\]()#%]/gu;

export function memorySlug(text: string): string {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? '').replace(FILENAME_FORBIDDEN, ' ');
  const cleaned = firstLine.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/u, '');
  const slug = [...cleaned].slice(0, 24).join('').replace(/\s+/g, '-').replace(/[-.]+$/u, '');
  return slug || '记忆';
}

/** scopeId 只作目录名；合法字符之外的（含 Windows 禁止的冒号）替换掉，并挡住 .. 逃逸。 */
export function scopeDirName(scopeId: string): string {
  const name = scopeId.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+$/, '_').replace(/[.\s]+$/u, '');
  return name || 'unknown';
}

export function renderEntryFrontMatter(fact: MemoryFact): string {
  const lines = [
    '---',
    `id: ${fact.id}`,
    `scope: ${fact.botId}`,
    `pinned: ${fact.pinned ? 'true' : 'false'}`,
    `source: ${fact.source ?? 'manual'}`,
    `createdAt: ${new Date(fact.createdAt).toISOString()}`,
  ];
  if (typeof fact.lastUsedAt === 'number') lines.push(`lastUsedAt: ${new Date(fact.lastUsedAt).toISOString()}`);
  lines.push('---', '');
  return lines.join('\n');
}

export function renderMemoryEntry(fact: MemoryFact): string {
  return `${renderEntryFrontMatter(fact)}${fact.text.replace(/\r\n/g, '\n').trim()}\n`;
}

export function parseEntryMeta(raw: string): EntryMeta | undefined {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  const meta: EntryMeta = { id: '' };
  let closed = false;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === '---') { closed = true; break; }
    const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) return undefined;
    const [, key, value] = match;
    if (key === 'id') meta.id = value.trim();
    else if (key === 'scope') meta.scope = value.trim();
    else if (key === 'pinned') meta.pinned = value.trim() === 'true';
    else if (key === 'source' && (value.trim() === 'manual' || value.trim() === 'automatic')) meta.source = value.trim();
    else if (key === 'createdAt' || key === 'lastUsedAt') {
      const time = Date.parse(value.trim());
      if (Number.isFinite(time)) meta[key] = time;
    }
  }
  if (!closed || !ENTRY_ID_PATTERN.test(meta.id)) return undefined;
  return meta;
}

export function entryBody(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return raw.trim();
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.trim() === '---') return lines.slice(index + 1).join('\n').replace(/^\n+/, '').trim();
  }
  return raw.trim();
}

/** 索引里的条目标题：取首行，去掉会破坏 Markdown 链接的字符。 */
function indexTitle(fact: MemoryFact): string {
  const firstLine = (fact.text.split(/\r?\n/, 1)[0] ?? '').replace(/[[\]]/g, '').trim();
  if (!firstLine) return '未命名记忆';
  const title = [...firstLine].slice(0, 24).join('');
  return `${title}${firstLine.length > title.length ? '…' : ''}`;
}

export function renderMemoryIndex(facts: MemoryFact[], title: string, resolveFile: (fact: MemoryFact) => string): string {
  const ordered = [...facts].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const lines = [`# ${title}`, '', '按记录时间倒序；本索引由 MoyuBot 自动维护。直接编辑或增删链接到的记忆文件，重启后生效。', ''];
  if (!ordered.length) lines.push('（暂无记忆）', '');
  for (const fact of ordered) {
    // 文件名已去掉空格与链接敏感字符，链接直接写原始名字，保持索引可读。
    lines.push(`- ${fact.pinned ? '📌 ' : ''}[${indexTitle(fact)}](${resolveFile(fact)}) - ${summarize(fact.text, 80)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function memoryEntryFileName(fact: MemoryFact): string {
  return `${memorySlug(fact.text)}-${fact.id.slice(-6)}.md`;
}

function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (attempt >= 4) throw error;
      const wait = 40 + Math.floor(Math.random() * 40) * (attempt + 1);
      const until = Date.now() + wait;
      while (Date.now() < until) { /* 与 store 的 JSON 原子写保持同一套重试策略 */ }
    }
  }
}

export class MemoryLibrary {
  constructor(readonly rootDir: string) {}

  scopeDir(scopeId: string): string {
    return path.join(this.rootDir, scopeDirName(scopeId));
  }

  /** 目标路径被其他记忆占用时改用完整 id 命名，保证一条记忆一个文件、互不覆盖。 */
  private entryPathFor(fact: MemoryFact): string {
    const dir = this.scopeDir(fact.botId);
    const base = memoryEntryFileName(fact);
    const occupied = (name: string) => {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) return false;
      const meta = parseEntryMeta(fs.readFileSync(file, 'utf8'));
      return !meta || meta.id !== fact.id;
    };
    if (!occupied(base)) return path.join(dir, base);
    const full = path.join(dir, `${memorySlug(fact.text)}-${fact.id}.md`);
    if (!occupied(path.basename(full))) return full;
    for (let counter = 1; ; counter++) {
      const name = path.basename(full).replace(/\.md$/u, `-${counter}.md`);
      if (!occupied(name)) return path.join(dir, name);
    }
  }

  /** 同一 id 的旧文件（改名/改文本前的残留）一并清掉，避免重复加载。 */
  private dropStaleFiles(scopeId: string, id: string, keep?: string): void {
    for (const file of this.entryFiles(scopeId)) {
      if (file === keep) continue;
      const meta = parseEntryMeta(fs.readFileSync(file, 'utf8'));
      if (meta?.id === id) { try { fs.unlinkSync(file); } catch { /* 下次同步再清 */ } }
    }
  }

  writeEntry(fact: MemoryFact): void {
    const file = this.entryPathFor(fact);
    writeTextAtomic(file, renderMemoryEntry(fact));
    this.dropStaleFiles(fact.botId, fact.id, file);
  }

  removeEntry(scopeId: string, id: string): void {
    for (const file of this.entryFiles(scopeId)) {
      const meta = parseEntryMeta(fs.readFileSync(file, 'utf8'));
      if (meta?.id === id) { try { fs.unlinkSync(file); } catch { /* 文件被占用时跳过，索引已不再引用 */ } }
    }
  }

  /** 索引里的链接必须指向磁盘上的真实文件名（正文被手工编辑后，按文本推算的名字会失真）。 */
  private indexFileMap(scopeId: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of this.entryFiles(scopeId)) {
      const meta = parseEntryMeta(fs.readFileSync(file, 'utf8'));
      if (meta) map.set(meta.id, path.basename(file));
    }
    return map;
  }

  writeIndex(scopeId: string, facts: MemoryFact[], title: string): void {
    const files = this.indexFileMap(scopeId);
    const scoped = facts.filter((fact) => fact.botId === scopeId);
    this.writeIndexFile(scopeId, renderMemoryIndex(scoped, title, (fact) => files.get(fact.id) ?? path.basename(memoryEntryFileName(fact))));
  }

  private writeIndexFile(scopeId: string, content: string): void {
    writeTextAtomic(path.join(this.scopeDir(scopeId), MEMORY_INDEX_FILE), content);
  }

  /** 对端同步 / 迁移后的整目录对账：删掉对端已移除的条目、补齐缺失文件、重建索引。
   *  没有 front-matter 的文件属于尚未收编的手工记忆，保留到下次启动收编。 */
  reconcileScope(scopeId: string, facts: MemoryFact[], title: string): void {
    const keep = new Set(facts.map((fact) => fact.id));
    for (const file of this.entryFiles(scopeId)) {
      const meta = parseEntryMeta(fs.readFileSync(file, 'utf8'));
      if (meta && !keep.has(meta.id)) { try { fs.unlinkSync(file); } catch { /* 下次对账再清 */ } }
    }
    for (const fact of facts) if (fact.botId === scopeId) this.writeEntry(fact);
    this.writeIndex(scopeId, facts, title);
  }

  entryFiles(scopeId: string): string[] {
    const dir = this.scopeDir(scopeId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== MEMORY_INDEX_FILE)
      .map((entry) => path.join(dir, entry.name))
      .sort();
  }

  listScopes(): string[] {
    if (!fs.existsSync(this.rootDir)) return [];
    return fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => this.entryFiles(name).length > 0)
      .sort();
  }

  /**
   * 读取一个范围的全部记忆。带合法 front-matter 的文件按元数据恢复；
   * 没有 front-matter 的文件视为手工放入的记忆，收编为一条新记忆（调用方
   * 负责把收编结果写回并删除原文件）。
   */
  loadScope(scopeId: string): { facts: MemoryFact[]; adopted: AdoptedEntry[] } {
    const facts: MemoryFact[] = [];
    const adopted: AdoptedEntry[] = [];
    const seen = new Set<string>();
    for (const file of this.entryFiles(scopeId)) {
      let raw = '';
      try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const meta = parseEntryMeta(raw);
      const text = entryBody(raw);
      if (!text) continue;
      if (meta && seen.has(meta.id)) continue;
      if (meta) {
        seen.add(meta.id);
        facts.push({
          id: meta.id,
          botId: scopeId,
          text,
          pinned: meta.pinned ?? false,
          source: meta.source === 'automatic' ? 'automatic' : 'manual',
          createdAt: meta.createdAt ?? fs.statSync(file).mtimeMs,
          ...(typeof meta.lastUsedAt === 'number' ? { lastUsedAt: meta.lastUsedAt } : {}),
        });
      } else {
        const stat = fs.statSync(file);
        adopted.push({
          fact: { id: newId('mem'), botId: scopeId, text, pinned: false, source: 'manual', createdAt: stat.mtimeMs },
          file,
        });
      }
    }
    return { facts, adopted };
  }
}
