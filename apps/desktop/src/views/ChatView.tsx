import { useEffect, useRef, useState } from 'react';
import type { Bot, Message, ToolResult } from '@mesh/core';
import { assetUrl, mesh } from '../lib/bridge';
import { formatClock } from '../lib/format';
import { highlightCode, openLinksExternally, renderMarkdown } from '../lib/markdown';
import { useMesh } from '../state';
import { BotAvatar } from '../components/BotAvatar';
import { Icon } from '../components/Icon';
import { Button, IconButton, Spinner, useAutoScroll } from '../components/Glass';
import type { IconName } from '../components/Icon';

const TOOL_ICON: Record<string, IconName> = {
  cloud_exec: 'terminal',
  cloud_read: 'folder',
  cloud_write: 'folder',
  generate_image: 'image',
  remember: 'memory',
  recall: 'memory',
  web_fetch: 'globe',
  schedule_task: 'clock',
};

const SUGGESTIONS = [
  { icon: 'image' as IconName, title: '画一张液态玻璃风格的海报', text: '用 16:9 画一张「iOS 液态玻璃」风格的产品海报，主题是多人共用的云电脑，画面要通透、有折射光。' },
  { icon: 'terminal' as IconName, title: '在云电脑上体检环境', text: '唤醒云电脑，检查 Python 版本、磁盘空间和已安装的浏览器，然后用一段话总结。' },
  { icon: 'folder' as IconName, title: '整理一份工作台报告', text: '在云电脑 /data/meshbot 下建一个 weekly 目录，写一份本周工作摘要模板并读回来确认。' },
  { icon: 'clock' as IconName, title: '每个工作日 9 点汇报', text: '创建一个定时任务：每个工作日 9 点唤醒云电脑，检查 /data/meshbot 下最新文件并汇报。' },
];

