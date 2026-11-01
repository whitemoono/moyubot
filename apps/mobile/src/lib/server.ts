/** 服务器会话与 API 访问：token 存 SecureStore，与桌面端/PWA 同一套协议。 */
import * as SecureStore from 'expo-secure-store';

export interface MobileSession { token: string; deviceId: string; workspace: string; server: string }

const SESSION_KEY = 'moyu.session';

let session: MobileSession | undefined;

export function currentSession(): MobileSession | undefined {
  return session;
}

export async function loadSession(): Promise<MobileSession | undefined> {
  if (session) return session;
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (raw) session = JSON.parse(raw) as MobileSession;
  } catch { /* first run */ }
  return session;
}

export async function saveSession(next: MobileSession): Promise<void> {
  session = next;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
}

export async function clearSession(): Promise<void> {
  session = undefined;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export function normalizeServer(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('请填写服务器地址');
  const url = new URL(trimmed);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务器地址需要是 http/https');
  if (url.search || url.hash) throw new Error('服务器地址不带路径和参数');
  return url.origin;
}

/** 与桌面端 MobileSync.api 相同的调用约定：Bearer token、JSON、错误里带 status。 */
export async function api(route: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
  const current = currentSession();
  if (!current) throw new Error('请先连接电脑');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${current.server}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${current.token}`, ...headers },
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

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
