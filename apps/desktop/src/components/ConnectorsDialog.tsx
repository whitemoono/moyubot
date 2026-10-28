import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { Button, IconButton, Sheet } from './Glass';
import { Icon } from './Icon';

const APPS = [
  { id: 'gmail', name: 'Gmail', category: '邮件', description: '搜索邮件，整理重要信息与待办。', features: ['搜索和阅读邮件', '汇总邮件内容，提取待办事项'] },
  { id: 'github', name: 'GitHub', category: '开发', description: '让仓库、Issue 和代码变更进入对话。', features: ['查找仓库、Issue 和 Pull Request', '了解代码变更与项目进度'] },
  { id: 'drive', name: 'Google Drive', category: '文件', description: '查找云端文件，引用你的工作资料。', features: ['搜索云端文件与文档', '引用文档内容，整理资料'] },
  { id: 'notion', name: 'Notion', category: '知识库', description: '从页面与数据库中找到项目上下文。', features: ['查找页面和数据库', '读取知识库，汇总项目资料'] },
  { id: 'slack', name: 'Slack', category: '协作', description: '查找团队讨论，跟进沟通与进展。', features: ['搜索频道消息与讨论', '汇总团队进度与决策'] },
  { id: 'outlook', name: 'Outlook', category: '邮件', description: '把邮件与日程信息带入工作空间。', features: ['查找和阅读邮件', '整理日程信息与待办事项'] },
] as const;

function AppLogo({ id }: { id: string }) {
  const logos: Record<string, React.ReactNode> = {
    gmail: <><path d="M3 7v14h5V11l8 6 8-6v10h5V7l-5 4-8 6L8 11Z" fill="#4285f4" /><path d="m3 7 5 4v10H3Z" fill="#4285f4" /><path d="M24 11v10h5V7Z" fill="#34a853" /><path d="M3 7V5c0-2 2-3 4-2l9 7 9-7c2-1 4 0 4 2v2l-5 4-8 6-8-6Z" fill="#ea4335" /><path d="M24 4v7l5-4V5c0-2-2-3-4-2Z" fill="#fbbc04" /></>,
    github: <><path fill="currentColor" d="M16 2a14 14 0 0 0-4.4 27.3c.7.1.9-.3.9-.6v-2.5c-3.9.8-4.7-1.7-4.7-1.7-.6-1.6-1.6-2-1.6-2-1.3-.9.1-.9.1-.9 1.4.1 2.2 1.4 2.2 1.4 1.2 2.2 3.3 1.6 4.1 1.2.1-.9.5-1.6.9-2-3.1-.4-6.4-1.6-6.4-7 0-1.5.5-2.8 1.4-3.8-.1-.4-.6-1.8.2-3.7 0 0 1.2-.4 3.9 1.4a13.4 13.4 0 0 1 7.1 0c2.7-1.8 3.9-1.4 3.9-1.4.8 1.9.3 3.3.2 3.7.9 1 1.4 2.3 1.4 3.8 0 5.4-3.3 6.6-6.4 7 .5.4 1 1.3 1 2.6v3.9c0 .4.2.8 1 .6A14 14 0 0 0 16 2Z" /></>,
    drive: <><path d="m12 3 8 0 10 18h-8Z" fill="#fbbc04" /><path d="M12 3 2 21l4 7 10-18Z" fill="#34a853" /><path d="M2 21h28l-4 7H6Z" fill="#4285f4" /></>,
    notion: <><rect x="3" y="3" width="26" height="26" rx="4" fill="#fff" stroke="#202020" strokeWidth="2" /><path d="M9 24V9h4l9 14V9M7 9h8M19 9h6M7 24h6" fill="none" stroke="#202020" strokeWidth="2" /></>,
    slack: <><path d="M12 3v10H4" stroke="#36c5f0" strokeWidth="5" strokeLinecap="round" /><path d="M29 12H19V4" stroke="#2eb67d" strokeWidth="5" strokeLinecap="round" /><path d="M20 29V19h8" stroke="#ecb22e" strokeWidth="5" strokeLinecap="round" /><path d="M3 20h10v8" stroke="#e01e5a" strokeWidth="5" strokeLinecap="round" /></>,
    outlook: <><rect x="11" y="6" width="19" height="23" rx="2" fill="#1490df" /><path d="m12 11 8 7 10-7" fill="none" stroke="#b1def8" strokeWidth="2" /><rect x="2" y="9" width="18" height="20" rx="2" fill="#0867b8" /><ellipse cx="11" cy="19" rx="4" ry="6" fill="none" stroke="#fff" strokeWidth="2" /></>,
  };
  return <svg viewBox="0 0 32 32" width="27" height="27" aria-hidden="true">{logos[id]}</svg>;
}

export function ConnectorsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useDialogFocus(ref, onClose);
  const selected = APPS.find((item) => item.id === selectedId);
  const apps = APPS.filter((item) => `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.connector-search input, .sheet__head button')?.focus(); }, [selectedId]);
  return createPortal(<div ref={ref}><Sheet open title={selected ? `连接 ${selected.name}` : '连接器'} subtitle={selected ? '将应用中的资料带入 Bot 对话。' : '连接常用应用，让 Bot 更了解你的工作。'} className={`sheet--connectors ${selected ? 'sheet--connector-detail' : ''}`} onClose={onClose} footer={selected ? <><Button variant="ghost" onClick={() => setSelectedId(null)}>返回应用列表</Button><span className="spacer" /><Button variant="primary" icon="plug" disabled>授权连接</Button></> : undefined}>
    {selected ? <div className="connector-detail" data-connector-detail={selected.id}>
      <div className="connector-detail__identity"><span className="connector-card__icon"><AppLogo id={selected.id} /></span><div><strong>{selected.name}</strong><span>未连接</span></div></div>
      <p>{selected.description}</p>
      <h4>计划支持</h4><ul>{selected.features.map((feature) => <li key={feature}><Icon name="check" size={15} /><span>{feature}</span></li>)}</ul>
      <div className="connector-detail__notice"><Icon name="clock" size={17} /><span><strong>连接功能准备中</strong><small>授权接入后即可使用，目前尚未连接此应用。</small></span></div>
    </div> : <>
      <div className="connector-search"><Icon name="search" size={16} /><input value={query} aria-label="搜索连接器" placeholder="搜索应用" onChange={(event) => setQuery(event.target.value)} />{query ? <IconButton name="close" label="清空应用搜索" onClick={() => { setQuery(''); ref.current?.querySelector<HTMLInputElement>('input')?.focus(); }} /> : null}</div>
      <div className="connector-list">{apps.map((entry) => <button type="button" className="connector-card" key={entry.id} data-connector={entry.id} aria-label={`连接 ${entry.name}`} onClick={() => setSelectedId(entry.id)}><span className="connector-card__icon"><AppLogo id={entry.id} /></span><span className="connector-card__text"><strong>{entry.name}</strong><small>{entry.description}</small><span><i />未连接</span></span><Icon name="plus" size={17} /></button>)}</div>
      {!apps.length ? <div className="connector-empty"><Icon name="search" size={24} /><p>没有找到相关应用</p></div> : null}
      <p className="connector-catalog-note">应用授权准备中，连接功能稍后开放。</p>
    </>}
  </Sheet></div>, document.body);
}
