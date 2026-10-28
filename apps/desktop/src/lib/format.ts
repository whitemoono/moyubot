import type { CloudState } from '@mesh/core';

export function formatRelative(timestamp?: number): string {
  if (!timestamp) return '—';
  const delta = Date.now() - timestamp;
  if (delta < 45_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatClock(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export const CLOUD_META: Record<CloudState, { label: string; tone: string; hint: string }> = {
  unconfigured: { label: '未配置', tone: 'muted', hint: '填入 InstaBox API Key 后可用' },
  off: { label: '离线', tone: 'muted', hint: '云主机当前不可达' },
  stopped: { label: '已关机', tone: 'muted', hint: '文件保留，启动需要更久' },
  suspended: { label: '休眠中', tone: 'sleep', hint: '按需唤醒，不烧钱' },
  waking: { label: '唤醒中', tone: 'wake', hint: '正在恢复运行现场' },
  ready: { label: '就绪', tone: 'ready', hint: '空闲后会自动休眠' },
  busy: { label: '执行中', tone: 'busy', hint: '有任务正在云电脑里跑' },
  sleeping: { label: '休眠中…', tone: 'sleep', hint: '正在保存运行现场' },
  error: { label: '异常', tone: 'error', hint: '检查 Key、配额或网络' },
};

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '••••••';
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

export function cronLabel(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  if (minute.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `每 ${minute.slice(2)} 分钟`;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '1-5') {
    return `工作日 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  return cron;
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}