import type { AppUpdateResult } from '@moyu/core';

const REPOSITORY = 'https://github.com/whitemoono/moyubot';
const LATEST_RELEASE = 'https://api.github.com/repos/whitemoono/moyubot/releases/latest';

/** Query published releases only. Downloading and installing stay user initiated. */
export async function checkForUpdates(currentVersion: string, request: typeof fetch = fetch): Promise<AppUpdateResult> {
  const base = { currentVersion, checkedAt: Date.now() };
  try {
    const response = await request(LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MoyuBot-Desktop', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (response.status === 404) return { ...base, status: 'unpublished', message: '暂未找到公开的正式发行版，可前往仓库查看发布进展。' };
    if ([403, 429].includes(response.status)) return { ...base, status: 'error', message: 'GitHub 暂时限制了请求，请稍后重试。' };
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const release = await response.json() as { tag_name?: unknown; draft?: boolean; prerelease?: boolean };
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
    const latest = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(tag);
    const current = /^v?(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?(?:\+[\w.-]+)?$/.exec(currentVersion);
    if (!latest || !current || release.draft || release.prerelease) return { ...base, status: 'error', message: '发行版版本信息无法识别，请前往仓库查看。' };
    let newer = Boolean(current[4]);
    for (let index = 1; index <= 3; index++) {
      const next = BigInt(latest[index]);
      const installed = BigInt(current[index]);
      if (next !== installed) { newer = next > installed; break; }
    }
    const latestVersion = tag.replace(/^v/, '');
    return {
      ...base, status: newer ? 'available' : 'current', latestVersion,
      releaseUrl: `${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
      message: newer ? `发现新版本 v${latestVersion}，可以查看发行说明并下载。` : '当前已是最新正式版本。',
    };
  } catch (error) {
    return { ...base, status: 'error', message: (error as Error).name === 'TimeoutError' ? '检查超时，请确认网络后重试。' : '暂时无法连接 GitHub，请稍后重试。' };
  }
}
