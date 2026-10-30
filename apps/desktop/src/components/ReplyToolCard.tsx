import { useEffect, useId, useState } from 'react';
import type { Message, ToolCall, ToolResult } from '@moyu/core';
import { useMoyu } from '../state';
import { Icon, type IconName } from './Icon';

const TOOLS: Record<string, { label: string; icon: IconName }> = {
  cloud_exec: { label: '运行命令', icon: 'terminal' },
  cloud_read: { label: '读取文件', icon: 'folder' },
  cloud_write: { label: '写入文件', icon: 'edit' },
  web_fetch: { label: '查找资料', icon: 'globe' },
  generate_image: { label: '生成图片', icon: 'image' },
  remember: { label: '记录记忆', icon: 'memory' },
  recall: { label: '查找记忆', icon: 'memory' },
  schedule_task: { label: '安排任务', icon: 'clock' },
  list_tasks: { label: '查询任务', icon: 'clock' },
  update_task: { label: '管理任务', icon: 'clock' },
};

export function ReplyToolCard({ call, result, message }: { call: ToolCall; result?: ToolResult; message: Pick<Message, 'streaming' | 'stopped'> }) {
  const { toast } = useMoyu();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const running = !result && !!message.streaming;
  const open = expanded;
  const tool = TOOLS[call.name] ?? { label: call.name, icon: 'plug' as const };
  const command = call.name === 'cloud_exec' ? String(call.arguments.cmd ?? '') : '';
  const input = command || JSON.stringify(call.arguments, null, 2);
  const output = result?.detail || result?.summary;
  const status = result ? result.ok ? '已完成' : '执行失败' : message.stopped ? '已停止' : running ? '执行中' : '未完成';
  const summary = call.arguments.path ?? call.arguments.url ?? call.arguments.title ?? (command ? command.split('\n')[0] : result?.summary);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(input); setCopied(true); }
    catch { toast('复制失败，请重试', 'error'); }
  };

  return <section className={`reply-tool ${running ? 'is-running' : ''} ${result?.ok === false ? 'is-error' : ''}`} aria-label={`${tool.label} · ${status}`}>
    <button type="button" className="reply-tool__head" aria-expanded={open} aria-controls={bodyId} onClick={() => setExpanded(!open)}>
      <Icon name={tool.icon} size={15} />
      <span className="reply-tool__label">{tool.label}</span>
      <span className="reply-tool__summary">{summary ? String(summary) : call.name}</span>
      <span className="reply-tool__status">{status}</span>
      <Icon name="chevron" size={14} className={open ? 'is-open' : ''} />
    </button>
    {open ? <div className="reply-tool__body" id={bodyId}>
      <div className="reply-tool__input">
        <span className="reply-tool__dot" data-state={result ? result.ok ? 'done' : 'error' : running ? 'running' : 'stopped'} aria-hidden="true" />
        <pre><code>{command ? `$ ${command}` : input}</code></pre>
        <button type="button" className="reply-tool__copy" aria-label={copied ? '已复制命令或参数' : '复制命令或参数'} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={13} /><span>{copied ? '已复制' : '复制'}</span></button>
      </div>
      {output ? <pre className="reply-tool__output" aria-label="执行结果">{output}</pre> : null}
    </div> : null}
  </section>;
}
