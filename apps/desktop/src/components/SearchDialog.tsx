import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMoyu } from '../state';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { BotAvatar } from './BotAvatar';
import { Icon } from './Icon';
import { IconButton } from './Glass';
import type { IconName } from './Icon';

export function SearchDialog({ onClose, onCreateBot, onCreateGroup }: { onClose: () => void; onCreateBot: () => void; onCreateGroup: () => void }) {
  const { settings, conversations, selectBot, setView } = useMoyu();
  const [query, setQuery] = useState('');
  const [choosingBot, setChoosingBot] = useState(false);
  const [activeId, setActiveId] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogFocus(dialogRef, onClose);
  const openConversation = useCallback((id: string) => { selectBot(id); onClose(); }, [selectBot, onClose]);
  const entries = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const bots = settings.bots.map((bot) => ({ id: `bot:${bot.id}`, label: bot.name, hint: conversations.find((conv) => !conv.group && conv.botId === bot.id)?.preview?.replace(/[#*`\n]+/g, ' ').trim() || '还没有消息，和我聊聊吧', keywords: `${bot.handle} ${bot.sidebar?.group ?? ''}`, bot, icon: 'bots' as IconName, run: () => openConversation(bot.id) }));
    const groups = choosingBot ? [] : conversations.filter((conv) => conv.group).map((conv) => ({ id: `group:${conv.id}`, label: conv.title, hint: conv.preview || `${conv.group!.memberBotIds.length} 个 Bot 的群聊`, keywords: '群聊', bot: undefined, icon: 'users' as IconName, run: () => openConversation(conv.id) }));
    const actions = choosingBot ? [] : [
      { id: 'action:chat', label: '新对话', icon: 'chat' as IconName, run: () => { setChoosingBot(true); setQuery(''); inputRef.current?.focus(); } },
      { id: 'action:bot', label: '创建 Bot', icon: 'plus' as IconName, run: () => { onClose(); onCreateBot(); } },
      { id: 'action:group', label: '新建群聊', icon: 'users' as IconName, run: () => { onClose(); onCreateGroup(); } },
      { id: 'action:settings', label: 'Bot 设置', icon: 'settings' as IconName, run: () => { onClose(); setView('bots'); } },
    ].map((item) => ({ ...item, hint: '', keywords: '', bot: undefined }));
    return { chats: [...bots, ...groups].filter((item) => `${item.label} ${item.hint} ${item.keywords}`.toLocaleLowerCase().includes(term)), actions: actions.filter((item) => item.label.toLocaleLowerCase().includes(term)) };
  }, [query, choosingBot, settings.bots, conversations, openConversation, onClose, onCreateBot, onCreateGroup, setView]);
  const items = [...entries.chats, ...entries.actions];
  const selected = items.some((item) => item.id === activeId) ? activeId : items[0]?.id;
  useEffect(() => { if (selected) document.getElementById(`search-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const renderEntry = (item: (typeof items)[number]) => <button type="button" key={item.id} id={`search-${item.id}`} data-search-id={item.id} className={`search-dialog__item ${selected === item.id ? 'is-selected' : ''}`} role="option" aria-selected={selected === item.id} tabIndex={-1} onPointerMove={() => setActiveId(item.id)} onClick={item.run}>
    {item.bot ? <BotAvatar bot={item.bot} animated={false} /> : <span className="search-dialog__icon"><Icon name={item.icon} size={17} /></span>}
    <span className="search-dialog__text"><strong>{item.label}</strong>{item.hint ? <small>{item.hint}</small> : null}</span>
    {item.bot?.sidebar?.hidden ? <span className="search-dialog__badge">已隐藏</span> : null}
  </button>;
  return createPortal(<div className="search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索 Bot 与功能">
      <div className="search-dialog__head">
        {choosingBot ? <IconButton name="back" label="返回全部搜索" onClick={() => { setChoosingBot(false); setQuery(''); inputRef.current?.focus(); }} /> : <Icon name="search" size={18} />}
        <input ref={inputRef} value={query} aria-label="搜索 Bot" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="bot-search-results" aria-activedescendant={selected ? `search-${selected}` : undefined} placeholder={choosingBot ? '选择一个 Bot，开始对话' : '搜索'} onChange={(event) => { setQuery(event.target.value); setActiveId(''); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const index = items.findIndex((item) => item.id === selected); setActiveId(items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.id ?? ''); }
          if (event.key === 'Enter') { event.preventDefault(); items.find((item) => item.id === selected)?.run(); }
        }} />
        <IconButton name="close" label="关闭搜索" onClick={onClose} />
      </div>
      <div className="search-dialog__results" id="bot-search-results" role="listbox" aria-label={choosingBot ? '选择 Bot' : '搜索结果'}>
        {entries.chats.map(renderEntry)}
        {entries.actions.length ? <div className="search-dialog__actions" role="group" aria-label="功能">{entries.actions.map(renderEntry)}</div> : null}
        {!items.length ? <div className="search-dialog__empty"><Icon name="search" size={25} /><p>没有找到相关 Bot 或功能</p><small>试试 Bot 名字或「创建」</small></div> : null}
      </div>
      {choosingBot ? <p className="search-dialog__note">每个 Bot 保留一个持续对话，选择后继续原来的聊天。</p> : null}
    </div>
  </div>, document.body);
}
