import { useMemo } from 'react';
import { CLOUD_META, formatRelative } from '../lib/format';
import { useMesh } from '../state';
import type { View } from '../state';
import { BotAvatar } from './BotAvatar';
import { Icon } from './Icon';
import { IconButton } from './Glass';
import type { IconName } from './Icon';

const NAV: { id: View; label: string; icon: IconName }[] = [
  { id: 'chat', label: '对话', icon: 'chat' },
  { id: 'cloud', label: '云电脑', icon: 'cloud' },
  { id: 'tasks', label: '定时任务', icon: 'clock' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

export function Sidebar() {
  const { settings, bot, selectBot, conversations, conversation, selectConversation, newConversation, view, setView, cloud, cloudAction } = useMesh();

  const botConversations = useMemo(
    () => conversations.filter((item) => !bot || item.botId === bot.id).slice(0, 18),
    [conversations, bot],
  );
  const meta = CLOUD_META[cloud.state];

  return (
    <aside className="sidebar glass">
      <section className="sidebar__section">
        <div className="section-label">
          <span>Bot 阵容</span>
          <IconButton name="plus" label="新建 Bot" className="icon-btn--tiny" onClick={() => setView('bots')} />
        </div>
        <div className="bot-stack">
          {settings.bots.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`bot-row ${bot?.id === item.id ? 'is-active' : ''}`}
              onClick={() => selectBot(item.id)}
            >
              <BotAvatar bot={item} />
              <span className="bot-row__meta">
                <span className="bot-row__name">{item.name}</span>
                <span className="bot-row__model">{item.model || '未选模型'}</span>
              </span>
              {bot?.id === item.id ? <span className="bot-row__dot" /> : null}
            </button>
          ))}
          <button type="button" className="bot-row bot-row--new" onClick={() => setView('bots')}>
            <span className="bot-avatar bot-avatar--ghost">
              <Icon name="plus" size={16} />
            </span>
            <span className="bot-row__meta">
              <span className="bot-row__name">添加 Bot</span>
              <span className="bot-row__model">不同供应商 · 各自人格</span>
            </span>
          </button>
        </div>
      </section>

      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${view === item.id ? 'is-active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.id === 'cloud' ? <span className={`nav-dot nav-dot--${meta.tone}`} /> : null}
          </button>
        ))}
      </nav>

      <section className="sidebar__section sidebar__section--grow">
        <div className="section-label">
          <span>最近对话</span>
          <IconButton name="plus" label="新对话" className="icon-btn--tiny" onClick={() => void newConversation()} />
        </div>
        <div className="conv-list">
          {botConversations.length === 0 ? <p className="conv-empty">还没有对话，直接在下面输入吧。</p> : null}
          {botConversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`conv-row ${conversation?.id === item.id ? 'is-active' : ''}`}
              onClick={() => void selectConversation(item.id)}
            >
              <span className="conv-row__title">{item.title}</span>
              <span className="conv-row__time">{formatRelative(item.updatedAt)}</span>
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="cloud-mini glass-inset"
        onClick={() => setView('cloud')}
        title="打开云电脑"
      >
        <span className={`mini-orb mini-orb--${meta.tone}`} />
        <span className="cloud-mini__text">
          <strong>{cloud.machine?.name ?? settings.cloud.machineName}</strong>
          <span>
            {meta.label}
            {cloud.state === 'ready' ? ` · ${cloud.wakeCount} 次唤醒` : ''}
          </span>
        </span>
        <span
          className="cloud-mini__power"
          role="button"
          tabIndex={0}
          aria-label={cloud.state === 'ready' || cloud.state === 'busy' ? '休眠' : '唤醒'}
          onClick={(event) => {
            event.stopPropagation();
            void cloudAction(cloud.state === 'ready' || cloud.state === 'busy' ? 'sleep' : 'wake');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void cloudAction(cloud.state === 'ready' ? 'sleep' : 'wake');
          }}
        >
          <Icon name={cloud.state === 'ready' || cloud.state === 'busy' ? 'moon' : 'power'} size={15} />
        </span>
      </button>
    </aside>
  );
}