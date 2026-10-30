import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Bot } from '@moyu/core';
import { createPortal } from 'react-dom';
import { useMoyu } from '../state';
import { BotAvatar } from './BotAvatar';
import { Icon } from './Icon';
import { IconButton } from './Glass';
import type { View } from '../state';
import type { IconName } from './Icon';
import { BOT_ACTIVITY } from '../lib/bot-activity';
import { BotContextMenu } from './BotContextMenu';
import { useSidebarMotion } from '../lib/use-sidebar-motion';
import { SearchDialog } from './SearchDialog';
import { CreateGroupDialog } from './CreateGroupDialog';
import { UserAvatar } from './UserAvatar';
import { ConnectorsDialog } from './ConnectorsDialog';
import { MobileConnectionDialog } from './MobileConnectionDialog';
import { GroupContextMenu } from './GroupContextMenu';
import { GroupChatContextMenu } from './GroupChatContextMenu';

const FEATURES: { id: View | 'usage'; label: string; icon: IconName }[] = [
  { id: 'bots', label: 'Bot 管理', icon: 'bots' },
  { id: 'cloud', label: '共享云电脑', icon: 'cloud' },
  { id: 'usage', label: '用量', icon: 'usage' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

export function Sidebar({ collapsed, onExpand, onCreateBot }: { collapsed: boolean; onExpand: () => void; onCreateBot: () => void }) {
  const { settings, bot, conversation, selectBot, conversations, view, setView, openSettings, runningBotIds, botActivities, updateBotMetadata, updateBotGroup, setGroupChatsCollapsed, runningGroupIds, toast, workspaces, activeWorkspace, selectWorkspace } = useMoyu();
  const [searchOpen, setSearchOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeGroup = useCallback(() => setCreatingGroup(false), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const closeConnectors = useCallback(() => setConnectorsOpen(false), []);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const motion = useSidebarMotion(sidebarRef, settings.bots, settings.ui.reduceMotion);
  const [context, setContext] = useState<{ botId: string; x: number; y: number } | null>(null);
  const closeContext = useCallback(() => setContext(null), []);
  const [groupContext, setGroupContext] = useState<{ name: string; x: number; y: number } | null>(null);
  const closeGroupContext = useCallback(() => setGroupContext(null), []);
  const [chatContext, setChatContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeChatContext = useCallback(() => setChatContext(null), []);
  useEffect(() => { setChatContext(null); setContext(null); setGroupContext(null); }, [activeWorkspace?.id]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const previewFor = (id: string) => conversations.find((item) => item.botId === id)?.preview?.replace(/[#*`\n]+/g, ' ').trim() || '还没有消息，和我聊聊吧';
  const filteredBots = settings.bots.filter((item) => (item.workspaceId ?? 'workspace_cloud') === activeWorkspace?.id);
  const chatOrder = activeWorkspace?.groupChatOrder ?? [];
  const groupChats = conversations.filter((item) => item.group).sort((a, b) => {
    const first = chatOrder.indexOf(a.id), second = chatOrder.indexOf(b.id);
    return (first < 0 ? chatOrder.length : first) - (second < 0 ? chatOrder.length : second);
  });
  const chatsOpen = collapsed || !activeWorkspace?.groupChatsCollapsed;
  const contextChat = groupChats.find((item) => item.id === chatContext?.id);
  const hiddenBots = filteredBots.filter((item) => item.sidebar?.hidden);
  const pinnedBots = filteredBots.filter((item) => !item.sidebar?.hidden && item.sidebar?.pinned);
  const groups = new Map<string, Bot[]>();
  for (const item of filteredBots) {
    if (item.sidebar?.hidden || item.sidebar?.pinned) continue;
    const group = item.sidebar?.group ?? '';
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const namedGroups = settings.ui.botGroups ?? [];
  const orderedGroups = [...namedGroups];
  if (groups.get('')?.length) orderedGroups.splice(Math.max(0, Math.min(namedGroups.length, settings.ui.ungroupedGroupIndex ?? namedGroups.length)), 0, { name: '' });
  const contextBot = settings.bots.find((item) => item.id === context?.botId);
  const openContext = (event: ReactMouseEvent<HTMLButtonElement>, item: Bot) => {
    event.preventDefault();
    setMenuOpen(false);
    setGroupContext(null);
    setChatContext(null);
    const rect = event.currentTarget.getBoundingClientRect();
    setContext({ botId: item.id, x: event.clientX || rect.right - 12, y: event.clientY || rect.top + 12 });
  };
  const openGroupContext = (event: ReactMouseEvent<HTMLButtonElement>, name: string) => {
    event.preventDefault(); event.currentTarget.focus();
    setMenuOpen(false); setContext(null);
    setChatContext(null);
    const rect = event.currentTarget.getBoundingClientRect();
    setGroupContext({ name, x: event.clientX || rect.right - 12, y: event.clientY || rect.bottom });
  };
  const openChatContext = (event: ReactMouseEvent<HTMLButtonElement>, id: string) => {
    event.preventDefault(); event.currentTarget.focus();
    setMenuOpen(false); setContext(null); setGroupContext(null);
    const rect = event.currentTarget.getBoundingClientRect();
    setChatContext({ id, x: event.clientX || rect.right - 12, y: event.clientY || rect.bottom });
  };
  const togglePin = async (item: Bot) => {
    const pinned = !item.sidebar?.pinned;
    motion.capture(item.id, pinned);
    try { await updateBotMetadata(item.id, { sidebar: { pinned, hidden: false } }); }
    catch (error) { motion.discard(); throw error; }
  };
  const renderBot = (item: Bot) => <button type="button" key={item.id} data-bot-id={item.id} className={`messenger-bot ${view === 'chat' && !conversation?.group && bot?.id === item.id ? 'is-active' : ''}`} aria-current={view === 'chat' && !conversation?.group && bot?.id === item.id ? 'page' : undefined} aria-haspopup="menu" title={item.name} onClick={() => selectBot(item.id)} onContextMenu={(event) => openContext(event, item)}>
    <BotAvatar bot={item} className="messenger-bot__avatar" animated={!item.sidebar?.hidden || hiddenOpen} />
    <span className="messenger-bot__text"><strong>{item.name}</strong><span>{runningBotIds.has(item.id) ? BOT_ACTIVITY[botActivities[item.id]?.kind ?? 'thinking'].label : previewFor(item.id)}</span></span>
    {item.sidebar?.unread ? <i className="messenger-unread" aria-label="未读" /> : runningBotIds.has(item.id) ? <span className="messenger-bot__activity" aria-label="运行中" /> : null}
  </button>;

  const openSearch = () => { onExpand(); setMenuOpen(false); setContext(null); setGroupContext(null); setChatContext(null); setSearchOpen(true); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault(); onExpand(); setMenuOpen(false); setContext(null); setGroupContext(null); setChatContext(null); setSearchOpen(true);
      }
      if (event.key === 'Escape') { if (menuOpen) menuButtonRef.current?.focus(); setMenuOpen(false); setSearchOpen(false); }
    };
    const outside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuButtonRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', outside);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', outside); };
  }, [onExpand, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);

  return (
    <aside ref={sidebarRef} className="sidebar sidebar--messenger" aria-label="Bot 列表">
      <div className="messenger-toolbar">
        <IconButton name="search" label="搜索 Bot" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={openSearch} />
        <IconButton name="plus" label="添加 Bot" onClick={onCreateBot} />
      </div>
      {workspaces.length > 1 ? <div className="workspace-switcher" role="group" aria-label="工作区">
        {workspaces.map((workspace) => <button type="button" key={workspace.id} className={workspace.id === activeWorkspace?.id ? 'is-active' : ''} aria-pressed={workspace.id === activeWorkspace?.id} onClick={() => selectWorkspace(workspace.id)}>
          <Icon name={workspace.kind === 'local' ? 'terminal' : 'cloud'} size={14} /><span>{workspace.kind === 'local' ? '本地' : '云电脑'}</span>
        </button>)}
      </div> : null}
      {pinnedBots.length ? <div className="messenger-pins" aria-label="置顶 Bot">
        {pinnedBots.map((item) => <button type="button" className={`messenger-pin ${view === 'chat' && !conversation?.group && bot?.id === item.id ? 'is-active' : ''}`} key={item.id} data-bot-id={item.id} title={item.name} aria-label={`打开置顶 Bot ${item.name}`} aria-current={view === 'chat' && !conversation?.group && bot?.id === item.id ? 'page' : undefined} aria-haspopup="menu" onClick={() => selectBot(item.id)} onContextMenu={(event) => openContext(event, item)}>
          <span className="messenger-pin__portrait"><BotAvatar bot={item} size="lg" />{item.sidebar?.unread ? <i className="messenger-unread" aria-label="未读" /> : null}</span><span className="messenger-pin__name">{item.name}</span>
        </button>)}
      </div> : null}
      {pinnedBots.length ? <div className="messenger-pin-divider" role="separator" aria-label="置顶与其他 Bot" /> : null}
      <nav className="messenger-bots" aria-label="你的 Bot">
        {orderedGroups.map((group) => { const items = groups.get(group.name) ?? []; const open = collapsed || !group.collapsed;
          if (!group.name) return <div className="messenger-group" key="" data-bot-group="">{namedGroups.length ? <button type="button" className="messenger-group__name messenger-ungrouped__title" aria-label="未分组" aria-haspopup="menu" onContextMenu={(event) => openGroupContext(event, '')}><Icon name="folder" size={12} /><span>未分组</span><small>{items.length}</small></button> : null}{items.map(renderBot)}</div>;
          return <div className="messenger-group" key={group.name} data-bot-group={group.name}>
          <button type="button" className="messenger-group__name messenger-group__toggle" aria-label={`${group.name} 分组`} aria-expanded={open} aria-controls={`bot-group-${encodeURIComponent(group.name)}`} aria-haspopup="menu" onContextMenu={(event) => openGroupContext(event, group.name)} onClick={() => void updateBotGroup(group.name, { type: 'collapse', collapsed: !group.collapsed }).catch((error: Error) => toast(error.message, 'error'))}>
            <Icon name="folder" size={12} /><span>{group.name}</span><small>{items.length}</small><Icon name="chevron" size={12} className={`messenger-group__chevron ${open ? 'is-open' : ''}`} />
          </button>
          <div id={`bot-group-${encodeURIComponent(group.name)}`} className="messenger-group__body" hidden={!open}>{open ? items.map(renderBot) : null}</div>
        </div>; })}
        {groupChats.length ? <div className="messenger-group messenger-group--chats">
          <button type="button" className="messenger-group__name messenger-group__toggle" aria-label="群聊列表" aria-expanded={chatsOpen} aria-controls="sidebar-group-chats" onClick={() => void setGroupChatsCollapsed(!activeWorkspace?.groupChatsCollapsed).catch((error: Error) => toast(error.message, 'error'))}><Icon name="users" size={12} /><span>群聊</span><small>{groupChats.length}</small><Icon name="chevron" size={12} className={`messenger-group__chevron ${chatsOpen ? 'is-open' : ''}`} /></button>
          <div id="sidebar-group-chats" className="messenger-group__body" hidden={!chatsOpen}>{chatsOpen ? groupChats.map((group) => <button type="button" key={group.id} className={`messenger-bot messenger-group-chat ${view === 'chat' && conversation?.id === group.id ? 'is-active' : ''}`} data-group-id={group.id} aria-current={view === 'chat' && conversation?.id === group.id ? 'page' : undefined} aria-haspopup="menu" title={group.title} onClick={() => selectBot(group.id)} onContextMenu={(event) => openChatContext(event, group.id)}><span className="group-chat-icon"><Icon name="users" size={20} /></span><span className="messenger-bot__text"><strong>{group.title}</strong><span>{group.preview || `${group.group!.memberBotIds.length} 个 Bot · 开始群聊`}</span></span>{runningGroupIds.has(group.id) ? <span className="messenger-bot__activity" aria-label="运行中" /> : null}</button>) : null}</div>
        </div> : null}
        {hiddenBots.length ? <details className="messenger-hidden" open={hiddenOpen} onToggle={(event) => setHiddenOpen(event.currentTarget.open)}>
          <summary className="messenger-hidden__title" aria-label="已隐藏的 Bot"><Icon name="hide" size={13} /><span>已隐藏的 Bot</span><small>{hiddenBots.length}</small><Icon name="chevron" size={13} className="messenger-hidden__chevron" /></summary>
          <div className="messenger-hidden__body">{hiddenBots.map(renderBot)}</div>
        </details> : null}
        {!filteredBots.length ? <p className="messenger-no-results">没有找到相关 Bot</p> : null}
      </nav>
      <div className="messenger-footer">
        <button type="button" ref={menuButtonRef} className={`messenger-profile ${menuOpen ? 'is-active' : ''}`} aria-label="用户菜单" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setContext(null); setGroupContext(null); setChatContext(null); setMenuOpen((value) => !value); }} title={`${settings.userName || '本地用户'} · 功能菜单`}>
          <UserAvatar /><span className="messenger-profile__name">{settings.userName || '本地用户'}</span>
        </button>
        <button type="button" className={`messenger-menu-button ${connectorsOpen ? 'is-active' : ''}`} aria-label="连接器" title="连接器" aria-haspopup="dialog" aria-expanded={connectorsOpen} onClick={(event) => { event.currentTarget.focus(); setMenuOpen(false); setContext(null); setGroupContext(null); setChatContext(null); setConnectorsOpen(true); }}>
          <Icon name="plug" size={18} />
        </button>
      </div>
      {context && contextBot ? <BotContextMenu key={`${context.botId}-${context.x}-${context.y}`} bot={contextBot} x={context.x} y={context.y} onClose={closeContext} onTogglePin={() => togglePin(contextBot)} /> : null}
      {groupContext ? <GroupContextMenu key={`${groupContext.name}-${groupContext.x}-${groupContext.y}`} {...groupContext} onClose={closeGroupContext} /> : null}
      {chatContext && contextChat ? <GroupChatContextMenu key={`${chatContext.id}-${chatContext.x}-${chatContext.y}`} group={contextChat} index={groupChats.indexOf(contextChat)} count={groupChats.length} x={chatContext.x} y={chatContext.y} onClose={closeChatContext} /> : null}
      {searchOpen ? <SearchDialog onClose={closeSearch} onCreateBot={onCreateBot} onCreateGroup={() => setCreatingGroup(true)} /> : null}
      {creatingGroup ? <CreateGroupDialog onClose={closeGroup} /> : null}
      {connectorsOpen ? <ConnectorsDialog onClose={closeConnectors} /> : null}
      {mobileOpen ? <MobileConnectionDialog onClose={() => setMobileOpen(false)} /> : null}
      {menuOpen ? createPortal(<div className="workspace-menu" ref={menuRef} aria-label="工作空间功能" role="menu" onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setMobileOpen(true); }}><Icon name="plug" size={16}/><span><strong>连接手机</strong></span><Icon name="chevron" size={12}/></button>
        {FEATURES.map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => { if (item.id === 'settings') openSettings('profile'); else if (item.id === 'usage') openSettings('usage'); else setView(item.id); setMenuOpen(false); }}>
          <Icon name={item.icon} size={16} /><span><strong>{item.id === 'cloud' && activeWorkspace?.kind === 'local' ? '本地电脑' : item.label}</strong></span><Icon name="chevron" size={12} />
        </button>)}
      </div>, document.body) : null}
    </aside>
  );
}
