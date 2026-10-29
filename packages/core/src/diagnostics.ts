import fs from 'node:fs';
import path from 'node:path';
import { newId } from './util';

export interface DiagnosticEntry {
  id: string;
  createdAt: number;
  source: string;
  message: string;
  command?: string;
  detail?: string;
}

/** Best effort scrubbing, followed by a user-visible preview before sharing. */
export function redactDiagnostic(text: string, secrets: string[] = []): string {
  let value = String(text);
  for (const secret of [...new Set(secrets)].filter((item) => item.length >= 4).sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([secret, encodeURIComponent(secret)])) value = value.split(variant).join('[已隐藏]');
  }
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[私钥已隐藏]')
    .replace(/\b(?:Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]+/gi, '[认证信息已隐藏]')
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[a-zA-Z0-9_-]{8,}/g, '[密钥已隐藏]')
    .replace(/((?:["']?(?:[\w-]*(?:api[-_]?key|token|secret|password|passwd)|authorization|cookie)["']?)\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s<>"'`]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.toString();
      } catch { return '[链接已隐藏]'; }
    })
    .replace(/\b[A-Z]:[\\/]Users[\\/][^\\/\s"']+/gi, 'C:/Users/[用户]')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '/home/[用户]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]');
}

/** Local bounded journal: failures only, no successful output or chat history. */
export class DiagnosticJournal {
  private entries: DiagnosticEntry[] = [];
  private readonly file: string;
  constructor(dataDir: string, private secrets: () => string[] = () => []) {
    this.file = path.join(dataDir, 'diagnostics.json');
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) this.entries = saved.filter((entry) => typeof entry?.id === 'string' && Number.isFinite(entry.createdAt) && typeof entry.message === 'string').slice(-60).map((entry) => this.clean(entry));
    } catch { /* New or damaged journal. */ }
    this.prune();
    this.flush();
  }
  private clean(entry: DiagnosticEntry): DiagnosticEntry {
    const scrub = (text: string, length: number) => redactDiagnostic(text, this.secrets()).slice(0, length);
    return { id: entry.id, createdAt: entry.createdAt, source: scrub(entry.source || 'app', 80), message: scrub(entry.message, 1000), command: entry.command ? scrub(entry.command, 2000) : undefined, detail: entry.detail ? scrub(entry.detail, 2500) : undefined };
  }
  private prune(): void { this.entries = this.entries.filter((entry) => entry.createdAt > Date.now() - 7 * 86400_000).slice(-60); }
  private flush(): void {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.entries), { encoding: 'utf8', mode: 0o600 }); } catch { /* Diagnostics must never break app work. */ }
  }
  record(input: Omit<DiagnosticEntry, 'id' | 'createdAt'>): void {
    this.prune();
    const entry = this.clean({ ...input, id: newId('diag'), createdAt: Date.now() });
    const last = this.entries.at(-1);
    if (last && last.source === entry.source && last.message === entry.message && last.command === entry.command && entry.createdAt - last.createdAt < 3000) return;
    this.entries = [...this.entries, entry].slice(-60); this.flush();
  }
  list(): DiagnosticEntry[] { this.prune(); this.entries = this.entries.map((entry) => this.clean(entry)); this.flush(); return this.entries.map((entry) => ({ ...entry })).reverse(); }
  clear(): void { this.entries = []; this.flush(); }
}
