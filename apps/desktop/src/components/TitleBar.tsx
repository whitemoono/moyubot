import { mesh } from '../lib/bridge';
import { CLOUD_META } from '../lib/format';
import { useMesh } from '../state';
import { Icon } from './Icon';

const TITLES: Record<string, string> = {
  chat: '对话',
  bots: 'Bot 管理',
  cloud: '云电脑',
  tasks: '定时任务',
  settings: '设置',
};

export function TitleBar() {
  const { view, cloud, platform } = useMesh();
  const isMac = platform === 'darwin';
  const stateLabel = CLOUD_META[cloud.state].label;

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="brand-orb" aria-hidden="true" />
        <span className="brand-text">
          MeshBot
          <span className="brand-sub">shared cloud · multi provider</span>
        </span>
      </div>
      <div className="titlebar__center">
        <span className="crumb">{TITLES[view] ?? '对话'}</span>
        <span className={`cloud-pill cloud-pill--${cloud.state}`}>
          <span className="cloud-pill__dot" />
          {stateLabel}
        </span>
      </div>
      <div className="titlebar__right">
        {isMac ? null : (
          <div className="win-controls">
            <button type="button" className="win-btn" aria-label="最小化" onClick={() => void mesh().win('minimize')}>
              <Icon name="minimize" size={14} strokeWidth={1.9} />
            </button>
            <button type="button" className="win-btn" aria-label="最大化" onClick={() => void mesh().win('maximize')}>
              <Icon name="maximize" size={12} strokeWidth={1.9} />
            </button>
            <button type="button" className="win-btn win-btn--close" aria-label="关闭" onClick={() => void mesh().win('close')}>
              <Icon name="close" size={14} strokeWidth={1.9} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}