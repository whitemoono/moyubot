import { moyu } from '../lib/bridge';
import { CLOUD_META } from '../lib/format';
import { useMoyu } from '../state';
import { Icon } from './Icon';

const TITLES: Record<string, string> = {
  chat: '对话',
  bots: 'Bot 管理',
  cloud: '云电脑',
  tasks: '定时任务',
  settings: '设置',
};

export function TitleBar({ collapsed, onToggleSidebar }: { collapsed: boolean; onToggleSidebar: () => void }) {
  const { view, cloud: cloudStatus, local, activeWorkspace, platform, setView } = useMoyu();
  const cloud = activeWorkspace?.kind === 'local' ? local : cloudStatus;
  const isMac = platform === 'darwin';
  const stateLabel = CLOUD_META[cloud.state].label;

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <button type="button" className="titlebar__sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onClick={onToggleSidebar}><Icon name="sidebar" size={14} /></button>
        <span className="titlebar__workspace-dot" /><span>MoyuBot Desktop</span>
      </div>
      <div className="titlebar__center">
        <span className="crumb">{activeWorkspace?.name ?? TITLES[view] ?? '对话'}</span>
        <button type="button" title="查看工作区电脑" onClick={() => setView('cloud')} className={`cloud-pill cloud-pill--${cloud.state}`}>
          <span className="cloud-pill__dot" />
          {stateLabel}
        </button>
      </div>
      <div className="titlebar__right">
        {isMac ? null : (
          <div className="win-controls">
            <button type="button" className="win-btn" aria-label="最小化" onClick={() => void moyu().win('minimize')}>
              <Icon name="minimize" size={14} strokeWidth={1.9} />
            </button>
            <button type="button" className="win-btn" aria-label="最大化" onClick={() => void moyu().win('maximize')}>
              <Icon name="maximize" size={12} strokeWidth={1.9} />
            </button>
            <button type="button" className="win-btn win-btn--close" aria-label="关闭" onClick={() => void moyu().win('close')}>
              <Icon name="close" size={14} strokeWidth={1.9} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
