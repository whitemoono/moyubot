import { useState } from 'react';
import { CLOUD_META, formatDuration, formatRelative } from '../lib/format';
import { useMesh } from '../state';
import { Button, IconButton, Panel } from './Glass';
import { Icon } from './Icon';

export function Inspector() {
  const { cloud, cloudAction, bot, settings, memories, addMemory, deleteMemory, toast } = useMesh();
  const [draft, setDraft] = useState('');
  const meta = CLOUD_META[cloud.state];
  const provider = settings.providers.find((item) => item.id === bot?.providerId);
  const awake = cloud.state === 'ready' || cloud.state === 'busy';

  return (
    <aside className="rail">
      <Panel className="rail-card rail-card--cloud">
        <div className="rail-card__head">
          <span className="rail-card__label">共享云电脑</span>
          <span className={`badge badge--${meta.tone}`}>{meta.label}</span>
        </div>
        <div className={`state-orb state-orb--${meta.tone}`}>
          <span className="state-orb__core" />
          <span className="state-orb__shine" />
        </div>
        <h3 className="rail-card__title">{cloud.machine?.name ?? settings.cloud.machineName}</h3>
        <p className="rail-card__sub">{meta.hint}</p>
        <div className="rail-stats">
          <div>
            <span>本次在线</span>
            <strong>{awake ? formatDuration(cloud.awakeMs || Date.now() - (cloud.lastWakeAt ?? Date.now())) : '0s'}</strong>
          </div>
          <div>
            <span>累计唤醒</span>
            <strong>{cloud.wakeCount}</strong>
          </div>
        </div>
        <div className="rail-actions">
          {awake ? (
            <Button size="sm" variant="glass" icon="moon" onClick={() => void cloudAction('sleep')}>
              休眠
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon="power" onClick={() => void cloudAction('wake')}>
              唤醒
            </Button>
          )}
          <IconButton name="refresh" label="刷新状态" onClick={() => void cloudAction('refresh')} />
        </div>
      </Panel>

      <Panel className="rail-card">
        <div className="rail-card__head">
          <span className="rail-card__label">当前 Bot</span>
          <span className="badge badge--muted">{provider?.name ?? '供应商未绑定'}</span>
        </div>
        <dl className="rail-facts">
          <div>
            <dt>模型</dt>
            <dd className="mono">{bot?.model || '—'}</dd>
          </div>
          <div>
            <dt>权限</dt>
            <dd>{bot?.approvalPolicy === 'ask' ? '执行前确认' : bot?.approvalPolicy === 'always' ? '全部允许' : '自动执行'}</dd>
          </div>
          <div>
            <dt>绘图</dt>
            <dd>{bot?.image.backend === 'cloud' ? '云主机出图' : '供应商 API'}{bot?.image.wakeHost ? ' · 先唤醒' : ''}</dd>
          </div>
          <div>
            <dt>工具</dt>
            <dd>{bot?.tools.length ?? 0} 个已启用</dd>
          </div>
        </dl>
      </Panel>

      <Panel className="rail-card rail-card--grow">
        <div className="rail-card__head">
          <span className="rail-card__label">长期记忆</span>
          <span className="badge badge--muted">{memories.length}</span>
        </div>
        <div className="memory-list">
          {memories.length === 0 ? <p className="memory-empty">还没有记忆。让 Bot 记住偏好，或在下面手动添加。</p> : null}
          {memories.slice(0, 8).map((memory) => (
            <div key={memory.id} className="memory-item">
              <span className="memory-item__text">{memory.text}</span>
              <button type="button" className="memory-item__remove" aria-label="删除" onClick={() => void deleteMemory(memory.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="memory-add">
          <input
            className="input input--sm"
            value={draft}
            placeholder="记一条事实…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) {
                void addMemory(draft.trim()).then(() => {
                  setDraft('');
                  toast('已写入长期记忆');
                });
              }
            }}
          />
          <IconButton
            name="plus"
            label="添加记忆"
            onClick={() => {
              if (!draft.trim()) return;
              void addMemory(draft.trim()).then(() => {
                setDraft('');
                toast('已写入长期记忆');
              });
            }}
          />
        </div>
      </Panel>

      <div className="rail-foot">
        <span className={`dot dot--${settings.telegram.enabled ? 'ok' : 'muted'}`} />
        Telegram 网关{settings.telegram.enabled ? '已启用' : '未启用'}
        <span className="rail-foot__sep" />
        数据 v{settings.version}
      </div>
      <span className="rail-hint">上次同步 {formatRelative(cloud.lastTransitionAt)}</span>
    </aside>
  );
}