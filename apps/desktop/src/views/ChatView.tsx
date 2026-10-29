import { useEffect, useRef, useState } from 'react';
import type { Bot, Message, ToolResult } from '@moyu/core';
import { assetUrl, moyu } from '../lib/bridge';
import { formatClock } from '../lib/format';
import { highlightCode, openLinksExternally, renderMarkdown } from '../lib/markdown';
import { useMoyu } from '../state';
import { BotAvatar } from '../components/BotAvatar';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { Button, IconButton, Sheet, Spinner, useAutoScroll } from '../components/Glass';
import type { IconName } from '../components/Icon';
import { BOT_ACTIVITY, inferMessageActivity } from '../lib/bot-activity';
import type { BotActivityKind } from '../lib/bot-activity';

const TOOL_ICON: Record<string, IconName> = {
  cloud_exec: 'terminal',
  cloud_read: 'folder',
  cloud_write: 'folder',
  generate_image: 'image',
  remember: 'memory',
  recall: 'memory',
  web_fetch: 'globe',
  schedule_task: 'clock',
  list_tasks: 'clock',
  update_task: 'clock',
};
const TASK_TOOL_LABEL: Record<string, string> = { schedule_task: '安排任务', list_tasks: '查询任务', update_task: '管理任务' };

const SUGGESTIONS = [
  { icon: 'image' as IconName, title: '创作一张图', text: '帮我设计一张极简风格的产品海报，主题是「让灵感自由发生」，画幅 16:9。' },
  { icon: 'terminal' as IconName, title: '运行一段代码', text: '唤醒云电脑，检查 Python 版本、磁盘空间和已安装的浏览器，然后用一段话总结。' },
  { icon: 'folder' as IconName, title: '整理工作文件', text: '在云电脑 /data/moyubot 下建一个 weekly 目录，写一份本周工作摘要模板并读回来确认。' },
  { icon: 'clock' as IconName, title: '安排定时任务', text: '创建一个定时任务：每个工作日 9 点唤醒云电脑，检查 /data/moyubot 下最新文件并汇报。' },
];
const LOCAL_SUGGESTIONS = [
  SUGGESTIONS[0]!,
  { icon: 'terminal' as IconName, title: '运行一段代码', text: '在本机 Windows 工作区用 PowerShell 检查系统版本和当前目录，并检查 Python 是否可用，然后总结。' },
  { icon: 'folder' as IconName, title: '整理工作文件', text: '在当前本地工作区新建 weekly 目录，写一份本周工作摘要模板并读回来确认。' },
  { icon: 'clock' as IconName, title: '安排定时任务', text: '创建一个定时任务：每个工作日 9 点检查本地工作区最新文件并汇报，在本机运行。' },
];

function jumpToMessage(id: string, reduceMotion: boolean) {
  reduceMotion ||= window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = [...document.querySelectorAll<HTMLElement>('.msg[data-message-id]')].find((node) => node.dataset.messageId === id);
  if (!target) return;
  target.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
  if (!reduceMotion) target.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 600 });
}

function ReplyPreview({ reply, onClick }: { reply: NonNullable<Message['replyTo']>; onClick: () => void }) {
  return <button type="button" className="message-quote" onClick={onClick} aria-label={`查看引用的 ${reply.author} 的消息`}><Icon name="reply" size={14} /><span><strong>{reply.author}</strong><span>{reply.content}</span></span></button>;
}

function MessageActions({ message, onReply }: { message: Message; onReply: (quote: NonNullable<Message['replyTo']>) => void }) {
  const { toast } = useMoyu();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (copied) { const timer = window.setTimeout(() => setCopied(false), 1800); return () => window.clearTimeout(timer); } }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.content || message.attachments?.map((file) => file.name ?? '图片').join('\n') || ''); setCopied(true); }
    catch { toast('复制失败，请重试', 'error'); }
  };
  return <div className="msg__footer"><time className="msg__meta" dateTime={new Date(message.createdAt).toISOString()}>{formatClock(message.createdAt)}</time>
    {!message.streaming ? <div className="msg__actions" aria-label="消息操作"><button type="button" aria-label={copied ? '已复制消息' : '复制消息'} title={copied ? '已复制' : '复制'} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={14} /><span className="sr-only" role="status">{copied ? '已复制' : ''}</span></button><button type="button" aria-label="回复引用消息" title="回复 / 引用（可先选中文字）" onPointerDown={(event) => event.preventDefault()} onClick={(event) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      const container = event.currentTarget.closest('.msg')?.querySelector('[data-message-content]');
      const selected = text && selection?.anchorNode && selection.focusNode && container?.contains(selection.anchorNode) && container.contains(selection.focusNode) && message.content.includes(text) ? text : undefined;
      onReply({ messageId: message.id, author: '', content: selected || message.content || message.attachments?.map((file) => `[图片：${file.name ?? '图片'}]`).join('\n') || '（空消息）' });
      selection?.removeAllRanges();
    }}><Icon name="reply" size={15} /></button></div> : null}
  </div>;
}

