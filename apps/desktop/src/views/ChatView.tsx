import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent } from 'react';
import type { Bot, Message, ToolResult } from '@moyu/core';
import { assetUrl, moyu } from '../lib/bridge';
import { formatClock } from '../lib/format';
import { highlightCode, openLinksExternally, renderMarkdown } from '../lib/markdown';
import { useMoyu } from '../state';
import { BotAvatar } from '../components/BotAvatar';
import { ReplyToolCard } from '../components/ReplyToolCard';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { ContextMeter } from '../components/ContextMeter';
import { EffortPicker } from '../components/EffortPicker';
import { Button, IconButton, Spinner, useAutoScroll } from '../components/Glass';
import { TextEditContextMenu } from '../components/TextEditContextMenu';
import { MessageContextMenu, type MessageSelectionMenuState } from '../components/MessageContextMenu';
import type { IconName } from '../components/Icon';
import { BOT_ACTIVITY, inferMessageActivity } from '../lib/bot-activity';
import type { BotActivityKind } from '../lib/bot-activity';
import { replyTurns } from '../lib/reply-flow';

/** 聊天图片放大预览（应用内 lightbox）。 */
interface ImagePreview {
  url: string;
  name?: string;
  path?: string;
}

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
      const containers = event.currentTarget.closest('.msg')?.querySelectorAll('[data-message-content]');
      const selected = text && selection?.anchorNode && selection.focusNode && [...(containers ?? [])].some((container) => container.contains(selection.anchorNode) && container.contains(selection.focusNode)) && message.content.includes(text) ? text : undefined;
      onReply({ messageId: message.id, author: '', content: selected || message.content || message.attachments?.map((file) => `[图片：${file.name ?? '图片'}]`).join('\n') || '（空消息）' });
      selection?.removeAllRanges();
    }}><Icon name="reply" size={15} /></button></div> : null}
  </div>;
}

