import { useState } from 'react';
import type { Bot } from '@moyu/core';
import { useMoyu } from '../state';
import { Button, IconButton, Panel } from '../components/Glass';
import { BotAvatar } from '../components/BotAvatar';
import { Icon } from '../components/Icon';

import { newBot } from '../lib/bots';
import { BotEditor } from '../components/BotEditor';

export function BotsView({ onCreate, embedded = false }: { onCreate: () => void; embedded?: boolean }) {
  const { settings, saveBot, deleteBot, selectBot, bot: activeBot, updateBotMetadata, toast, activeWorkspace } = useMoyu();
  const [editing, setEditing] = useState<Bot | null>(null);

  const providerName = (id: string) => settings.providers.find((provider) => provider.id === id)?.name ?? '未绑定供应商';

  return (
    <div className={embedded ? 'settings-bots' : 'view'}>
      <header className="view-head">
        <div>
          {embedded ? <span className="settings-bots__count">{settings.bots.length} 个 Bot<span>{activeWorkspace?.name} · 模型与权限</span></span> : <><h1>Bot 管理</h1><p>每个 Bot 有自己的供应商、模型、人格与权限，共用当前工作区的电脑。</p></>}
        </div>
        <Button variant="primary" icon="plus" onClick={onCreate}>
          新建 Bot
        </Button>
      </header>

      <div className="bots-grid">
        {settings.bots.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id).map((item) => (
          <Panel key={item.id} className={`bot-card ${activeBot?.id === item.id ? 'is-active' : ''}`}>
            <div className="bot-card__head">
              <BotAvatar bot={item} size="xl" />
              <div className="bot-card__title">
                <h3>{item.name}</h3>
                <p>@{item.handle}</p>
              </div>
              <IconButton name="settings" label="编辑" onClick={() => setEditing(item)} />
            </div>
            <dl className="bot-card__facts">
              <div>
                <dt>供应商</dt>
                <dd>{providerName(item.providerId)}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd className="mono">{item.model || '—'}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd>{item.approvalPolicy === 'ask' ? '执行前确认' : item.approvalPolicy === 'always' ? '全部允许' : '自动执行'}</dd>
              </div>
              <div>
                <dt>绘图</dt>
                <dd>供应商 API</dd>
              </div>
            </dl>
            <div className="bot-card__foot">
              <Button size="sm" variant="glass" icon="chat" onClick={() => selectBot(item.id)}>
                开始对话
              </Button>
              {item.sidebar?.hidden ? <Button size="sm" variant="ghost" icon="sidebar" onClick={() => void updateBotMetadata(item.id, { sidebar: { hidden: false } }).catch((error: Error) => toast(error.message, 'error'))}>显示在侧栏</Button> : null}
              <IconButton name="copy" label="复制这个 Bot" onClick={() => setEditing(newBot(settings.providers.find((p) => p.id === item.providerId), item))} />
            </div>
          </Panel>
        ))}

        <button type="button" className="bot-card bot-card--new" onClick={onCreate}>
          <span className="new-icon">
            <Icon name="plus" size={22} />
          </span>
          <strong>再加一个 Bot</strong>
          <span>接入另一家供应商，或给同一个模型不同的性格与工具。</span>
        </button>
      </div>

      {editing ? (
        <BotEditor
          key={editing.id}
          initial={editing}
          existing={settings.bots.some((item) => item.id === editing.id)}
          providers={settings.providers}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await saveBot(next, { stayInSettings: embedded });
            setEditing(null);
          }}
          onDelete={
            settings.bots.length > 1
              ? async () => {
                  await deleteBot(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
