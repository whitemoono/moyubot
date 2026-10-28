import logoUrl from '../assets/brand/logo.png';
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

export function TitleBar() {
  const { view, cloud, platform } = useMoyu();
  const isMac = platform === 'darwin';
  const stateLabel = CLOUD_META[cloud.state].label;

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <img className="brand-orb" src={logoUrl} alt="MoyuBot" />
        <span className="brand-text">
          MoyuBot
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