const MessageBubble = memo(function MessageBubble({ message, bot, isLatest, onReply, onPreviewImage, onMsgMenu }: { message: Message; bot: Bot; isLatest: boolean; onReply: (quote: NonNullable<Message['replyTo']>) => void; onPreviewImage: (image: ImagePreview) => void; onMsgMenu: (menu: MessageSelectionMenuState) => void }) {
  const { botActivities, setView, settings, toast } = useMoyu();
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  // 选中消息文字后右键 → 弹出「复制」菜单（无选区时保持默认行为）。
  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    if (anchor && focus && event.currentTarget.contains(anchor) && event.currentTarget.contains(focus)) {
      event.preventDefault();
      onMsgMenu({ x: event.clientX, y: event.clientY, text });
    }
  };

  // Syntax highlighting is the costly part of a long message; run it once the
  // stream settles rather than on every delta-derived re-render.
  useEffect(() => {
    if (message.role !== 'assistant' || message.streaming || !ref.current || !message.content) return;
    ref.current.querySelectorAll<HTMLElement>('.prose').forEach(highlightCode);
  }, [message.id, message.streaming, message.content]);

  if (message.role === 'user') {
    return (
      <div className="msg msg--user" data-message-id={message.id} tabIndex={-1} onContextMenu={handleContextMenu}>
        <div className="msg__stack msg__stack--user">
        <div className="bubble bubble--user">
          {message.replyTo ? <ReplyPreview reply={message.replyTo} onClick={() => jumpToMessage(message.replyTo!.messageId, settings.ui.reduceMotion)} /> : null}
          {message.attachments?.length ? (
            <div className="artifact-grid artifact-grid--user">
              {message.attachments.map((attachment) => attachment.kind === 'file' ? (
                <button
                  key={attachment.id}
                  type="button"
                  className="artifact artifact--file"
                  title="打开文件"
                  onClick={() => { if (attachment.path) void moyu().openArtifact(attachment.path).catch((error: Error) => toast(error.message, 'error')); }}
                >
                  <Icon name="folder" size={16} />
                  <span className="artifact__file-meta"><strong>{attachment.name}</strong><small>{humanSize(attachment.size)}</small></span>
                </button>
              ) : (
                <button
                  key={attachment.id}
                  type="button"
                  className="artifact artifact--sm"
                  title="点击放大查看"
                  onClick={() => onPreviewImage({ url: assetUrl(attachment.path) ?? attachment.dataUrl ?? '', name: attachment.name, path: attachment.path })}
                >
                  <img src={assetUrl(attachment.path) ?? attachment.dataUrl} alt={attachment.name} />
                </button>
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
  const activity = botActivities[bot.id];
  const current = isLatest && activity?.messageId === message.id;
  const kind: BotActivityKind = message.streaming ? current && activity.kind !== 'idle' ? activity.kind : inferMessageActivity(message) : message.error ? 'error' : message.stopped ? (current && activity.kind === 'stopped' ? 'stopped' : 'idle') : current && activity.kind === 'done' ? 'done' : 'idle';
  // While the model is producing text, show the "thinking" animation (its pondering
  // motion) rather than the hand-writing one; tool-running states keep their motion.
  const avatarKind: BotActivityKind = message.streaming && kind === 'writing' ? 'thinking' : kind;
  const animate = !!message.streaming || !!(current && ['done', 'error', 'stopped'].includes(activity.kind));
  const content = message.error && message.content === `（没有回复：${message.error}）` ? '' : message.content;
  const turns = useMemo(() => replyTurns({ ...message, content }), [message.content, message.modelTurns, content]);
  const turnHtml = useMemo(() => turns.map((turn) => (turn.content ? renderMarkdown(turn.content) : '')), [turns]);
  const long = content.length > 1600;

  return (
    <div className="msg msg--assistant reply-flow" data-message-id={message.id} tabIndex={-1} onContextMenu={handleContextMenu}>
      <div className="msg__stack">
      <div className="msg__body" ref={ref}>
        <div className="reply-author">
          <BotAvatar bot={bot} activity="idle" animated={!!message.streaming || kind === 'stopped' || kind === 'done'} />
          <strong>{message.botName ?? bot.name}</strong>
        </div>
        <div className={`reply-turns ${long && !expanded ? 'is-clamped' : ''}`}>
        {turns.map((turn, index) => <div className="reply-turn" key={index}>
          {turn.reasoning ? <details className="reasoning reply-reasoning"><summary><Icon name="spark" size={14} /><span>思考过程</span><Icon name="chevron" size={13} /></summary><p>{turn.reasoning}</p></details> : null}
          {turn.content ? <div className="prose" data-message-content={message.id} onClick={openLinksExternally} dangerouslySetInnerHTML={{ __html: turnHtml[index] ?? '' }} /> : null}
          {turn.toolCalls?.map((call) => <ReplyToolCard key={call.id} call={call} result={results.get(call.id)} message={message} />)}
        </div>)}
        </div>
        {long ? <button type="button" className="reply-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开全文'}</button> : null}

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
                    onClick={() => onPreviewImage({ url: url ?? '', name: attachment.name, path: attachment.path })}
                    title="点击放大查看"
                  >
                    <img src={url} alt={attachment.name} />
                    <span className="artifact__hint">点击放大</span>
                  </button>
                );
              })}
          </div>
        ) : null}

        {message.error ? <div className="reply-error" role="alert"><strong>暂时无法回复</strong><p className="msg__error">{message.error}</p>{/API\s*Key|密钥|供应商/i.test(message.error) ? <button type="button" onClick={() => setView('settings')}>配置供应商</button> : null}</div> : null}
        {message.streaming || kind === 'done' || kind === 'stopped' ? <div className={`reply-status reply-flow__status ${message.streaming ? 'is-live' : ''}`} data-activity={kind} role="status" aria-live="polite"><BotAvatar bot={bot} activity={avatarKind} animated={animate || kind === 'stopped' || kind === 'done'} /><span>{BOT_ACTIVITY[kind].label}</span>{message.streaming ? <span className="reply-status__pulse" aria-hidden="true"><i /><i /><i /></span> : null}</div> : null}
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
});

const humanSize = (bytes?: number) => !bytes ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Codex 式提问卡：贴在输入框上方，非全屏遮罩；只处理当前会话的提问（其他会话走 App 的全局兜底）。 */
function QuestionCard() {
  const { question, answerQuestion } = useMoyu();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setDraft(''); if (question) window.setTimeout(() => inputRef.current?.focus(), 60); }, [question?.id]);
  if (!question) return null;
  const skip = () => void answerQuestion({ requestId: question.id, answer: '' });
  const send = () => { if (draft.trim()) void answerQuestion({ requestId: question.id, answer: draft }); };
  return (
    <div className="question-card" role="region" aria-label="Bot 需要你的回答">
      <div className="question-card__head">
        <div><strong>Bot 需要你的回答</strong><small>它查不到，或需要你拍板</small></div>
        <IconButton name="close" label="跳过并关闭" onClick={skip} />
      </div>
      <p className="question-card__question">{question.question}</p>
      <textarea
        ref={inputRef}
        className="question__input"
        value={draft}
        rows={3}
        placeholder="输入你的回答；留空发送 = 跳过"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
          if (event.key === 'Escape') { event.preventDefault(); skip(); }
        }}
      />
      <div className="question-card__foot">
        <span className="question-card__hint">Ctrl + Enter 发送 · Esc 跳过</span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={skip}>跳过</Button>
        <Button size="sm" variant="primary" icon="send" disabled={!draft.trim()} onClick={send}>发送回答</Button>
      </div>
    </div>
  );
}

