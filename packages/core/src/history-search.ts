import { DatabaseSync } from 'node:sqlite';
import type { Message } from './types';

/**
 * 历史消息检索（Timeline / Episodic Memory）。
 *
 * 检索"过去真实发生过的事"（原始对话），与 `recall`（检索已整理的长期知识）职责分开。
 * 原始会话仍以 conversations/*.json 为事实来源，这里是一份可重建的派生索引：
 * 删除索引文件后，下次启动会从会话文件重建。
 *
 * 用 SQLite 的 LIKE 子串匹配（中文友好，无 FTS5 依赖，各处 SQLite 都能跑）；
 * 只建一张 message 表 + 时间索引，千级会话内性能足够。
 */
export class HistorySearch {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_conv_time ON message(conversationId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_message_time ON message(createdAt);
    `);
  }

  /** 索引一条消息（增量）。排除 tool/system/空流式，避免工具调用 JSON 污染索引。 */
  indexMessage(message: Message, conversationId: string): void {
    if (!this.isSearchable(message)) return;
    const content = this.searchableContent(message);
    if (!content) return;
    this.db.prepare(
      `INSERT INTO message (id, conversationId, role, createdAt, content)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         conversationId = excluded.conversationId,
         role = excluded.role,
         createdAt = excluded.createdAt,
         content = excluded.content`
    ).run(message.id, conversationId, message.role, message.createdAt ?? Date.now(), content);
  }

  removeConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM message WHERE conversationId = ?').run(conversationId);
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number }).n);
  }

  /**
   * 全文检索历史消息。中文经空格/标点拆成多个词，任一命中即返回（OR 关系），
   * 按时间倒序。返回真实时间与角色。
   */
  search(query: string, options: { conversationId?: string; limit?: number; since?: number; before?: number } = {}): HistoryHit[] {
    const limit = Math.max(1, options.limit ?? 8);
    const q = query.trim();
    if (!q) return [];
    const terms = q.split(/[\s,，。.；;、!！?？:：]+/).map((term) => term.trim()).filter((term) => term.length >= 2);
    if (!terms.length) return [];

    const params: (string | number)[] = [];
    const clauses: string[] = [];
    if (options.conversationId) { clauses.push('m.conversationId = ?'); params.push(options.conversationId); }
    if (options.since !== undefined) { clauses.push('m.createdAt >= ?'); params.push(options.since); }
    if (options.before !== undefined) { clauses.push('m.createdAt <= ?'); params.push(options.before); }
    const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

    // OR 子串匹配：任一搜索词命中即返回。
    const matchSql = terms.map(() => `m.content LIKE ?`).join(' OR ');
    const likeParams: (string | number)[] = terms.map((term) => `%${term}%`);
    const sql = `SELECT m.id, m.conversationId, m.role, m.createdAt, m.content
                 FROM message m WHERE (${matchSql})${where}
                 ORDER BY m.createdAt DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...likeParams, ...params, limit) as unknown as Row[];
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      role: row.role,
      createdAt: row.createdAt,
      text: row.content.slice(0, 200),
    }));
  }

  isSearchable(message: Message): boolean {
    return (message.role === 'user' || message.role === 'assistant') && !!message.content.trim() && !message.streaming;
  }

  searchableContent(message: Message): string {
    return message.content.trim().slice(0, 6000);
  }

  close(): void {
    this.db.close();
  }
}

interface Row {
  id: string;
  conversationId: string;
  role: string;
  createdAt: number;
  content: string;
}

export interface HistoryHit {
  id: string;
  conversationId: string;
  role: string;
  createdAt: number;
  text: string;
}