function MessageBubble({ message, bot, isLatest, onReply }: { message: Message; bot: Bot; isLatest: boolean; onReply: (quote: NonNullable<Message['replyTo']>) => void }) {
  const { botActivities, setView, settings } = useMoyu();
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (message.role === 'assistant' && ref.current && message.content) highlightCode(ref.current);
  }, [message.content, message.role]);

  if (message.role === 'user') {
    return (
      <div className="msg msg--user" data-message-id={message.id} tabIndex={-1}>
        <div className="msg__stack msg__stack--user">
        <div className="bubble bubble--user">
          {message.replyTo ? <ReplyPreview reply={message.replyTo} onClick={() => jumpToMessage(message.replyTo!.messageId, settings.ui.reduceMotion)} /> : null}
          {message.attachments?.length ? (
            <div className="artifact-grid artifact-grid--user">
              {message.attachments.map((attachment) => (
                <img
                  key={attachment.id}
                  className="artifact artifact--sm"
                  src={assetUrl(attachment.path) ?? attachment.dataUrl}
                  alt={attachment.name}
                />
              ))}
            </div>
          ) : null}
          {message.content ? <p className="bubble__text" data-message-content={message.id}>{message.content}</p> : null}
        </div>
        <MessageActions message={message} onReply={(quote) => onReply({ ...quote, author: '你' })} />
        </div>
      </div>
    );
  }

  const results = new Map<string, ToolResult>((message.toolResults ?? []).map((result) => [result.id, result]));
  const calls = message.toolCalls ?? [];
  const activity = botActivities[bot.id];
  const current = isLatest && activity?.messageId === message.id;
  const kind: BotActivityKind = message.streaming ? activity?.kind && activity.kind !== 'idle' ? activity.kind : inferMessageActivity(message) : message.error ? 'error' : message.stopped ? 'stopped' : current && activity.kind === 'done' ? 'done' : 'idle';
  const animate = !!message.streaming || !!(current && ['done', 'error', 'stopped'].includes(activity.kind));
  const content = message.error && message.content === `（没有回复：${message.error}）` ? '' : message.content;

  return (
    <div className="msg msg--assistant" data-message-id={message.id} tabIndex={-1}>
      <div className="msg__avatar">
        <BotAvatar bot={bot} activity={kind} animated={animate} />
      </div>
      <div className="msg__stack">
      <div className="msg__body" ref={ref}>
        {message.botId ? <strong className="group-reply-name">{message.botName ?? bot.name}</strong> : null}
        {message.streaming || kind === 'done' || message.stopped ? <div className={`reply-status ${message.streaming ? 'is-live' : ''}`} data-activity={kind} role="status" aria-live="polite"><span>{BOT_ACTIVITY[kind].label}</span>{message.streaming ? <span className="reply-status__pulse" aria-hidden="true"><i /><i /><i /></span> : null}</div> : null}
        {message.reasoning ? (
          <details className="reasoning">
            <summary>思考过程</summary>
            <p>{message.reasoning}</p>
          </details>
        ) : null}

        {calls.length > 0 ? (
          <div className="tool-stack">
            {calls.map((call) => {
              const result = results.get(call.id);
              const open = expanded[call.id] ?? false;
              return (
                <div key={call.id} className={`tool-card ${result?.ok === false ? 'is-error' : ''} ${!result && message.streaming ? 'is-running' : ''}`.trim()}>
                  <button type="button" className="tool-card__head" onClick={() => setExpanded((prev) => ({ ...prev, [call.id]: !open }))}>
                    <span className="tool-card__icon">
                      <Icon name={TOOL_ICON[call.name] ?? 'spark'} size={16} />
                    </span>
                    <span className="tool-card__name">{TASK_TOOL_LABEL[call.name] ?? call.name}</span>
                    <span className="tool-card__summary">
                      {result ? result.summary : !message.streaming ? message.stopped ? '已停止' : '未完成' : call.name === 'cloud_exec' ? String(call.arguments.cmd ?? '').slice(0, 60) : '执行中…'}
                    </span>
                    {!result && message.streaming ? <Spinner size={14} /> : <Icon name="chevron" size={15} className={`tool-card__chevron ${open ? 'is-open' : ''}`} />}
                  </button>
                  {open ? (
                    <div className="tool-card__body">
                      {call.name === 'cloud_exec' && call.arguments.cmd ? <pre className="tool-card__cmd">$ {String(call.arguments.cmd)}</pre> : null}
                      {result?.detail ? <pre className="tool-card__out">{result.detail}</pre> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {message.attachments?.filter((attachment) => attachment.kind === 'image').length ? (
          <div className="artifact-grid">
            {message.attachments
              .filter((attachment) => attachment.kind === 'image')
              .map((attachment) => {
                const url = assetUrl(attachment.path) ?? attachment.dataUrl;
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    className="artifact artifact--auto"
                    onClick={() => (attachment.path ? void moyu().openArtifact(attachment.path) : undefined)}
                    title="点击用系统查看器打开"
                  >
                    <img src={url} alt={attachment.name} />
                    <span className="artifact__hint">打开原图</span>
                  </button>
                );
              })}
          </div>
        ) : null}

        {content ? <div className="prose" data-message-content={message.id} onClick={openLinksExternally} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} /> : null}

        {message.error ? <div className="reply-error" role="alert"><strong>暂时无法回复</strong><p className="msg__error">{message.error}</p>{/API\s*Key|密钥|供应商/i.test(message.error) ? <button type="button" onClick={() => setView('settings')}>配置供应商</button> : null}</div> : null}
        {message.streaming ? <span className="stream-caret" /> : null}
        {!message.streaming && message.usage ? (
          <span className="msg__usage">
            {message.usage.promptTokens ? `${message.usage.promptTokens} in` : ''}
            {message.usage.completionTokens ? ` · ${message.usage.completionTokens} out` : ''}
          </span>
        ) : null}
      </div>
      <MessageActions message={message} onReply={(quote) => onReply({ ...quote, author: message.botName ?? bot.name })} />
      </div>
    </div>
  );
}

function Composer({ bot, home, replyTo, onClearReply }: { bot: Bot; home: boolean; replyTo?: Message['replyTo']; onClearReply: () => void }) {
  const { running, sendMessage, stop, saveBot, settings, compacting, conversation, toast } = useMoyu();
  const group = conversation?.group;
  const recipient = group ? conversation.title : bot.name;
  const [text, setText] = useState('');
  const [images, setImages] = useState<{ name?: string; mimeType: string; dataUrl: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const provider = settings.providers.find((item) => item.id === bot.providerId);

  useEffect(() => { if (replyTo) textarea.current?.focus(); }, [replyTo]);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [text, home]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = wrap?.closest<HTMLElement>('.chat__stage');
    if (home || !wrap || !stage) return;
    const observer = new ResizeObserver(() => {
      const messages = stage.querySelector<HTMLElement>('.messages');
      const atBottom = messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      stage.style.setProperty('--composer-height', `${wrap.offsetHeight}px`);
      if (atBottom) messages.scrollTo({ top: messages.scrollHeight, behavior: 'instant' });
    });
    observer.observe(wrap);
    return () => { observer.disconnect(); stage.style.removeProperty('--composer-height'); };
  }, [home]);

  const updateOptions = async (patch: Partial<Pick<Bot, 'model' | 'approvalPolicy'>>) => {
    if (savingOptions) return;
    setSavingOptions(true);
    try { await saveBot({ ...bot, ...patch }, { stayInSettings: true }); }
    catch (error) { toast((error as Error).message, 'error'); }
    finally { setSavingOptions(false); }
  };

  const readFiles = async (files: FileList | File[]) => {
    const next: typeof images = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 8 * 1024 * 1024) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      next.push({ name: file.name, mimeType: file.type, dataUrl });
    }
    setImages((prev) => [...prev, ...next].slice(0, 4));
  };

  const submit = async () => {
    if (running || (!text.trim() && images.length === 0)) return;
    const payload = text;
    const payloadImages = images;
    setText('');
    setImages([]);
    const sent = await sendMessage(payload, payloadImages, replyTo);
    if (sent) onClearReply();
    else { setText(payload); setImages(payloadImages); }
    textarea.current?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={`composer-wrap ${!home ? 'composer-wrap--floating' : ''} ${dragOver ? 'is-dragover' : ''}`.trim()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void readFiles(event.dataTransfer.files);
      }}
    >
      {replyTo ? <div className="composer-reply" role="region" aria-label="正在引用的消息"><ReplyPreview reply={replyTo} onClick={() => jumpToMessage(replyTo.messageId, settings.ui.reduceMotion)} /><button type="button" className="composer-reply__dismiss" aria-label="取消引用" title="取消引用" onClick={() => { onClearReply(); textarea.current?.focus(); }}><Icon name="close" size={14} /></button></div> : null}
      <div className={`composer glass composer--compact ${images.length ? 'has-attachments' : ''}`.trim()}>
        {images.length ? (
          <div className="attachment-row">
            {images.map((image, index) => (
              <div className="attachment-chip" key={`${image.name}-${index}`}>
                <img src={image.dataUrl} alt={image.name ?? '图片'} />
                <button type="button" aria-label="移除" onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer__leading">
          <IconButton name="plus" label="添加图片" className="composer__attach" onClick={() => fileInput.current?.click()} />
          {!group ? <Select label="执行权限" className={`composer-policy-picker composer-policy-picker--${bot.approvalPolicy}`} icon={bot.approvalPolicy === 'ask' ? 'shield' : bot.approvalPolicy === 'always' ? 'key' : 'spark'} iconOnly menuMinWidth={230} value={bot.approvalPolicy} disabled={savingOptions} onChange={(value) => void updateOptions({ approvalPolicy: value as Bot['approvalPolicy'] })} options={[
            { value: 'never', label: '自动执行', hint: '按 Bot 配置自动执行工具' },
            { value: 'ask', label: '每次确认', hint: '执行命令和写入文件前确认' },
            { value: 'always', label: '全部允许', hint: '工具直接执行，无需确认' },
          ]} /> : null}
        </div>
        <textarea
          ref={textarea}
          className="composer__input"
          value={text}
          rows={1}
          aria-label={`给 ${recipient} 发送消息`}
          placeholder={compacting ? '正在整理上下文与记忆…' : group ? '发消息，让大家一起聊聊…' : home ? `和 ${bot.name} 说点什么…` : `给 ${bot.name} 发消息`}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const files = event.clipboardData.files;
            if (files.length) {
              event.preventDefault();
              void readFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer__bar">
          <div className="composer__options">
            {group ? <span className="group-composer-hint" title={`${group.memberBotIds.length} 个 Bot · 依次回复`} aria-label={`${group.memberBotIds.length} 个 Bot · 依次回复`}><Icon name="users" size={14} /><span>{group.memberBotIds.length} 个 Bot · 依次回复</span></span> : <Select label="模型" className="composer-model-picker" menuMinWidth={210} align="end" value={bot.model} disabled={savingOptions} onChange={(value) => void updateOptions({ model: value })} options={[...new Set([bot.model, ...(provider?.models ?? [])])].filter(Boolean).map((model) => ({ value: model, label: model }))} />}
          </div>
          <div className="composer__actions">
            {running ? (
              <Button variant="danger" size="sm" icon="stop" aria-label="停止生成" onClick={stop}>
                停止
              </Button>
            ) : (
              <button
                type="button"
                className="send-btn"
                aria-label="发送"
                disabled={!text.trim() && images.length === 0}
                onClick={() => void submit()}
              >
                <Icon name="arrowUp" size={19} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
      {home ? <div className="starter-actions" aria-label="灵感建议">
        {(bot.workspaceId === 'workspace_local' ? LOCAL_SUGGESTIONS : SUGGESTIONS).map((item) => <button type="button" key={item.title} onClick={() => { setText(bot.workspaceId === 'workspace_local' ? item.text : item.text.replaceAll('/data/moyubot', settings.cloud.remoteWorkspaceDir ?? '/data/moyubot')); textarea.current?.focus(); }}>
          <Icon name={item.icon} size={16} /><span>{item.title}</span>
        </button>)}
      </div> : null}
      {home ? <p className="composer-hint">Enter 发送 · Shift + Enter 换行 · 支持粘贴或拖入图片</p> : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void readFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function EmptyState({ bot }: { bot: Bot }) {
  return (
    <div className="empty">
      <div className="welcome-character"><BotAvatar bot={bot} size="xl" /></div>
      <span className="welcome-eyebrow">一点灵感，无限可能</span>
      <h1>今天，想做点什么？</h1>
      <p className="empty__sub">我是 {bot.name}。陪你思考，也替你动手。</p>
    </div>
  );
}

export function ChatView({ inspectorOpen, onToggleInspector }: { inspectorOpen: boolean; onToggleInspector: () => void }) {
  const { bot, conversation, settings, setView, activeWorkspace } = useMoyu();
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [reply, setReply] = useState<{ conversationId: string; quote: NonNullable<Message['replyTo']> }>();
  useEffect(() => setReply(undefined), [conversation?.id]);
  useEffect(() => setGroupInfoOpen(false), [conversation?.id]);
  const members = conversation?.group?.memberBotIds.map((id) => settings.bots.find((item) => item.id === id)).filter((item): item is Bot => !!item) ?? [];
  const messages = conversation?.messages ?? [];
  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const scrollRef = useAutoScroll<HTMLDivElement>([messages.length, messages.at(-1)?.content, messages.at(-1)?.toolResults?.length]);

  if (!bot) {
    return (
      <div className="view view--empty">
        <Icon name={activeWorkspace?.kind === 'local' ? 'terminal' : 'cloud'} size={36} /><h2>{activeWorkspace?.name}</h2><p>这个工作区还没有 Bot，创建一个开始工作。</p>
        <Button variant="primary" icon="plus" onClick={() => setView('bots')}>
          创建 Bot
        </Button>
      </div>
    );
  }

  if (!conversation || (!conversation.group && conversation.botId !== bot.id)) return <div className="view view--empty"><Spinner /><p>正在载入 {bot.name} 的对话…</p></div>;

  return (
    <section className={`chat ${messages.length === 0 ? 'chat--home' : ''}`} data-context-summarized={!!conversation.context}>
      <header className="chat__head">
        <h2 className="chat__title">
          <button type="button" className={`chat__who ${inspectorOpen || groupInfoOpen ? 'is-active' : ''}`} aria-label={conversation.group ? '群聊成员与详情' : '对话详情与记忆'} aria-expanded={conversation.group ? groupInfoOpen : inspectorOpen} title={conversation.group ? conversation.title : `${bot.name} · 对话详情与记忆`} onClick={conversation.group ? () => setGroupInfoOpen(true) : onToggleInspector}>
            {conversation.group ? <span className="group-chat-icon"><Icon name="users" size={21} /></span> : <BotAvatar bot={bot} size="lg" />}
            <span className="chat__name">{conversation.group ? conversation.title : bot.name}</span>
          </button>
        </h2>
      </header>

      <div className="chat__stage">
      <div className="messages" ref={scrollRef}>
        <div className="messages__inner">
          {messages.length === 0 ? conversation.group ? <div className="empty group-welcome"><div className="group-welcome__avatars">{members.slice(0, 5).map((member) => <BotAvatar key={member.id} bot={member} size="xl" />)}</div><span className="welcome-eyebrow">一起聊，让想法碰撞</span><h1>{conversation.title}</h1><p className="empty__sub">{members.map((member) => member.name).join('、')} 已加入，发条消息开始吧。</p></div> : <EmptyState bot={bot} /> : messages.map((message) => <MessageBubble key={message.id} message={message} bot={settings.bots.find((item) => item.id === message.botId) ?? bot} isLatest={message.id === latestAssistantId} onReply={(quote) => setReply({ conversationId: conversation.id, quote })} />)}
        </div>
      </div>

      <Composer key={conversation.id} bot={bot} home={messages.length === 0} replyTo={reply?.conversationId === conversation.id ? reply.quote : undefined} onClearReply={() => setReply(undefined)} />
      </div>
      {messages.length === 0 ? <div className="home-footnote"><Icon name={activeWorkspace?.kind === 'local' ? 'terminal' : 'cloud'} size={14} /><span>{activeWorkspace?.kind === 'local' ? '所有 Bot 共用本机 Windows 工作区' : '工作区内的 Bot 共用一台云电脑'}</span><span className="home-footnote__dot">·</span><span>{activeWorkspace?.kind === 'local' ? '文件与命令在本地完成' : '需要时唤醒，空闲时休眠'}</span></div> : null}
      {groupInfoOpen && conversation.group ? <Sheet open title={conversation.title} subtitle="成员按以下顺序回复，共享本群的消息与记忆。" onClose={() => setGroupInfoOpen(false)}><div className="group-member-list">{conversation.group.memberBotIds.map((id, index) => { const member = settings.bots.find((item) => item.id === id); return <div className="group-member" key={id}>{member ? <BotAvatar bot={member} animated={false} /> : <Icon name="bots" />}<span><strong>{member?.name ?? '已移除的 Bot'}</strong><small>{member?.model ?? '不再参与回复'}</small></span><small>{index + 1}</small></div>; })}</div></Sheet> : null}
    </section>
  );
}
