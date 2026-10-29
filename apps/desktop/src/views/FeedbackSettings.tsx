import { useEffect, useMemo, useState } from 'react';
import type { DiagnosticEntry } from '@moyu/core';
import { Button, IconButton } from '../components/Glass';
import { Icon } from '../components/Icon';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';

const ISSUE_URL = 'https://github.com/whitemoono/moyubot/issues/new';
const TELEGRAM = 'https://t.me/moyubotnya';
const QQ_GROUP = '2162036353';

export function FeedbackSettings() {
  const { version, platform, activeWorkspace, bot, toast } = useMoyu();
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [includeErrors, setIncludeErrors] = useState(false);
  const [includeCommands, setIncludeCommands] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [edited, setEdited] = useState<string>();
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState('');

  const refresh = async () => {
    setLoading(true); setLoadError('');
    try { const next = await moyu().feedbackDiagnostics(); setEntries(next); setSelected(new Set(next.slice(0, 5).map((entry) => entry.id))); }
    catch { setLoadError('暂时无法读取报错记录，请重试。'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const generated = useMemo(() => {
    const lines = [
      `## ${title.trim() || '问题反馈 / 功能建议'}`, '',
      description.trim() || '请描述遇到的问题、复现步骤，以及你期望的结果。', '',
      '### 运行环境', `- MoyuBot：v${version}`, `- 系统：${({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as Record<string, string>)[platform] ?? platform}`,
      `- 工作区：${activeWorkspace?.kind === 'local' ? '本地' : '云电脑'}`,
      ...(bot?.model ? [`- 模型：${bot.model}`] : []),
    ];
    if (includeErrors) {
      const chosen = entries.filter((entry) => selected.has(entry.id));
      lines.push('', '### 报错记录（自动脱敏，请人工检查）');
      if (!chosen.length) lines.push('未选择报错记录。');
      for (const entry of chosen) {
        lines.push('', `[${new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false })}] ${entry.source}`, entry.message);
        if (entry.detail) lines.push(entry.detail);
        if (includeCommands && entry.command) lines.push(`失败命令：\n${entry.command}`);
      }
    }
    return lines.join('\n');
  }, [title, description, version, platform, activeWorkspace?.kind, bot?.model, includeErrors, includeCommands, entries, selected]);

  useEffect(() => { setEdited(undefined); setCopied(false); }, [generated]);
  const report = edited ?? generated;
  const selectedCount = entries.filter((entry) => selected.has(entry.id)).length;
  const open = (url: string) => void moyu().openExternal(url).catch(() => toast('无法打开链接，请重试', 'error'));
  const copy = async (text: string, message: string) => {
    try { await moyu().copyFeedback(text); toast(message); return true; }
    catch { toast('复制失败，请重试', 'error'); return false; }
  };
  const copyReport = async () => { if (await copy(report, '反馈已复制，可以粘贴到群组或 Issue')) setCopied(true); };
  const issue = async () => {
    if (sending) return;
    setSending(true);
    try {
      await moyu().copyFeedback(report);
      const url = new URL(ISSUE_URL);
      if (title.trim()) url.searchParams.set('title', title.trim().slice(0, 120));
      await moyu().openExternal(url.toString());
      toast('反馈已复制，请在 GitHub 正文中粘贴并提交'); setCopied(true);
    } catch { toast('未能打开 Issue，请复制反馈后前往 GitHub', 'error'); }
    finally { setSending(false); }
  };
  const clear = async () => {
    try { await moyu().clearFeedbackDiagnostics(); setEntries([]); setSelected(new Set()); toast('已清空本机报错记录'); }
    catch { toast('清空失败，请重试', 'error'); }
  };

  return <section className="feedback-page" aria-label="反馈与帮助">
    <div className="feedback-intro"><span className="feedback-intro__icon"><Icon name="chat" size={23} /></span><div><h3>让 MoyuBot 变得更好</h3><p>遇到问题，或有一个想法？在群组聊聊，也可以留下 Issue。</p></div></div>
    <div className="feedback-channels">
      <button type="button" className="feedback-channel" onClick={() => open(TELEGRAM)}><span className="feedback-channel__icon"><Icon name="chat" size={19} /></span><strong>Telegram</strong><small>t.me/moyubotnya</small><span className="feedback-channel__action">加入群组<Icon name="external" size={12} /></span></button>
      <button type="button" className="feedback-channel" onClick={() => void copy(QQ_GROUP, 'QQ群号已复制，在 QQ 中搜索加入')}><span className="feedback-channel__icon"><Icon name="users" size={19} /></span><strong>QQ 交流群</strong><small>{QQ_GROUP}</small><span className="feedback-channel__action">复制群号<Icon name="copy" size={12} /></span></button>
      <button type="button" className="feedback-channel" onClick={() => open('https://github.com/whitemoono/moyubot/issues')}><span className="feedback-channel__icon"><Icon name="github" size={19} /></span><strong>GitHub Issues</strong><small>问题追踪与功能建议</small><span className="feedback-channel__action">查看讨论<Icon name="external" size={12} /></span></button>
    </div>

    <section className="feedback-card">
      <div className="feedback-card__heading"><div><h3>整理一份反馈</h3><p>把问题、环境与报错放在一起，方便定位。</p></div><span className="feedback-local"><Icon name="shield" size={12} />本机诊断</span></div>
      <label className="feedback-field"><span>标题</span><input className="input" aria-label="反馈标题" placeholder="例如：云电脑唤醒后无法连接桌面" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="feedback-field"><span>发生了什么</span><textarea className="textarea" aria-label="反馈描述" placeholder={'你做了什么？遇到了什么问题？\n也可以写下你希望增加的功能。'} rows={3} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>

      <div className="feedback-diagnostics">
        <div className="feedback-diagnostics__heading"><label><input type="checkbox" checked={includeErrors} onChange={(event) => setIncludeErrors(event.target.checked)} /><span>附带近期报错<small>{loading ? '读取中…' : `本机 ${entries.length} 条`}</small></span></label><div><IconButton name="refresh" label="刷新报错记录" disabled={loading} onClick={() => void refresh()} /><IconButton name="trash" label="清空报错记录" disabled={!entries.length || loading} onClick={() => void clear()} /></div></div>
        <p className="feedback-privacy">仅在本机保留近 7 天、最多 60 条失败记录。已自动隐藏常见密钥与用户路径；发送前请检查预览，不会自动上传。</p>
        {loadError ? <p className="feedback-error" role="alert">{loadError}</p> : null}
        {includeErrors ? <div className="feedback-diagnostics__expanded">
          <label className="feedback-command-option"><input type="checkbox" checked={includeCommands} onChange={(event) => setIncludeCommands(event.target.checked)} />附带失败命令<span>命令可能包含业务内容，请检查后分享</span></label>
          {entries.length ? <><div className="feedback-records">{entries.slice(0, 10).map((entry) => <label className="feedback-record" key={entry.id}><input type="checkbox" checked={selected.has(entry.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} /><span><span className="feedback-record__meta"><strong>{entry.source}</strong><time>{new Date(entry.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></span><span className="feedback-record__message">{entry.message}</span>{includeCommands && entry.command ? <code>{entry.command}</code> : null}</span></label>)}</div><p className="feedback-selection">展示最近 10 条 · 已选择 {selectedCount} 条</p></> : <p className="feedback-empty"><Icon name="check" size={15} />暂无近期报错，遇到问题后可点击刷新。</p>}
        </div> : null}
      </div>

      <details className="feedback-preview" open><summary>发送内容预览<span>可直接编辑</span></summary><textarea className="textarea mono" aria-label="反馈内容预览" spellCheck={false} value={report} maxLength={180000} onChange={(event) => { setEdited(event.target.value); setCopied(false); }} /></details>
      <div className="feedback-footer"><span>群组反馈可复制后粘贴；Issue 将在浏览器打开。</span><Button size="sm" variant="glass" icon={copied ? 'check' : 'copy'} onClick={() => void copyReport()}>{copied ? '已复制' : '复制反馈'}</Button><Button size="sm" variant="primary" icon="github" disabled={sending} loading={sending} onClick={() => void issue()}>GitHub 提交 Issue</Button></div>
    </section>
  </section>;
}
