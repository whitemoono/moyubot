/**
 * 出站 URL 守卫：只允许指向"公网"的 https 地址。
 *
 * 两个调用点都把模型 / 用户给的 URL 直接交给了 fetch：
 *  - `web_fetch`（core 工具）
 *  - `moyu:market:remote`（渲染层指定的模板源，主进程 net.fetch 直连）
 * 之前只有 web_fetch 做了个主机名正则，市场入口连正则都没有。这里统一成一套：
 *  - 只允许 https，且不允许 URL 里带账号密码
 *  - 拒绝 loopback / 私网 / link-local / CGNAT / 组播 / 保留段，以及 .local .lan 之类的本地域名
 *  - 有域名时先解析，任何一个解析结果落在上述范围都拒绝（挡住"公网域名指向 169.254"）
 *  - 抓取时手动跟随重定向（每一跳都重新校验），限制响应字节数与总时长
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const LOCAL_SUFFIXES = ['.local', '.localhost', '.lan', '.internal', '.home.arpa', '.intranet'];

function ipv4Parts(ip: string): number[] | undefined {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts;
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ipv4Parts(ip);
  if (!parts) return true; // 解析不出来就当不可信
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;              // 本网络 / 私网 / 回环
  if (a === 169 && b === 254) return true;                        // link-local（含云元数据 169.254.169.254）
  if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT 100.64/10
  if (a === 172 && b >= 16 && b <= 31) return true;               // 私网
  if (a === 192 && b === 168) return true;                        // 私网
  if (a === 192 && b === 0) return true;                          // IETF 协议分配
  if (a === 198 && (b === 18 || b === 19)) return true;           // 基准测试段
  if (a >= 224) return true;                                      // 组播 + 保留段
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::' || value === '::1') return true;
  // IPv4 映射/兼容：::ffff:127.0.0.1、
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;              // fc00::/7 唯一本地
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true;              // fe80::/10 link-local
  return false;
}

function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIPv4(address);
  if (kind === 6) return isBlockedIPv6(address);
  return true;
}

/**
 * 同步校验：DNS 名先查字面规则；字面 IP 直接判定。
 * 需要挡住"域名解析到内网"时用 `assertPublicUrl()`（会做一次解析）。
 */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('URL 格式无效'); }
  if (url.protocol !== 'https:') throw new Error('只允许 https:// 地址');
  if (url.username || url.password) throw new Error('URL 不能包含账号密码');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL 缺少主机名');
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw new Error('拒绝访问本机/内网地址');
  if (isIP(host) && isBlockedAddress(host)) throw new Error('拒绝访问本机/内网地址');
  return url;
}

/** 异步校验：额外做一次 DNS 解析，任何一个解析结果命中内网段都拒绝。 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = assertPublicHttpsUrl(raw);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) return url;
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error(`域名解析失败：${host}`);
  }
  if (!records.length) throw new Error(`域名解析失败：${host}`);
  for (const record of records) {
    if (isBlockedAddress(record.address)) throw new Error(`拒绝访问内网地址（${host} → ${record.address}）`);
  }
  return url;
}

export interface PublicFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PublicFetchResult {
  url: string;
  status: number;
  ok: boolean;
  text: string;
  truncated: boolean;
}

/**
 * 带守卫的抓取：每一跳都重新校验 URL（默认不跟随跨站重定向到内网），
 * 读取时按字节数截断，并为整个请求加超时。
 */
export async function fetchPublicText(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  rawUrl: string,
  options: PublicFetchOptions = {},
): Promise<PublicFetchResult> {
  const maxBytes = options.maxBytes ?? 200_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let current = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetcher(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = new URL(response.headers.get('location')!, current);
      if (next.protocol !== 'https:') throw new Error('重定向指向非 https 地址，已拒绝');
      current = await assertPublicUrl(next.toString());
      continue;
    }
    const { text, truncated } = await readCapped(response, maxBytes);
    return { url: current.toString(), status: response.status, ok: response.ok, text, truncated };
  }
  throw new Error('重定向次数过多');
}

async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes ? { text: text.slice(0, maxBytes), truncated: true } : { text, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.length > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'), truncated };
}