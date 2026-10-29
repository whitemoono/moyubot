import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMoyu } from '../state';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { BotAvatar } from './BotAvatar';
import { Button, Field, Sheet } from './Glass';
import { Icon } from './Icon';
import type { ConversationSummary } from '../lib/bridge';

export function CreateGroupDialog({ onClose, initial }: { onClose: () => void; initial?: ConversationSummary }) {
  const { settings, createGroup, updateGroupChat, runningGroupIds, toast } = useMoyu();
  const [name, setName] = useState(initial?.title ?? '');
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<string[]>(initial?.group?.memberBotIds.filter((id) => settings.bots.some((bot) => bot.id === id)) ?? []);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { if (!saving) onClose(); }, [saving, onClose]);
  const running = !!initial && runningGroupIds.has(initial.id);
  const invalid = members.length < 2 || members.length > 12 || (!!initial && !name.trim());
  useDialogFocus(ref, close);
  const submit = async () => {
    if (saving || invalid || running) return;
    setSaving(true);
    try { if (initial) await updateGroupChat(initial.id, { type: 'edit', title: name, memberBotIds: members }); else await createGroup(name, members); onClose(); }
    catch (error) { toast((error as Error).message, 'error'); setSaving(false); }
  };
  return createPortal(<div ref={ref}><Sheet open title={initial ? '编辑群聊' : '新建群聊'} subtitle="选择 2–12 个 Bot，一起参与对话。" className="sheet--create-group" onClose={close} footer={<><span className="group-selection-count">已选 {members.length} / 12</span><span className="spacer" /><Button variant="ghost" disabled={saving} onClick={close}>取消</Button><Button variant="primary" loading={saving} disabled={saving || invalid || running} onClick={() => void submit()}>{initial ? '保存群聊' : '创建群聊'}</Button></>}>
    <Field label="群聊名称"><input className="input" aria-label="群聊名称" placeholder={initial ? '输入群聊名称' : '例如：灵感小组（可选）'} maxLength={60} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} /></Field>
    <div className="group-member-search"><Icon name="search" size={16} /><input aria-label="搜索群成员" placeholder="搜索 Bot" value={query} disabled={saving} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="group-member-list" aria-label="群聊成员">
      {settings.bots.filter((bot) => `${bot.name} ${bot.handle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((bot) => <button type="button" key={bot.id} data-member-id={bot.id} aria-pressed={members.includes(bot.id)} disabled={saving || (!members.includes(bot.id) && members.length >= 12)} className="group-member" onClick={() => setMembers((previous) => previous.includes(bot.id) ? previous.filter((id) => id !== bot.id) : [...previous, bot.id])}>
        <BotAvatar bot={bot} animated={false} /><span><strong>{bot.name}</strong><small>{bot.model || '尚未配置模型'}</small></span><i className="group-member__check">{members.includes(bot.id) ? <Icon name="check" size={14} /> : null}</i>
      </button>)}
    </div>
    {running ? <p className="inline-hint" role="status">请先停止群聊任务，再保存更改。</p> : initial ? <p className="inline-hint">改名或调整群员会保留已有聊天记录，新成员将能看到群内历史。</p> : null}
    {settings.bots.length < 2 ? <p className="inline-hint">先创建至少两个 Bot，才能发起群聊。</p> : <p className="inline-hint">每次发送后，成员按选择顺序依次回复，可以参考彼此的发言。</p>}
  </Sheet></div>, document.body);
}
