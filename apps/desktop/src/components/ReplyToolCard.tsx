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
  spawn_agent: { label: '子智能体', icon: 'users' },
  run_script: { label: '工作流', icon: 'grid' },
};

export function ReplyToolCard({ call, result, message }: { call: ToolCall; result?: ToolResult; message: Pick<Message, 'streaming' | 'stopped'> }) {
  const { toast, subagents } = useMoyu();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const running = !result && !!message.streaming;
  const open = expanded;
  const tool = TOOLS[call.name] ?? { label: call.name, icon: 'plug' as const };
  const command = call.name === 'cloud_exec' ? String(call.arguments.cmd ?? '') : '';
  // 子任务清单从调用参数就能还原，运行中即可展示「几个在飞」，不需要额外的事件通道。
  const subagentTasks = call.name === 'spawn_agent'
    ? [typeof call.arguments.task === 'string' ? call.arguments.task : '',
       ...(Array.isArray(call.arguments.tasks) ? call.arguments.tasks.filter((item): item is string => typeof item === 'string') : [])]
      .filter((text) => text.trim())
    : [];
  const input = command || (subagentTasks.length ? subagentTasks.map((text, index) => `${index + 1}. ${text}`).join('\n') : call.name === 'run_script' ? String(call.arguments.script ?? '') : JSON.stringify(call.arguments, null, 2));
  const output = result?.detail || result?.summary;
  const status = result ? result.ok ? '已完成' : '执行失败' : message.stopped ? '已停止' : running ? '执行中' : '未完成';
  const scriptLine = call.name === 'run_script' ? (String(call.arguments.script ?? '').trim().split('\n').find((line) => line.trim()) ?? '') : '';
  // 逐项进度：优先用事件推来的实时状态；刷新页面后事件没了，就从参数 + 结果退化还原。
  const progress = subagents[call.id];
  const rows = progress && Object.keys(progress.children).length
    ? Object.entries(progress.children).map(([index, child]) => ({ index: Number(index), task: child.task, state: child.state })).sort((left, right) => left.index - right.index)
    : subagentTasks.map((task, index) => ({ index, task, state: (result ? (result.ok ? 'done' : 'error') : running ? 'running' : 'error') as 'running' | 'done' | 'error' }));
  const summary = rows.length
    ? `${rows.filter((row) => row.state === 'done').length}/${rows.length} 完成 · ${rows[0]!.task.slice(0, 36)}`
    : scriptLine
      ? scriptLine.slice(0, 60)
      : call.arguments.path ?? call.arguments.url ?? call.arguments.title ?? (command ? command.split('\n')[0] : result?.summary);

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
      {rows.length ? <div className="reply-tool__children" aria-label="子任务进度">
        {rows.map((row) => <div className="reply-tool__child" key={row.index}>
          <span className="reply-tool__dot" data-state={row.state} aria-hidden="true" />
          <span className="reply-tool__child-task" title={row.task}>{row.task}</span>
          <span className="reply-tool__child-state">{row.state === 'running' ? '进行中' : row.state === 'done' ? '完成' : '失败'}</span>
        </div>)}
      </div> : null}
      {output ? <pre className="reply-tool__output" aria-label="执行结果">{output}</pre> : null}
    </div> : null}
  </section>;
}
