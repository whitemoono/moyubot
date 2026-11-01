import { DatabaseSync } from 'node:sqlite';
import type { MemoryFact } from './types';

/**
 * 长期记忆的持久层：单个 SQLite 数据库（memories.db）承载所有 Bot / 群聊的记忆，
 * 取代早期的每条一个 Markdown 文件的资料库（后者仅在启动迁移和 Markdown 导出时读取）。
 * 向量以 Float32 BLOB 存在同一张表里，由向量服务回填；检索时在内存中做余弦相似度，
 * 千级条目内无需专门的向量索引扩展。
 */
export class MemoryStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scopeId TEXT NOT NULL,
        text TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        createdAt INTEGER NOT NULL,
        lastUsedAt INTEGER,
        embedding BLOB,
        embeddingModel TEXT
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scopeId, createdAt)');
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM memories').get() as { total: number };
    return Number(row.total);
  }

  list(): MemoryFact[] {
    const rows = this.db.prepare('SELECT id, scopeId, text, pinned, source, createdAt, lastUsedAt FROM memories ORDER BY createdAt ASC, id ASC').all() as Record<string, unknown>[];
    return rows.map(rowToFact);
  }

  upsert(fact: MemoryFact): void {
    this.db.prepare(`
      INSERT INTO memories (id, scopeId, text, pinned, source, createdAt, lastUsedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scopeId = excluded.scopeId,
        text = excluded.text,
        pinned = excluded.pinned,
        source = excluded.source,
        createdAt = excluded.createdAt,
        lastUsedAt = excluded.lastUsedAt
    `).run(fact.id, fact.botId, fact.text, fact.pinned ? 1 : 0, fact.source ?? 'manual', fact.createdAt, fact.lastUsedAt ?? null);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  clearEmbedding(id: string): void {
    this.db.prepare('UPDATE memories SET embedding = NULL, embeddingModel = NULL WHERE id = ?').run(id);
  }

  setLastUsed(id: string, at: number): void {
    this.db.prepare('UPDATE memories SET lastUsedAt = ? WHERE id = ?').run(at, id);
  }

  setEmbedding(id: string, vector: Float32Array, model: string): void {
    this.db.prepare('UPDATE memories SET embedding = ?, embeddingModel = ? WHERE id = ?')
      .run(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), model, id);
  }

  /** 全部已就绪的向量（按配置的模型过滤），用于检索时的余弦相似度计算。 */
  embeddings(model: string): Map<string, Float32Array> {
    const map = new Map<string, Float32Array>();
    const rows = this.db.prepare('SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND embeddingModel = ?').all(model) as { id: string; embedding: Uint8Array }[];
    for (const row of rows) {
      if (!row.embedding) continue;
      const buffer = row.embedding as unknown as Uint8Array;
      const aligned = new Uint8Array(buffer); // 拷贝一次，保证 4 字节对齐可读
      map.set(row.id, new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4)));
    }
    return map;
  }

  /** 需要补算向量的记忆：尚无向量，或向量属于旧的模型。 */
  pendingEmbeddings(model: string, limit: number): { id: string; text: string }[] {
    const rows = this.db.prepare(`
      SELECT id, text FROM memories
      WHERE embedding IS NULL OR embeddingModel IS NULL OR embeddingModel != ?
      ORDER BY createdAt DESC LIMIT ?
    `).all(model, limit) as { id: string; text: string }[];
    return rows;
  }

  close(): void {
    this.db.close();
  }
}

function rowToFact(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row.id),
    botId: String(row.scopeId),
    text: String(row.text),
    pinned: Number(row.pinned) === 1,
    source: row.source === 'automatic' ? 'automatic' : 'manual',
    createdAt: Number(row.createdAt),
    ...(row.lastUsedAt != null ? { lastUsedAt: Number(row.lastUsedAt) } : {}),
  };
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    normA += a[index]! * a[index]!;
    normB += b[index]! * b[index]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
