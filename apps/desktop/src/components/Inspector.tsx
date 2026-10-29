import { useEffect, useState } from 'react';
import { CLOUD_META, formatDuration, formatRelative } from '../lib/format';
import { assetUrl, moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { BotAvatar } from './BotAvatar';
import { BotAvatarDialog } from './BotAvatarDialog';
import { Button, IconButton } from './Glass';
import { Icon } from './Icon';
import { BotTasks } from './BotTasks';

const TABS = [{ id: 'details', label: '详情' }, { id: 'library', label: '资料库' }, { id: 'computer', label: '电脑' }] as const;
type Tab = typeof TABS[number]['id'];

export function Inspector({ onClose, onCreateBot, onOpenTerminal }: { onClose: () => void; onCreateBot: () => void; onOpenTerminal: () => void }) {
  const { cloud: cloudStatus, local, activeWorkspace, cloudAction, bot, settings, memories, addMemory, deleteMemory, toast, conversation, compacting, setView } = useMoyu();
  const isLocal = activeWorkspace?.kind === 'local';
  const cloud = isLocal ? local : cloudStatus;
  const [tab, setTab] = useState<Tab>('computer');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [avatarBotId, setAvatarBotId] = useState<string | null>(null);
  useEffect(() => { setTab('computer'); setDraft(''); }, [bot?.id]);
  const meta = CLOUD_META[cloud.state];
  const provider = settings.providers.find((item) => item.id === bot?.providerId);
  const awake = cloud.state === 'ready' || cloud.state === 'busy';
  const transitioning = pending || cloud.state === 'waking' || cloud.state === 'sleeping';
  const resting = ['suspended', 'off', 'stopped'].includes(cloud.state);
  const dozing = resting || cloud.state === 'sleeping';
  const booting = cloud.state === 'waking';
  const computerActivity = dozing ? 'sleeping' : booting ? 'waking' : cloud.state === 'busy' ? 'working' : cloud.state === 'error' ? 'error' : 'idle';
  const files = [...new Map((conversation?.messages.flatMap((message) => message.attachments ?? []) ?? []).map((file) => [file.path ?? file.id, file])).values()];
  const computerLabel = resting ? '电脑正在休眠' : booting ? '电脑正在开机' : cloud.state === 'ready' ? '电脑已就绪' : cloud.state === 'busy' ? '电脑正在工作' : cloud.state === 'error' ? '电脑连接异常' : meta.hint;
  const onlineLabel = isLocal ? '本地执行，无需云电脑' : `本次在线 ${formatDuration(cloud.awakeMs)}`;

  const remember = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try { await addMemory(draft.trim()); setDraft(''); toast('已写入长期记忆'); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setSaving(false); }
  };
  const controlComputer = async (action: 'wake' | 'sleep' | 'refresh') => {
    setPending(true);
    try { await cloudAction(action); } finally { setPending(false); }
  };

  return (
    <aside className="rail inspector" aria-label="对话详情">
      <div className="rail-heading inspector-toolbar"><IconButton name="plus" label="创建新 Bot" onClick={onCreateBot} /><IconButton name="close" label="关闭详情" onClick={onClose} /></div>
      <div className="inspector-profile">
        {bot ? <button type="button" className="inspector-avatar-button" aria-label={`修改 ${bot.name} 的头像`} aria-haspopup="dialog" title="修改 Bot 头像" onClick={() => setAvatarBotId(bot.id)}><BotAvatar bot={bot} size="xl" /><span className="inspector-avatar-button__edit" aria-hidden="true"><Icon name="edit" size={13} /></span></button> : null}
        <h2>{bot?.name ?? 'Bot'}</h2>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Bot 信息" onKeyDown={(event) => {
        const index = TABS.findIndex((item) => item.id === tab);
        let next = -1;
        if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
        if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = TABS.length - 1;
        if (next < 0) return;
        event.preventDefault(); setTab(TABS[next]!.id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>
        {TABS.map((item) => <button type="button" key={item.id} id={`inspector-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`inspector-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      <div className="inspector-content" key={tab} id={`inspector-panel-${tab}`} role="tabpanel" aria-labelledby={`inspector-tab-${tab}`} tabIndex={0}>
        {tab === 'computer' ? <div className="inspector-computer">
          <div className={`computer-preview ${dozing ? 'is-resting' : ''} ${booting ? 'is-booting' : ''}`} role="status" aria-live="polite">
            <div className="computer-character" aria-hidden="true">{bot ? <BotAvatar bot={bot} activity={computerActivity} className="computer-character__avatar" /> : <Icon name="terminal" size={32} />}{dozing ? <span className="computer-character__sleep">z<sup>z</sup></span> : null}{booting ? <span className="computer-character__boot"><i /><i /><i /></span> : null}</div>
            <strong>{computerLabel}</strong>
          </div>
          <p className="computer-caption">{isLocal ? '本机 Windows' : cloud.machine?.name ?? settings.cloud.machineName}<small> · 工作区内所有 Bot 共用</small></p>
          <div className="computer-controls">
            {!isLocal ? <><Button variant="ghost" size="sm" icon={awake ? 'moon' : 'power'} loading={transitioning} disabled={transitioning || cloud.state === 'busy'} onClick={() => void controlComputer(awake ? 'sleep' : 'wake')}>{awake ? '休眠电脑' : '唤醒电脑'}</Button><IconButton name="refresh" label="刷新电脑状态" disabled={transitioning} onClick={() => void controlComputer('refresh')} /></> : null}
            <Button variant="glass" size="sm" icon="terminal" onClick={onOpenTerminal}>打开终端</Button>
          </div>
          {awake ? <div className="computer-session"><span>{onlineLabel}</span><Button variant="ghost" size="sm" onClick={() => setView('cloud')}>管理电脑</Button></div> : null}
          {cloud.state === 'error' || cloud.state === 'unconfigured' ? <p className="inspector-note">{cloud.lastError ?? meta.hint}<button type="button" onClick={() => setView('cloud')}>检查云电脑配置</button></p> : null}
        </div> : null}

        {tab === 'details' ? <>
          {bot ? <BotTasks key={bot.id} botId={bot.id} /> : null}
          <section className="inspector-section"><h3>关于这个 Bot</h3><dl className="inspector-facts">
            <div><dt>供应商</dt><dd>{provider?.name ?? '未绑定'}</dd></div>
            <div><dt>模型</dt><dd>{bot?.model || '未选择'}</dd></div>
            <div><dt>权限</dt><dd>{bot?.approvalPolicy === 'ask' ? '执行前确认' : bot?.approvalPolicy === 'always' ? '全部允许' : '自动执行'}</dd></div>
            <div><dt>工具</dt><dd>{bot?.tools.length ?? 0} 个已启用</dd></div>
          </dl></section>
          <section className="inspector-section context-card"><h3>持续对话</h3>
            <p>{compacting ? '正在整理上下文与长期记忆…' : '每个 Bot 一个对话，较早的内容会自动整理。'}</p>
            {conversation?.context ? <details><summary>已整理 {conversation.context.compactedMessages} 条消息</summary><p>{conversation.context.summary}</p></details> : null}
            <p className="inspector-note">完整聊天记录保留在本地。</p>
          </section>
          {bot?.systemPrompt ? <section className="inspector-section"><h3>角色设定</h3><p className="inspector-prompt">{bot.systemPrompt}</p></section> : null}
        </> : null}

        {tab === 'library' ? <>
          <section className="inspector-section"><div className="inspector-section__head"><h3>长期记忆</h3><span>{memories.length}</span></div>
            <div className="memory-list">
              {!memories.length ? <p className="inspector-note">偏好与重要事项会在对话整理时记在这里。</p> : null}
              {memories.map((memory) => <div key={memory.id} className="memory-item"><span className="memory-item__text">{memory.text}</span><button type="button" className="memory-item__remove" aria-label="删除记忆" onClick={() => void deleteMemory(memory.id).catch((error: Error) => toast(error.message, 'error'))}><Icon name="close" size={12} /></button></div>)}
            </div>
            <form className="memory-add" onSubmit={(event) => { event.preventDefault(); void remember(); }}><input className="input input--sm" value={draft} placeholder="记住一件事…" aria-label="记忆内容" disabled={saving} onChange={(event) => setDraft(event.target.value)} /><IconButton type="submit" name="plus" label="添加记忆" disabled={!draft.trim() || saving} /></form>
          </section>
          <section className="inspector-section"><div className="inspector-section__head"><h3>对话文件</h3><span>{files.length}</span></div>
            {!files.length ? <div className="library-empty"><Icon name="folder" size={26} /><p>对话中的图片和文件会收在这里</p></div> : <div className="library-files">{files.map((file) => <div className="library-file" key={file.path ?? file.id}>{file.kind === 'image' && (assetUrl(file.path) ?? file.dataUrl) ? <img src={assetUrl(file.path) ?? file.dataUrl} alt={file.name} /> : <Icon name="folder" size={20} />}<span>{file.name}</span>{file.path ? <IconButton name="arrowUp" label={`打开 ${file.name}`} onClick={() => void moyu().openArtifact(file.path!).catch((error: Error) => toast(error.message, 'error'))} /> : null}</div>)}</div>}
          </section>
        </> : null}
      </div>
      {tab === 'computer' && awake ? <span className="inspector-sync">上次同步 {formatRelative(cloud.lastTransitionAt)}</span> : null}
      {bot && avatarBotId === bot.id ? <BotAvatarDialog key={bot.id} bot={bot} onClose={() => setAvatarBotId(null)} /> : null}
    </aside>
  );
}
