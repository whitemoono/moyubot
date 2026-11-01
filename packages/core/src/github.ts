/**
 * GitHub 客户端：Codespaces 接入的第一段——Device Flow 登录、用户信息与额度。
 * 桌面应用没有回调地址，用设备码流程最合适：应用出示授权码，用户在浏览器里批准。
 * token 由调用方（主进程）通过 safeStorage 保存，这里只透传。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';

import { systemFetch } from './providers/transport';

/** GitHub 的网络通道与供应商一致：跟随系统代理（桌面端注入 Chromium 网络）。 */
async function http(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const transport = systemFetch();
  return (transport ?? fetch)(input, init);
}

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
    const res = await http(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, scope: GITHUB_SCOPES }),
    });
    const data = await res.json();
    if (!res.ok || !data.device_code) {
      if (data.error === 'device_flow_disabled' || /Device Flow must be explicitly enabled/i.test(String(data.error_description ?? data.error ?? ''))) {
        throw new Error('这个应用的设备码流程还没开启：github.com/settings/developers → 打开这个应用 → 勾选 Enable Device Flow → Update application → 回来重试登录（Client ID 不用换）。');
      }
      throw new Error(data.error_description ?? `GitHub 设备码请求失败（${res.status}）`);
    }
    return {
      deviceCode: String(data.device_code),
      userCode: String(data.user_code),
      verificationUri: String(data.verification_uri ?? 'https://github.com/login/device'),
      intervalSeconds: Number(data.interval ?? 5),
      expiresInSeconds: Number(data.expires_in ?? 900),
    };
  }

  async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
    const res = await http(ACCESS_TOKEN_URL, {
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
    const res = await http(`${API}/user`, { headers: this.headers(token) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `获取用户信息失败（${res.status}）`);
    return { login: String(data.login), name: data.name ? String(data.name) : undefined, avatarUrl: data.avatar_url ? String(data.avatar_url) : undefined };
  }

  async getQuota(token: string): Promise<CodespacesQuota> {
    const res = await http(`${API}/user/codespaces/quota`, { headers: this.headers(token) });
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

  /** ② 流程第一步：确保存在专用的私有工作区仓库（moyubot-workspace 或 MoyuBot-Codespace），已存在则复用；都没有才新建私有库。 */
  async ensureWorkspaceRepo(token: string, name = 'moyubot-workspace'): Promise<{ fullName: string; id: number; created: boolean }> {
    const user = await this.getUser(token);
    const candidates = [name, 'MoyuBot-Codespace'];
    for (const candidate of candidates) {
      const existing = await http(`${API}/repos/${user.login}/${candidate}`, { headers: this.headers(token) });
      if (existing.ok) {
        const repo = await existing.json();
        if (!repo.private) {
          const patch = await http(`${API}/repos/${user.login}/${candidate}`, { method: 'PATCH', headers: { ...this.headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ private: true }) });
          if (!patch.ok) throw new Error(`仓库 ${candidate} 是公开的，且自动转私失败（${patch.status}）——请在 GitHub 上手动转私有`);
        }
        return { fullName: String(repo.full_name), id: Number(repo.id), created: false };
      }
    }
    const res = await http(`${API}/user/repos`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, private: true, auto_init: true, description: 'MoyuBot 云电脑工作区（自动创建）' }),
    });
    const repo = await res.json();
    if (!res.ok) throw new Error(repo.message ?? `创建仓库 ${name} 失败（${res.status}）`);
    return { fullName: String(repo.full_name), id: Number(repo.id), created: true };
  }

  /** ② 流程第二步：从工作区仓库创建 Codespace（2 核 8GB）。 */
  async createCodespace(token: string, repositoryId: number, machine = 'basicLinux32gb'): Promise<{ name: string; state: string }> {
    const res = await http(`${API}/user/codespaces`, {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ repository_id: repositoryId, machine }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `创建 Codespace 失败（${res.status}）`);
    return { name: String(data.name), state: String(data.state ?? 'Creating') };
  }

  /** 列出账号下所有 Codespace（驱动选择用）。 */
  async listCodespaces(token: string): Promise<{ name: string; state: string; repository: string }[]> {
    const res = await http(`${API}/user/codespaces?per_page=100`, { headers: this.headers(token) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `获取 Codespace 列表失败（${res.status}）`);
    return (data.codespaces ?? []).map((item: any) => ({ name: String(item.name), state: String(item.state), repository: String(item.repository?.full_name ?? '') }));
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MoyuBot' };
  }
}
