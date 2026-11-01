import { useMemo, useState } from 'react';
import type { Bot, MemoryFact } from '@moyu/core';
import { formatRelative } from '../lib/format';
import { useMoyu } from '../state';
import { Button, IconButton, Sheet } from './Glass';
import { Icon } from './Icon';
import '../styles/memories.css';

function sourceLabel(memory: MemoryFact): string {
  if (memory.source === 'automatic') return '对话整理';
  if (memory.source === 'manual') return '主动记录';
  return '已保存';
}

export function BotMemories({ bot, group = false }: { bot: Pick<Bot, 'id' | 'name'>; group?: boolean }) {
  const { memories, addMemory, updateMemory, deleteMemory, toast, compacting } = useMoyu();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState('');
  // Filter even while the selection's IPC request is still loading.
  const facts = useMemo(() => memories.filter((memory) => memory.botId === bot.id).reverse()
    .sort((a, b) => b.createdAt - a.createdAt), [memories, bot.id]);
  const recent = facts.slice(0, 3);
  const search = query.trim().normalize('NFKC').toLocaleLowerCase();
  const results = facts.filter((memory) => memory.text.normalize('NFKC').toLocaleLowerCase().includes(search));
  const close = () => { setOpen(false); setQuery(''); setDraft(''); setEditingId(''); setEditDraft(''); };
  const remember = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      await addMemory(draft.trim());
      setDraft('');
      setQuery('');
      toast('已写入长期记忆');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await deleteMemory(id); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const startEdit = (memory: MemoryFact) => { setEditingId(memory.id); setEditDraft(memory.text); };
  const saveEdit = async () => {
    if (busy || !editingId) return;
    setBusy(true);
    try {
      await updateMemory(editingId, { text: editDraft });
      setEditingId('');
      setEditDraft('');
      toast('已更新记忆');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const togglePin = async (memory: MemoryFact) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateMemory(memory.id, { pinned: !memory.pinned });
      toast(memory.pinned ? '已取消固定' : '已固定，这条记忆会优先注入对话');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return <section className="inspector-section bot-memories">
    <div className="inspector-section__head"><h3>长期记忆</h3><span>{facts.length} 条</span></div>
    <button type="button" className="memory-preview" aria-label={`查看 ${bot.name} 的全部记忆`} aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>
      <span className="memory-preview__caption"><Icon name={compacting ? 'refresh' : 'memory'} size={13} />{compacting ? '正在整理记忆…' : '最近整理'}</span>
      {recent.length ? <span className="memory-preview__list">{recent.map((memory) => <span className="memory-preview__item" key={memory.id}>
        <span className="memory-preview__text">{memory.text}</span>
        <span className="memory-preview__meta">{sourceLabel(memory)} · {formatRelative(memory.createdAt)}</span>
      </span>)}</span> : <span className="memory-preview__empty">还没有记忆。对话中的偏好与重要事项会收在这里，也可以手动添加。</span>}
      <span className="memory-preview__more">{facts.length ? `查看全部 ${facts.length} 条记忆` : '打开记忆库'}<Icon name="external" size={13} /></span>
    </button>
    <Sheet open={open} title={`${bot.name} 的记忆`} subtitle={group ? '本群的共同约定与长期事项，由群成员共享，与 Bot 私聊记忆分开。' : '偏好、长期项目与重要约定，只用于这个 Bot。'} className="bot-memory-dialog" onClose={close}
      footer={<form className="memory-compose" onSubmit={(event) => { event.preventDefault(); void remember(); }}>
        <label htmlFor={`memory-draft-${bot.id}`}>添加一条记忆</label>
        <div><textarea id={`memory-draft-${bot.id}`} className="input" aria-label="记忆内容" rows={2} placeholder="例如：回答时先给结论，再展开说明" value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
          <Button type="submit" size="sm" variant="primary" icon="plus" disabled={busy || !draft.trim()} loading={busy} aria-label="添加记忆">记住</Button></div>
      </form>}>
      <div className="memory-search"><Icon name="search" size={15} /><input className="input" type="search" aria-label={group ? '搜索该群聊的记忆' : '搜索该 Bot 的记忆'} placeholder="搜索记忆…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <p className="memory-results" role="status">{search ? `找到 ${results.length} 条 · 共 ${facts.length} 条记忆` : `全部 ${facts.length} 条记忆 · 固定的优先注入对话`}</p>
      {results.length ? <ul className="memory-records" aria-label="全部记忆" aria-busy={busy}>{results.map((memory) => <li className={`memory-record ${editingId === memory.id ? 'is-editing' : ''}`} key={memory.id}>
        {editingId === memory.id ? <form className="memory-record__edit" onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
          <textarea className="input" aria-label="编辑记忆内容" rows={3} value={editDraft} disabled={busy} autoFocus onChange={(event) => setEditDraft(event.target.value)} />
          <div className="memory-record__edit-actions">
            <Button type="submit" size="sm" variant="primary" icon="check" disabled={busy || !editDraft.trim()} loading={busy} aria-label="保存记忆">保存</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEditingId(''); setEditDraft(''); }}>取消</Button>
          </div>
        </form> : <p>{memory.text}</p>}
        <div className="memory-record__foot"><span>{sourceLabel(memory)}<span aria-hidden="true"> · </span><time dateTime={new Date(memory.createdAt).toISOString()} title={new Date(memory.createdAt).toLocaleString('zh-CN')}>{formatRelative(memory.createdAt)}</time>{memory.pinned ? <span className="memory-record__pin"><Icon name="pin" size={11} />固定</span> : null}</span>
          {editingId === memory.id ? null : <span className="memory-record__actions">
            <IconButton name="pin" label={memory.pinned ? `取消固定记忆：${memory.text}` : `固定记忆：${memory.text}`} active={memory.pinned} disabled={busy} onClick={() => void togglePin(memory)} />
            <IconButton name="edit" label={`编辑记忆：${memory.text}`} disabled={busy} onClick={() => startEdit(memory)} />
            <IconButton name="trash" label={`删除记忆：${memory.text}`} disabled={busy} onClick={() => void remove(memory.id)} />
          </span>}
        </div>
      </li>)}</ul> : <div className="memory-dialog-empty"><Icon name={search ? 'search' : 'memory'} size={28} /><strong>{search ? '没有找到相关记忆' : '从一件值得记住的事开始'}</strong><p>{search ? '换个关键词，或清空搜索查看全部。' : '在下方添加偏好或重要约定，下次对话仍会保留。'}</p></div>}
    </Sheet>
  </section>;
}