function Composer({ bot, home, replyTo, onClearReply, topSlot }: { bot: Bot; home: boolean; replyTo?: Message['replyTo']; onClearReply: () => void; topSlot?: React.ReactNode }) {
  const { running, sendMessage, stop, saveBot, settings, compacting, conversation, setConversationMode, setConversationAutonomy, toast } = useMoyu();
  const group = conversation?.group;
  const recipient = group ? conversation.title : bot.name;
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ name?: string; mimeType: string; dataUrl: string; size?: number }[]>([]);
  const dropDepth = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  const readFilesRef = useRef<(files: FileList | File[]) => void>(() => {});
  const [savingOptions, setSavingOptions] = useState(false);
  const [editMenu, setEditMenu] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pastedRef = useRef(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const provider = settings.providers.find((item) => item.id === bot.providerId);

  useEffect(() => { if (replyTo) textarea.current?.focus(); }, [replyTo]);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    // 长文本：输入框长到能放下全文（上限为视口高度 80%，接近"完全展开"），而不是固定高度只看到中间一段。
    // 超过上限才滚动；刚粘贴、光标在末尾、未聚焦（恢复长草稿）时贴底显示最新内容；
    // 只有"聚焦且编辑中部"才按比例保持视口位置。
    const cap = Math.max(220, Math.round(window.innerHeight * 0.8));
    const beforeFull = node.scrollHeight;
    const beforeTop = node.scrollTop;
    const caret = node.selectionStart ?? node.value.length;
    const pinBottom = pastedRef.current || caret >= node.value.length || document.activeElement !== node;
    pastedRef.current = false;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, cap)}px`;
    if (pinBottom) {
      node.scrollTop = node.scrollHeight;
    } else if (beforeFull > node.clientHeight) {
      const fraction = beforeTop / Math.max(1, beforeFull - node.clientHeight);
      node.scrollTop = Math.round(fraction * Math.max(0, node.scrollHeight - node.clientHeight));
    }
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

  const readFiles = (files: FileList | File[]) => {
    void (async () => {
      const accepted: typeof attachments = [];
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith('image/');
        if (isImage && file.size > 8 * 1024 * 1024) { toast(`图片超过 8MB，已跳过：${file.name}`, 'error'); continue; }
        if (!isImage && file.size > 20 * 1024 * 1024) { toast(`文件超过 20MB，已跳过：${file.name}`, 'error'); continue; }
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          accepted.push({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl, size: file.size });
        } catch { toast(`读取失败：${file.name}`, 'error'); }
      }
      if (accepted.length) setAttachments((prev) => [...prev, ...accepted].slice(0, 8));
    })();
  };
  readFilesRef.current = readFiles;

  useEffect(() => {
    // 全屏拖入层：窗口任意位置拖文件都会出现，drop 在任何地方都被接住（不只输入框）。
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); dropDepth.current++; setDropActive(true); };
    const onOver = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); };
    const onLeave = (event: DragEvent) => { if (!hasFiles(event)) return; dropDepth.current = Math.max(0, dropDepth.current - 1); if (!dropDepth.current) setDropActive(false); };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dropDepth.current = 0;
      setDropActive(false);
      if (event.dataTransfer?.files.length) readFilesRef.current(event.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const submit = async () => {
    if (running || (!text.trim() && attachments.length === 0)) return;
    const payload = text;
    const payloadAttachments = attachments;
    setText('');
    setAttachments([]);
    const sent = await sendMessage(payload, payloadAttachments, replyTo);
    if (sent) onClearReply();
    else { setText(payload); setAttachments(payloadAttachments); }
    textarea.current?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={`composer-wrap ${!home ? 'composer-wrap--floating' : ''}`.trim()}
    >
      {dropActive ? createPortal(
        <div className="drop-overlay" role="region" aria-label="拖入文件添加">
          <div className="drop-overlay__box">
            <Icon name="plus" size={44} />
            <strong>拖入图片或文件到此处添加</strong>
            <small>支持多个图片和文件 · 图片 ≤ 8MB · 文件 ≤ 20MB</small>
          </div>
        </div>,
        document.body,
      ) : null}
      {replyTo ? <div className="composer-reply" role="region" aria-label="正在引用的消息"><ReplyPreview reply={replyTo} onClick={() => jumpToMessage(replyTo.messageId, settings.ui.reduceMotion)} /><button type="button" className="composer-reply__dismiss" aria-label="取消引用" title="取消引用" onClick={() => { onClearReply(); textarea.current?.focus(); }}><Icon name="close" size={14} /></button></div> : null}
      {topSlot}
      <div className={`composer glass composer--compact ${attachments.length ? 'has-attachments' : ''}`.trim()}>
        {attachments.length ? (
          <div className="attachment-row">
            {attachments.map((item, index) => item.mimeType.startsWith('image/') ? (
              <div className="attachment-chip" key={`${item.name}-${index}`}>
                <img src={item.dataUrl} alt={item.name ?? '图片'} />
                <button type="button" aria-label="移除" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ) : (
              <div className="attachment-chip attachment-chip--file" key={`${item.name}-${index}`}>
                <Icon name="folder" size={16} />
                <span className="attachment-chip__meta"><strong>{item.name}</strong><small>{humanSize(item.size)}</small></span>
                <button type="button" aria-label="移除" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer__leading">
          <IconButton name="plus" label="添加图片或文件" className="composer__attach" onClick={() => fileInput.current?.click()} />
          {!group ? <Select label="执行权限" className={`composer-policy-picker composer-policy-picker--${bot.approvalPolicy}`} icon={bot.approvalPolicy === 'ask' ? 'shield' : 'spark'} iconOnly menuMinWidth={230} value={bot.approvalPolicy} disabled={savingOptions} onChange={(value) => void updateOptions({ approvalPolicy: value as Bot['approvalPolicy'] })} options={[
            { value: 'never', label: '自动执行', hint: '工具直接执行，不逐步确认' },
            { value: 'ask', label: '每次确认', hint: '执行命令和写入文件前确认' },
          ]} /> : null}
          {!group ? <Select label="会话模式" className={`composer-policy-picker composer-mode-picker--${conversation?.mode ?? 'execute'}`} icon={conversation?.mode === 'plan' ? 'shield' : 'sliders'} iconOnly menuMinWidth={250} value={conversation?.mode ?? 'execute'} onChange={(value) => void setConversationMode(value as 'execute' | 'plan')} options={[
            { value: 'execute', label: '执行模式', hint: '正常干活，按上面的执行权限逐步确认' },
            { value: 'plan', label: '计划模式', hint: '只读核查，先把计划交给你批准再动手' },
          ]} /> : null}
          {!group ? <Select label="续航" className={`composer-policy-picker composer-autonomy-picker--${conversation?.autonomy ?? 'turn'}`} icon={conversation?.autonomy === 'until_done' ? 'spark' : 'clock'} iconOnly menuMinWidth={250} value={conversation?.autonomy ?? 'turn'} disabled={conversation?.mode === 'plan'} onChange={(value) => void setConversationAutonomy(value as 'turn' | 'until_done')} options={[
            { value: 'turn', label: '单轮', hint: '目标只在当前轮内自动多步' },
            { value: 'until_done', label: '自动跑到底', hint: '新目标自动跨轮续航，直到完成或触顶（建议配「自动执行」）' },
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
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              setEditMenu({ x: event.clientX, y: event.clientY });
            }
          }}
          onPaste={(event) => {
            const files = event.clipboardData.files;
            if (files.length) {
              event.preventDefault();
              void readFiles(files);
              pastedRef.current = false;
            } else {
              pastedRef.current = true;
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
            {group ? <span className="group-composer-hint" title={`${group.memberBotIds.length} 个 Bot · 依次回复`} aria-label={`${group.memberBotIds.length} 个 Bot · 依次回复`}><Icon name="users" size={14} /><span>{group.memberBotIds.length} 个 Bot · 依次回复</span></span> : <><Select label="模型" className="composer-model-picker" menuMinWidth={210} align="end" value={bot.model} disabled={savingOptions} onChange={(value) => void updateOptions({ model: value })} options={[...new Set([bot.model, ...(provider?.models ?? [])])].filter(Boolean).map((model) => { const name = provider?.modelCatalog?.[model]?.name; return { value: model, label: name ?? model, hint: name && name !== model ? model : undefined }; })} /><EffortPicker bot={bot} disabled={savingOptions} /></>}
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
                disabled={!text.trim() && attachments.length === 0}
                onClick={() => void submit()}
              >
                <Icon name="arrowUp" size={19} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
      {conversation ? <ContextMeter bot={bot} conversation={conversation} /> : null}
      {home ? <div className="starter-actions" aria-label="灵感建议">
        {(bot.workspaceId === 'workspace_local' ? LOCAL_SUGGESTIONS : SUGGESTIONS).map((item) => <button type="button" key={item.title} onClick={() => { setText(bot.workspaceId === 'workspace_local' ? item.text : item.text.replaceAll('/data/moyubot', settings.cloud.remoteWorkspaceDir ?? '/data/moyubot')); textarea.current?.focus(); }}>
          <Icon name={item.icon} size={16} /><span>{item.title}</span>
        </button>)}
      </div> : null}
      {home ? <p className="composer-hint">Enter 发送 · Shift + Enter 换行 · 支持粘贴或拖入图片与文件</p> : null}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void readFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {editMenu ? <TextEditContextMenu x={editMenu.x} y={editMenu.y} onClose={() => setEditMenu(null)} targetRef={textarea} /> : null}
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

/** 头部小胶囊：hover/点击展开浮层查看完整内容，移开 160ms 或 Esc 关闭。 */
function HeaderPill({ icon, label, popover, align = 'left', tone }: { icon: React.ReactNode; label: React.ReactNode; popover: React.ReactNode; align?: 'left' | 'right'; tone?: 'resume' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (leaveTimer.current) window.clearTimeout(leaveTimer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div
      className={`head-pill ${tone === 'resume' ? 'head-pill--resume' : ''}`}
      ref={ref}
      onMouseEnter={() => { if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = undefined; } setOpen(true); }}
      onMouseLeave={() => { leaveTimer.current = window.setTimeout(() => setOpen(false), 160); }}
    >
      <button type="button" className={`head-pill__chip ${open ? 'is-open' : ''}`} aria-expanded={open} onClick={() => setOpen(true)}>{icon}{label}</button>
      {open ? <div className="head-pill__pop" data-align={align}>{popover}</div> : null}
    </div>
  );
}

export function ChatView({ inspectorOpen, onToggleInspector }: { inspectorOpen: boolean; onToggleInspector: () => void }) {
  const { bot, conversation, settings, setView, activeWorkspace, goal, todos, resumableGoal, resumeGoal, sendMessage, completeGoal, toast, question } = useMoyu();
  const [reply, setReply] = useState<{ conversationId: string; quote: NonNullable<Message['replyTo']> }>();
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const [msgMenu, setMsgMenu] = useState<MessageSelectionMenuState | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, closePreview]);
  useEffect(() => setReply(undefined), [conversation?.id]);
  const members = conversation?.group?.memberBotIds.map((id) => settings.bots.find((item) => item.id === id)).filter((item): item is Bot => !!item) ?? [];
  const messages = conversation?.messages ?? [];
  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const scrollRef = useAutoScroll<HTMLDivElement>(conversation?.id);
  const handleReply = useCallback((quote: NonNullable<Message['replyTo']>) => setReply({ conversationId: conversation?.id ?? '', quote }), [conversation?.id]);

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
          {todos?.items.some((item) => !item.done) ? (
            <HeaderPill
              icon={<Icon name="check" size={13} />}
              label={<span className="head-pill__count">{todos.items.filter((item) => item.done).length}/{todos.items.length}</span>}
              popover={
                <div className="head-pill__todos">
                  <p className="head-pill__caption">任务清单</p>
                  {todos.items.map((item, index) => (
                    <div className="head-pill__row" key={index}>
                      <span className={`head-pill__tick ${item.done ? 'is-done' : ''}`}>{item.done ? '✓' : ''}</span>
                      <span className={item.done ? 'is-done' : ''}>{item.content}</span>
                    </div>
                  ))}
                </div>
              }
            />
          ) : null}
          <button type="button" className={`chat__who ${inspectorOpen ? 'is-active' : ''}`} aria-label={conversation.group ? '群聊成员与详情' : '对话详情与记忆'} aria-expanded={inspectorOpen} title={conversation.group ? conversation.title : `${bot.name} · 对话详情与记忆`} onClick={onToggleInspector}>
            {conversation.group ? <span className="group-chat-icon"><Icon name="users" size={21} /></span> : <BotAvatar bot={bot} size="lg" activity="idle" />}
            <span className="chat__name">{conversation.group ? conversation.title : bot.name}</span>
          </button>
          {goal || resumableGoal ? (
            <HeaderPill
              align="right"
              tone={resumableGoal ? 'resume' : undefined}
              icon={<Icon name="spark" size={13} />}
              label={
                <span className="head-pill__count">
                  {goal ? <>目标{goal.criteria?.length ? ` ✓ ${goal.criteria.filter((item) => item.done).length}/${goal.criteria.length}` : ''}{goal.autonomy === 'until_done' ? ` ⟳ ${goal.roundsUsed ?? 0}/${goal.maxRounds ?? 8}` : ''}</> : '续航暂停'}
                </span>
              }
              popover={
                <div className="head-pill__goal">
                  <p className="head-pill__caption">当前目标</p>
                  <p className="head-pill__objective">{(goal ?? resumableGoal)?.objective}</p>
                  {goal?.criteria?.length ? (
                    <div className="head-pill__criteria">
                      {goal.criteria.map((item, index) => (
                        <div className="head-pill__row" key={index}>
                          <span className={`head-pill__tick ${item.done ? 'is-done' : ''}`}>{item.done ? '✓' : ''}</span>
                          <span className={item.done ? 'is-done' : ''}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {goal?.autonomy === 'until_done' ? <p className="head-pill__rounds">续航模式 ⟳ {goal.roundsUsed ?? 0}/{goal.maxRounds ?? 8} 轮</p> : null}
                  {resumableGoal
                    ? <Button size="sm" icon="send" onClick={async () => { if (await resumeGoal(5)) void sendMessage('（人工续跑）继续推进之前未完成的目标', [], undefined); }}>续跑 5 轮</Button>
                    : <Button size="sm" icon="check" onClick={() => void completeGoal()}>标记目标完成</Button>}
                </div>
              }
            />
          ) : null}
        </h2>
      </header>

      <div className="chat__stage">
      <div className="messages" ref={scrollRef}>
        <div className="messages__inner">
          {messages.length === 0 ? conversation.group ? <div className="empty group-welcome"><div className="group-welcome__avatars">{members.slice(0, 5).map((member) => <BotAvatar key={member.id} bot={member} size="xl" />)}</div><span className="welcome-eyebrow">一起聊，让想法碰撞</span><h1>{conversation.title}</h1><p className="empty__sub">{members.map((member) => member.name).join('、')} 已加入，发条消息开始吧。</p></div> : <EmptyState bot={bot} /> : messages.map((message) => <MessageBubble key={message.id} message={message} bot={settings.bots.find((item) => item.id === message.botId) ?? bot} isLatest={message.id === latestAssistantId} onReply={handleReply} onPreviewImage={setPreview} onMsgMenu={setMsgMenu} />)}
        </div>
      </div>

      <Composer key={conversation.id} bot={bot} home={messages.length === 0} replyTo={reply?.conversationId === conversation.id ? reply.quote : undefined} onClearReply={() => setReply(undefined)} topSlot={question?.conversationId === conversation.id ? <QuestionCard /> : null} />
      </div>
      {messages.length === 0 ? <div className="home-footnote"><Icon name={activeWorkspace?.kind === 'local' ? 'terminal' : 'cloud'} size={14} /><span>{activeWorkspace?.kind === 'local' ? '所有 Bot 共用本机 Windows 工作区' : '工作区内的 Bot 共用一台云电脑'}</span><span className="home-footnote__dot">·</span><span>{activeWorkspace?.kind === 'local' ? '文件与命令在本地完成' : '需要时唤醒，空闲时休眠'}</span></div> : null}

      {msgMenu ? <MessageContextMenu x={msgMenu.x} y={msgMenu.y} text={msgMenu.text} onClose={() => setMsgMenu(null)} /> : null}

      {preview ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={closePreview}>
          <div className="lightbox__stage" onClick={(event) => event.stopPropagation()}>
            <img src={preview.url} alt={preview.name ?? '图片'} />
            <div className="lightbox__bar">
              {preview.name ? <span className="lightbox__name">{preview.name}</span> : null}
              {preview.path ? <Button size="sm" icon="arrowUp" onClick={() => void moyu().openArtifact(preview.path!).catch((error: Error) => toast(error.message, 'error'))}>打开原图</Button> : null}
            </div>
          </div>
          <button type="button" className="lightbox__close" aria-label="关闭预览" onClick={closePreview}><Icon name="close" size={20} /></button>
        </div>
      ) : null}
    </section>
  );
}
