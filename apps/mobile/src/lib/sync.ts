/** RN 版同步客户端：与 packages/core/src/sync.ts 同一套 wire protocol（/api/sync 游标 + outbox + 冲突裁决）。
 *  RN 的 fetch 不支持流式读取，SSE 触发省略——2 秒轮询已足够，协议语义保持一致。 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SyncRecord { collection: string; id: string; value: Record<string, any> | null; revision: number }
export interface SyncChange extends SyncRecord { opId: string; baseRevision: number }
export interface SyncState { cursor: number; records: Record<string, SyncRecord>; outbox: Record<string, SyncChange>; conflicts: { record: SyncChange; server: SyncRecord; time: number }[]; enabled: boolean; lastSync?: number }
export const emptySyncState = (): SyncState => ({ cursor: 0, records: {}, outbox: {}, conflicts: [], enabled: false });
export const syncKey = (collection: string, id: string) => `${collection}/${id}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const STATE_KEY = 'moyu.sync';

export async function loadSyncState(): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (raw) return { ...emptySyncState(), ...JSON.parse(raw) };
  } catch { /* first run */ }
  return emptySyncState();
}

export class SyncClient {
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;
  private retryAt = 0;
  private failures = 0;
  error = '';

  constructor(public state: SyncState, private options: {
    url: string;
    token: () => string | undefined;
    save: (state: SyncState) => void;
    changed?: (records: SyncRecord[]) => void;
    status?: () => void;
  }) {}

  async api(route: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
    const credential = this.options.token();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.options.url}${route}`, {
        redirect: 'error',
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || '服务器暂时无法连接'), { status: response.status });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  put(collection: string, id: string, raw: SyncRecord['value']) {
    const value = raw === null ? null : JSON.parse(JSON.stringify(raw));
    const key = syncKey(collection, id);
    const current = this.state.outbox[key] || this.state.records[key];
    if (current && same(current.value, value)) return;
    this.state.outbox[key] = { collection, id, value, revision: current?.revision || 0, baseRevision: this.state.records[key]?.revision || 0, opId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
    this.persist();
  }

  values(collection: string): Record<string, any>[] {
    return Object.values({ ...this.state.records, ...this.state.outbox }).filter((r) => r.collection === collection && r.value !== null).map((r) => r.value!);
  }

  restoreConflict(index: number) {
    const conflict = this.state.conflicts[index];
    if (!conflict) return;
    this.put(conflict.record.collection, conflict.record.id, conflict.record.value);
    this.state.conflicts.splice(index, 1);
    this.persist();
    void this.sync(true);
  }

  private persist() { this.options.save(this.state); this.options.status?.(); }

  setEnabled(enabled: boolean) { this.state.enabled = enabled; this.persist(); this.retryAt = 0; if (enabled) void this.sync(true); }

  start() {
    this.stopped = false;
    this.timer ??= setInterval(() => void this.sync(), 2000);
    void this.sync();
  }

  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async sync(force = false) {
    if (this.busy || !this.state.enabled || !this.options.token() || (!force && Date.now() < this.retryAt)) return;
    this.busy = true;
    try {
      let more = true, batches = 0;
      while (more && batches++ < 100) {
        const sent = Object.values(this.state.outbox).slice(0, 250);
        const response = await this.api('/api/sync', { cursor: this.state.cursor, changes: sent });
        for (const opId of response.accepted) {
          const record = sent.find((r) => r.opId === opId);
          if (!record) continue;
          const key = syncKey(record.collection, record.id);
          if (this.state.outbox[key]?.opId === opId) delete this.state.outbox[key];
        }
        for (const record of response.conflicts as SyncRecord[]) {
          const key = syncKey(record.collection, record.id);
          const local = this.state.outbox[key];
          if (local) { this.state.conflicts.push({ record: local, server: record, time: Date.now() }); delete this.state.outbox[key]; }
          this.state.records[key] = record;
        }
        const applied: SyncRecord[] = [...response.conflicts];
        for (const record of response.records as SyncRecord[]) {
          const key = syncKey(record.collection, record.id);
          if ((this.state.records[key]?.revision || 0) > record.revision) continue;
          this.state.records[key] = record;
          if (!this.state.outbox[key]) applied.push(record);
        }
        this.state.cursor = response.cursor;
        this.state.lastSync = Date.now();
        this.error = ''; this.failures = 0; this.retryAt = 0;
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
}

export async function persistSyncState(state: SyncState): Promise<void> {
  try { await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage full - sync still runs in memory */ }
}