function MessageBubble({ message }: { message: Message }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (message.role === 'assistant' && ref.current && message.content) highlightCode(ref.current);
  }, [message.content, message.role]);

  if (message.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="bubble bubble--user">
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
          {message.content ? <p className="bubble__text">{message.content}</p> : null}
          <span className="msg__meta">{formatClock(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  const results = new Map<string, ToolResult>((message.toolResults ?? []).map((result) => [result.id, result]));
  const calls = message.toolCalls ?? [];

  return (
    <div className="msg msg--assistant">
      <div className="msg__avatar">
        <Icon name="spark" size={16} />
      </div>
      <div className="msg__body" ref={ref}>
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
                <div key={call.id} className={`tool-card ${result?.ok === false ? 'is-error' : ''} ${!result ? 'is-running' : ''}`.trim()}>
                  <button type="button" className="tool-card__head" onClick={() => setExpanded((prev) => ({ ...prev, [call.id]: !open }))}>
                    <span className="tool-card__icon">
                      <Icon name={TOOL_ICON[call.name] ?? 'spark'} size={16} />
                    </span>
                    <span className="tool-card__name">{call.name}</span>
                    <span className="tool-card__summary">
                      {result ? result.summary : call.name === 'cloud_exec' ? String(call.arguments.cmd ?? '').slice(0, 60) : '执行中…'}
                    </span>
                    {!result ? <Spinner size={14} /> : <Icon name="chevron" size={15} className={`tool-card__chevron ${open ? 'is-open' : ''}`} />}
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
                    onClick={() => (attachment.path ? void mesh().openArtifact(attachment.path) : undefined)}
                    title="点击用系统查看器打开"
                  >
                    <img src={url} alt={attachment.name} />
                    <span className="artifact__hint">打开原图</span>
                  </button>
                );
              })}
          </div>
        ) : null}

        {message.content ? (
          <div className="prose" onClick={openLinksExternally} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
        ) : message.streaming ? (
          <div className="thinking">
            <span className="thinking__dot" />
            <span className="thinking__dot" />
            <span className="thinking__dot" />
          </div>
        ) : null}

        {message.error ? <p className="msg__error">{message.error}</p> : null}
        {message.streaming ? <span className="stream-caret" /> : null}
        {!message.streaming && message.usage ? (
          <span className="msg__usage">
            {message.usage.promptTokens ? `${message.usage.promptTokens} in` : ''}
            {message.usage.completionTokens ? ` · ${message.usage.completionTokens} out` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Composer({ bot }: { bot: Bot }) {
  const { conversation, running, sendMessage, stop, saveBot, settings, newConversation } = useMesh();
  const [text, setText] = useState('');
  const [images, setImages] = useState<{ name?: string; mimeType: string; dataUrl: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const provider = settings.providers.find((item) => item.id === bot.providerId);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [text]);

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
    if (running) return;
    const payload = text;
    const payloadImages = images;
    setText('');
    setImages([]);
    await sendMessage(payload, payloadImages);
    textarea.current?.focus();
  };

  return (
    <div
      className={`composer-wrap ${dragOver ? 'is-dragover' : ''}`.trim()}
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
      <div className="composer glass">
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
        <textarea
          ref={textarea}
          className="composer__input"
          value={text}
          rows={1}
          placeholder={`给 ${bot.name} 发消息，需要时会唤醒共享云电脑…`}
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
          <div className="composer__tools">
            <IconButton name="image" label="添加图片" onClick={() => fileInput.current?.click()} />
            <button type="button" className="model-chip" title="切换模型" onClick={() => textarea.current?.focus()}>
              <span className="model-chip__dot" />
              <select
                value={bot.model}
                onChange={(event) => void saveBot({ ...bot, model: event.target.value })}
                aria-label="模型"
              >
                {[...new Set([bot.model, ...(provider?.models ?? [])])].filter(Boolean).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={13} />
            </button>
            <span className={`policy-chip policy-chip--${bot.approvalPolicy}`}>
              <Icon name="shield" size={13} />
              {bot.approvalPolicy === 'ask' ? '每次确认' : bot.approvalPolicy === 'always' ? '全部允许' : '自动执行'}
            </span>
          </div>
          <div className="composer__actions">
            <IconButton name="plus" label="新对话" onClick={() => void newConversation()} />
            {running ? (
              <Button variant="danger" size="sm" icon="stop" onClick={stop}>
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
      <p className="composer-hint">
        云电脑空闲 {settings.cloud.idleSuspendMinutes} 分钟后自动休眠 · 绘图与任务会按需唤醒
        {conversation ? ` · 会话 ${conversation.id.slice(-6)}` : ''}
      </p>
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
  const { sendMessage, setView } = useMesh();
  return (
    <div className="empty">
      <div className="hero-orb" aria-hidden="true">
        <span className="hero-orb__glass" />
        <span className="hero-orb__ring" />
      </div>
      <h1>
        你好，我是 <span className="gradient-text">{bot.name}</span>
      </h1>
      <p className="empty__sub">
        我跑在 MeshBot 上，和其他 Bot 共用一台随时休眠的云电脑。
        <br />
        对话不烧钱，只有真正要去云端跑任务或画图时才唤醒。
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((item) => (
          <button
            key={item.title}
            type="button"
            className="suggestion glass-inset"
            onClick={() => void sendMessage(item.text, [])}
          >
            <span className="suggestion__icon">
              <Icon name={item.icon} size={17} />
            </span>
            <span className="suggestion__text">
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </span>
          </button>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={() => setView('cloud')}>
        看看共享云电脑的状态 →
      </button>
    </div>
  );
}

export function ChatView() {
  const { bot, conversation, running, newConversation, setView } = useMesh();
  const messages = conversation?.messages ?? [];
  const scrollRef = useAutoScroll<HTMLDivElement>([messages.length, messages.at(-1)?.content, messages.at(-1)?.toolResults?.length]);

  if (!bot) {
    return (
      <div className="view view--empty">
        <p>还没有 Bot。先去创建一个，接上任意供应商的 API。</p>
        <Button variant="primary" icon="plus" onClick={() => setView('bots')}>
          创建 Bot
        </Button>
      </div>
    );
  }

  return (
    <section className="chat">
      <header className="chat__head">
        <div className="chat__who">
          <BotAvatar bot={bot} size="lg" />
          <div>
            <h2>{bot.name}</h2>
            <p>
              {bot.model || '未选模型'} · {bot.approvalPolicy === 'ask' ? '执行前确认' : bot.approvalPolicy === 'always' ? '全部允许' : '自动执行'}
              {running ? ' · 正在生成' : ''}
            </p>
          </div>
        </div>
        <div className="chat__actions">
          <Button variant="ghost" size="sm" icon="plus" onClick={() => void newConversation()}>
            新对话
          </Button>
          <IconButton name="cloud" label="云电脑" onClick={() => setView('cloud')} />
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        <div className="messages__inner">
          {messages.length === 0 ? <EmptyState bot={bot} /> : messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        </div>
      </div>

      <Composer bot={bot} />
    </section>
  );
}