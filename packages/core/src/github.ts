/**
 * GitHub 客户端：Codespaces 接入的第一段——Device Flow 登录、用户信息与额度。
 * 桌面应用没有回调地址，用设备码流程最合适：应用出示授权码，用户在浏览器里批准。
 * token 由调用方（主进程）通过 safeStorage 保存，这里只透传。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';

/** 申请的权限：管 Codespaces、从自己仓库创建、注册 SSH 公钥。 */
export const GITHUB_SCOPES = 'codespace repo admin:public_key';

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export type DeviceFlowPoll = { status: 'pending' } | { status: 'slow' } | { status: 'expired' } | { status: 'done'; accessToken: string };

export interface GitHubUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

/** 额度接口返回形状官方未完全稳定，按宽容解析：能取到多少展示多少。 */
export interface CodespacesQuota {
  raw: Record<string, unknown>;
  /** 已用分钟数（能解析时） */
  minutesUsed?: number;
  /** 包含的免费额度（能解析时） */
  includedMinutes?: number;
  includedStorageGb?: number;
}

export class GitHubClient {
  constructor(private clientId: string) {}

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, scope: GITHUB_SCOPES }),
    });
    const data = await res.json();
    if (!res.ok || !data.device_code) throw new Error(data.error_description ?? `GitHub 设备码请求失败（${res.status}）`);
    return {
      deviceCode: String(data.device_code),
      userCode: String(data.user_code),
      verificationUri: String(data.verification_uri ?? 'https://github.com/login/device'),
      intervalSeconds: Number(data.interval ?? 5),
      expiresInSeconds: Number(data.expires_in ?? 900),
    };
  }

  async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const data = await res.json();
    if (data.access_token) return { status: 'done', accessToken: String(data.access_token) };
    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') return { status: 'slow' };
    if (data.error === 'expired_token') return { status: 'expired' };
    throw new Error(data.error_description ?? `GitHub 授权轮询失败（${res.status}）`);
  }

  async getUser(token: string): Promise<GitHubUser> {
    const res = await fetch(`${API}/user`, { headers: this.headers(token) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `获取用户信息失败（${res.status}）`);
    return { login: String(data.login), name: data.name ? String(data.name) : undefined, avatarUrl: data.avatar_url ? String(data.avatar_url) : undefined };
  }

  async getQuota(token: string): Promise<CodespacesQuota> {
    const res = await fetch(`${API}/user/codespaces/quota`, { headers: this.headers(token) });
    if (res.status === 404) throw new Error('当前账号不支持 Codespaces（需要个人账号而非组织机器人）');
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(raw.message ?? `获取额度失败（${res.status}）`);
    const pick = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    return {
      raw,
      minutesUsed: pick(raw.minutes_used) ?? pick(raw.quota_minutes?.minutes_used) ?? pick(raw.total_minutes_used),
      includedMinutes: pick(raw.quota_minutes?.included_quotas?.[0]?.minutes) ?? pick(raw.included_quotas?.[0]?.minutes),
      includedStorageGb: pick(raw.included_quotas?.[0]?.storage_gb) ?? pick(raw.storage_gb),
    };
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MoyuBot' };
  }
}
