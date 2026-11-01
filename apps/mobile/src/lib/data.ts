/** 同步记录的响应式视图：把 SyncClient 的 records 映射成 UI 可用的集合。 */
import { useEffect, useState } from 'react';
import { clearSession, currentSession, loadSession } from './server';
import { emptySyncState, loadSyncState, persistSyncState, SyncClient, type SyncState } from './sync';

let client: SyncClient | undefined;
let version = 0;
const listeners = new Set<() => void>();
let starting = false;

function bump() { version++; listeners.forEach((listener) => listener()); }

export function getClient(): SyncClient | undefined {
  return client;
}

/** 应用启动时调用一次：恢复会话与同步状态，开始 2 秒轮询。 */
export async function initData(): Promise<void> {
  if (client || starting) return;
  starting = true;
  try {
    const session = await loadSession();
    const state = await loadSyncState();
    if (!session) { starting = false; bump(); return; }
    client = new SyncClient(state, {
      url: session.server,
      token: () => currentSession()?.token,
      save: (next: SyncState) => { void persistSyncState(next); },
      changed: () => bump(),
      status: () => bump(),
    });
    // 进入 2 秒轮询循环。没有 start() 只剩配对瞬间的一次同步——错过对端上传就得等重启。
    client.start();
    client.start();
  } finally {
    starting = false;
    bump();
  }
}

/** 重新连接（配对成功后）：重建客户端并开启上传。 */
export async function reconnect(): Promise<void> {
  client?.stop();
  client = undefined;
  const state = emptySyncState();
  await persistSyncState(state);
  await initData();
  getClient()?.setEnabled(true);
  bump();
}

export async function disconnect(): Promise<void> {
  const current = getClient();
  if (current) { current.setEnabled(false); current.stop(); }
  client = undefined;
  await persistSyncState(emptySyncState());
  await clearSession();
  bump();
}

export function useSyncVersion(): number {
  const [value, setValue] = useState(version);
  useEffect(() => { listeners.add(listener); setValue(version); return () => { listeners.delete(listener); }; }, []);
  return value;
}
function listener() { /* placeholder replaced below */ }
// useSyncExternalStore 风格：直接在 hook 里订阅 bump
void listener;

export function useCollection<T = Record<string, any>>(collection: string): T[] {
  useSyncVersion();
  return (getClient()?.values(collection) || []) as T[];
}

export function useSyncStatus(): { connected: boolean; enabled: boolean; pending: number; conflicts: number; lastSync?: number; error: string } {
  useSyncVersion();
  const current = getClient();
  return {
    connected: !!currentSession(),
    enabled: !!current?.state.enabled,
    pending: current ? Object.keys(current.state.outbox).length : 0,
    conflicts: current?.state.conflicts.length ?? 0,
    lastSync: current?.state.lastSync,
    error: current?.error ?? '',
  };
}

export function putRecord(collection: string, id: string, value: Record<string, any> | null): void {
  getClient()?.put(collection, id, value);
  bump();
}
