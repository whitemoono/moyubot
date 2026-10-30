/** Device-independent data replication. Never runs agents, tools or schedules. */
export const SYNC_FIELDS: Record<string, string[]> = {
  bots: ['id','name','handle','avatar','model','providerId','systemPrompt','temperature','workspaceId','createdAt','updatedAt','sidebar'],
  conversations: ['id','botId','workspaceId','title','group','createdAt','updatedAt','deletedAt'],
  messages: ['id','conversationId','botId','botName','role','content','createdAt','model','error','stopped','streaming'],
  memories: ['id','botId','text','pinned','createdAt','source'],
  schedules: ['id','botId','title','prompt','cron','runAt','kind','enabled','createdAt','updatedAt','lastStatus','lastRunAt','nextRunAt','closedAt','completedAt'],
  profile: ['userName'],
};
export type SyncValue = Record<string, any> | null;
export interface SyncRecord { collection: string; id: string; value: SyncValue; revision: number }
export interface SyncChange extends SyncRecord { opId: string; baseRevision: number }
export interface SyncState {
  cursor: number; records: Record<string, SyncRecord>; outbox: Record<string, SyncChange>;
  conflicts: { record: SyncChange; server: SyncRecord; time: number }[];
  enabled: boolean; lastSync?: number;
}
export const emptySyncState = (): SyncState => ({ cursor: 0, records: {}, outbox: {}, conflicts: [], enabled: false });
export const syncKey = (collection: string, id: string) => `${collection}/${id}`;
export function syncValue(collection: string, value: SyncValue): SyncValue {
  if (value === null) return null;
  const out = Object.fromEntries((SYNC_FIELDS[collection] || []).filter(k => value[k] !== undefined).map(k => [k, value[k]]));
  if (collection === 'bots' && out.avatar) out.avatar = Object.fromEntries(['shape','from','to','glyph'].filter(k => typeof out.avatar[k] === 'string').map(k => [k, out.avatar[k]]));
  return JSON.parse(JSON.stringify(out));
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class SyncClient {
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private stream?: AbortController;
  private stopped = true;
  private retryAt = 0;
  private failures = 0;
  error = '';
  constructor(public state: SyncState, private options: {
    url: string; token: () => string | undefined; save: (state: SyncState) => void;
    changed?: (records: SyncRecord[]) => void; status?: () => void;
  }) {}
  async api(route: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
    const credential = this.options.token();
    const response = await fetch(`${this.options.url}${route}`, {
      redirect: 'error',
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '服务器暂时无法连接'), { status: response.status });
    return data;
  }
  put(collection: string, id: string, raw: SyncValue) {
    if (!SYNC_FIELDS[collection] || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(id)) return;
    const value = syncValue(collection, raw), key = syncKey(collection, id);
    const current = this.state.outbox[key] || this.state.records[key];
    if (current && same(current.value, value)) return;
    this.state.outbox[key] = { collection, id, value, revision: current?.revision || 0, baseRevision: this.state.records[key]?.revision || 0, opId: globalThis.crypto.randomUUID() };
    this.persist();
  }
  values(collection: string) {
    return Object.values({ ...this.state.records, ...this.state.outbox }).filter(r => r.collection === collection && r.value !== null).map(r => r.value!);
  }
  restoreConflict(index: number) {
    const conflict = this.state.conflicts[index];
    if (!conflict) return;
    this.put(conflict.record.collection, conflict.record.id, conflict.record.value);
    this.state.conflicts.splice(index, 1); this.persist(); void this.sync(true);
  }
  private persist() { this.options.save(this.state); this.options.status?.(); }
  setEnabled(enabled: boolean) { this.state.enabled = enabled; this.persist(); this.retryAt = 0; if (enabled) { void this.sync(); this.openStream(); } else this.stream?.abort(); }
  start() {
    this.stopped = false;
    this.timer ??= setInterval(() => void this.sync(), 2000);
    void this.sync(); this.openStream();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.stream?.abort(); }
  async sync(force = false) {
    if (this.busy || !this.state.enabled || !this.options.token() || (!force && Date.now() < this.retryAt)) return;
    this.busy = true;
    try {
      let more = true, batches = 0;
      while (more && batches++ < 100) {
        const sent = Object.values(this.state.outbox).slice(0, 250);
        const response = await this.api('/api/sync', { cursor: this.state.cursor, changes: sent });
        for (const opId of response.accepted) {
          const record = sent.find(r => r.opId === opId); if (!record) continue;
          const key = syncKey(record.collection, record.id);
          if (this.state.outbox[key]?.opId === opId) delete this.state.outbox[key];
        }
        for (const record of response.conflicts as SyncRecord[]) {
          const key = syncKey(record.collection, record.id), local = this.state.outbox[key];
          if (local) {
            // Server wins for this record; keep the complete local edit for explicit restore.
            this.state.conflicts.push({ record: local, server: record, time: Date.now() });
            delete this.state.outbox[key];
          }
          this.state.records[key] = record;
        }
        const applied: SyncRecord[] = [...response.conflicts];
        for (const record of response.records as SyncRecord[]) {
          const key = syncKey(record.collection, record.id);
          if ((this.state.records[key]?.revision || 0) > record.revision) continue;
          this.state.records[key] = record;
          const local = this.state.outbox[key];
          if (local) {
            // A newer local edit made while our previous upload was in flight.
            if (sent.some(r => r.collection === record.collection && r.id === record.id && response.accepted.includes(r.opId))) local.baseRevision = record.revision;
          } else applied.push(record);
        }
        this.state.cursor = response.cursor; this.state.lastSync = Date.now();
        this.error = ''; this.failures = 0; this.retryAt = 0;
        // Apply before saving cursor. Replaying a batch after a crash is safe.
        if (applied.length) this.options.changed?.(applied);
        this.persist();
        more = response.hasMore || Object.keys(this.state.outbox).length > 0;
      }
    } catch (error) {
      this.error = (error as Error).message;
      this.retryAt = Date.now() + Math.min(30000, 2000 * 2 ** Math.min(this.failures++, 4));
      this.options.status?.();
    } finally { this.busy = false; }
  }
  private openStream() {
    if (this.stopped || !this.state.enabled || !this.options.token() || this.stream) return;
    const controller = new AbortController(); this.stream = controller;
    void (async () => {
      try {
        const response = await fetch(`${this.options.url}/api/events`, { headers: { Authorization: `Bearer ${this.options.token()}` }, signal: controller.signal });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        while (!controller.signal.aborted) { const part = await reader.read(); if (part.done) break; void this.sync(true); }
      } catch { /* polling provides reconnect and background-tab recovery */ }
      finally { this.stream = undefined; if (!this.stopped && this.state.enabled) setTimeout(() => this.openStream(), 10000); }
    })();
  }
}
