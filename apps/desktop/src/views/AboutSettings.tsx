import { useEffect, useState } from 'react';
import type { AppUpdateProgress, AppUpdateResult } from '@moyu/core';
import logo from '../assets/brand/logo.png';
import { Button } from '../components/Glass';
import { Icon } from '../components/Icon';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';

const REPOSITORY = 'https://github.com/whitemoono/moyubot';
const PLATFORMS: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function AboutSettings({ hidden }: { hidden: boolean }) {
  const { version, platform, toast, setSettingsSection } = useMoyu();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AppUpdateResult>();
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress>();
  const [acting, setActing] = useState(false);
  const downloading = progress?.status === 'downloading' || progress?.status === 'verifying';
  const installing = progress?.status === 'installing';
  const ready = progress?.status === 'ready';
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const state = await moyu().updateStatus(); if (alive) { setProgress(state); if (state.release) setResult(state.release); } }
      catch { /* explicit actions surface connection errors */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [hidden]);
  const open = (url: string) => void moyu().openExternal(url).catch(() => toast('无法打开链接，请稍后重试', 'error'));
  const check = async () => {
    if (checking || downloading || ready || installing || acting) return;
    setChecking(true);
    try { setResult(await moyu().checkForUpdates()); setProgress(await moyu().updateStatus()); }
    catch { setResult({ status: 'error', currentVersion: version, checkedAt: Date.now(), message: '检查失败，请稍后重试。' }); }
    finally { setChecking(false); }
  };
  const update = async (action: 'download' | 'install') => {
    if (acting) return;
    setActing(true);
    try {
      setProgress(await (action === 'download' ? moyu().downloadUpdate() : moyu().installUpdate()));
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { setActing(false); }
  };
  const percent = progress?.total ? Math.min(100, Math.floor(progress.received / progress.total * 100)) : 0;
  const transfer = progress?.total ? `${(progress.received / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(REPOSITORY); setCopied(true); }
    catch { toast('复制失败，请重试', 'error'); }
  };
  return <section className="about-page" hidden={hidden} aria-label="关于 MoyuBot">
    <div className="about-brand">
      <img className="about-brand__icon" src={logo} alt="MoyuBot App 图标" width="80" height="80" />
      <h3>MoyuBot</h3>
      <p>让 Bot 成为你的长期协作者。</p>
      <div className="about-brand__meta"><span>v{version}</span><i aria-hidden="true" /><span>{PLATFORMS[platform] ?? platform} 桌面版</span></div>
    </div>

    <div className={`about-update about-card ${result ? `about-update--${result.status}` : ''}`}>
      <span className={`about-card__icon ${checking ? 'is-checking' : ''}`}><Icon name={result?.status === 'current' ? 'check' : result?.status === 'error' ? 'alert' : 'refresh'} size={20} /></span>
      <div className="about-update__description" role="status" aria-live="polite">
        <strong>{downloading ? progress?.status === 'verifying' ? '正在校验更新…' : `正在下载更新 ${percent}%` : ready ? '更新已就绪' : installing ? '正在启动安装…' : progress?.status === 'error' ? '更新未完成' : checking ? '正在检查更新…' : result?.status === 'available' ? '有新版本可用' : result?.status === 'current' ? '已是最新版本' : result?.status === 'unpublished' ? '尚无公开发行版' : result?.status === 'error' ? '暂时无法检查更新' : '保持更新，遇见更好的 MoyuBot'}</strong>
        <p>{checking ? '正在获取 GitHub 最新正式发行版。' : progress?.message || [result?.message, result?.installHint].filter(Boolean).join(' ') || '检查最新正式版本与发行说明。'}</p>
        {downloading ? <div className="about-update__transfer"><progress aria-label="更新下载进度" max={progress?.total || 1} value={progress?.received || 0} /><small>{transfer} · 跟随系统代理</small></div> : null}
        {result && !checking ? <small>上次检查 {new Date(result.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small> : null}
      </div>
      <div className="about-update__actions">
        {downloading ? <Button size="sm" variant="ghost" disabled={progress?.status === 'verifying'} onClick={() => { void moyu().cancelUpdate().catch((error: Error) => toast(error.message, 'error')); }}>取消下载</Button> : null}
        {ready ? <Button size="sm" variant="primary" loading={acting} disabled={acting} onClick={() => void update('install')}>重启并安装</Button> : null}
        {!downloading && !ready && !installing && result?.status === 'available' && result.installer ? <Button size="sm" variant="primary" loading={acting} disabled={acting || checking} onClick={() => void update('download')}>{progress?.status === 'error' ? '重新下载' : '下载更新'}</Button> : null}
        {!downloading && !installing && result?.status === 'available' && result.releaseUrl ? <Button size="sm" variant="ghost" icon="external" onClick={() => open(result.releaseUrl!)}>查看新版本</Button> : null}
        {!downloading && !ready && !installing ? <Button size="sm" variant="glass" loading={checking} disabled={checking || acting} onClick={() => void check()}>{checking ? '检查中' : result?.status === 'error' ? '重试' : result ? '重新检查' : '检查更新'}</Button> : null}
      </div>
    </div>

    <div className="about-repository about-card">
      <div className="about-repository__head"><span className="about-card__icon"><Icon name="github" size={22} /></span><div><strong>开源仓库</strong><p>whitemoono / moyubot</p></div><button type="button" className="about-repository__open" onClick={() => open(REPOSITORY)} aria-label="打开 GitHub 仓库" title="打开 GitHub 仓库"><Icon name="external" size={16} /></button></div>
      <div className="about-repository__address"><a href={REPOSITORY} onClick={(event) => { event.preventDefault(); open(REPOSITORY); }}>{REPOSITORY}</a><button type="button" aria-label={copied ? '仓库地址已复制' : '复制仓库地址'} title={copied ? '已复制' : '复制地址'} onClick={() => void copy()} onBlur={() => setCopied(false)}><Icon name={copied ? 'check' : 'copy'} size={14} /></button></div>
      <div className="about-repository__links"><button type="button" onClick={() => open(`${REPOSITORY}/releases`)}>发行记录<Icon name="external" size={12} /></button><button type="button" onClick={() => setSettingsSection('feedback')}>问题反馈<Icon name="chat" size={12} /></button></div>
    </div>
    <p className="about-license"><Icon name="shield" size={13} />MIT 开源许可<span>为每一份灵感，留一处自在的工作空间。</span></p>
  </section>;
}
