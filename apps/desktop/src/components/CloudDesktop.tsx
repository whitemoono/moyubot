import { useEffect, useRef, useState } from 'react';
import type { DesktopSession } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { Button, Sheet } from './Glass';
import { Icon } from './Icon';

export function CloudDesktop() {
  const [session, setSession] = useState<DesktopSession>();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const screen = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLButtonElement>(null);
  const manual = session?.mode === 'manual';

  useEffect(() => {
    const element = preview.current;
    if (!element) return;
    const observer = new ResizeObserver(() => element.style.setProperty('--desktop-thumbnail-scale', String(element.clientWidth / 1280)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    alive.current = true;
    setError(''); setLoaded(false);
    void moyu().desktopOpen().then((value) => { if (alive.current) setSession(value); })
      .catch((reason: Error) => { if (alive.current) setError(reason.message); });
    return () => {
      alive.current = false;
      void moyu().desktopClose().catch(() => {});
    };
  }, [retry]);

  useEffect(() => {
    if (!manual) return;
    const heartbeat = window.setInterval(() => { void moyu().desktopHeartbeat().catch(() => {}); }, 10_000);
    return () => window.clearInterval(heartbeat);
  }, [manual]);

  useEffect(() => {
    if (!session || manual) return;
    const timer = window.setTimeout(() => setRetry((value) => value + 1), Math.max(1000, Date.parse(session.expiresAt) - Date.now() - 60_000));
    return () => window.clearTimeout(timer);
  }, [session, manual]);

  const control = async (take: boolean) => {
    if (pending) return;
    setPending(true); setError('');
    try {
      const value = await (take ? moyu().desktopTake() : moyu().desktopRelease());
      if (alive.current) { setSession(value); setLoaded(false); }
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { if (alive.current) setPending(false); }
  };

  const close = async () => {
    if (pending) return;
    if (manual) {
      setPending(true); setError('');
      try { const value = await moyu().desktopRelease(); if (alive.current) { setSession(value); setExpanded(false); setLoaded(false); } }
      catch (reason) { if (alive.current) setError((reason as Error).message); }
      finally { if (alive.current) setPending(false); }
    } else { setExpanded(false); setLoaded(false); }
  };

  const reconnect = async () => {
    if (pending) return;
    setPending(true); setError('');
    try { const value = await moyu().desktopOpen(); if (alive.current) { setSession(value); setLoaded(false); } }
    catch (reason) { if (alive.current) setError((reason as Error).message); }
    finally { if (alive.current) setPending(false); }
  };

  const viewer = (thumbnail: boolean) => session ? <iframe
    key={`${session.url}-${thumbnail}`}
    className={thumbnail ? 'cloud-desktop__iframe cloud-desktop__iframe--thumbnail' : 'cloud-desktop__iframe'}
    src={session.url} title={thumbnail ? '云电脑实时缩略图' : manual ? '手动控制云电脑' : '云电脑只读桌面'}
    sandbox="allow-scripts allow-same-origin allow-pointer-lock"
    allow="fullscreen" referrerPolicy="no-referrer" tabIndex={thumbnail || !manual ? -1 : 0}
    onLoad={() => setLoaded(true)}
  /> : null;

  return <div className={`cloud-desktop ${manual ? 'is-manual' : ''}`}>
    <button ref={preview} type="button" className="cloud-desktop__preview" aria-label="放大云电脑桌面" onClick={() => { setExpanded(true); setLoaded(false); }}>
      {!expanded ? viewer(true) : <div className="cloud-desktop__placeholder"><Icon name="cloud" size={25} /><span>桌面已在大窗口打开</span></div>}
      {!session ? <div className="cloud-desktop__placeholder">{error ? <Icon name="cloud" size={24} /> : <span className="spinner" />}<span>{error ? '暂时无法连接桌面' : '正在连接实时桌面…'}</span></div> : null}
      {session && !expanded ? <span className="cloud-desktop__expand"><Icon name="external" size={14} /> 放大桌面</span> : null}
    </button>
    <div className="cloud-desktop__status"><i /><span>{manual ? '你正在接管' : 'Bot 操作 · 实时预览'}</span></div>
    {error && !expanded ? <div className="cloud-desktop__error"><span>{error}</span><Button size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>重新连接</Button></div> : null}
    <Sheet open={expanded} title="云电脑" subtitle={manual ? '你正在操作 · 此工作区的 Bot 已暂停电脑操作' : 'Bot 操作中 · 当前为只读观看'} onClose={() => void close()} wide className="cloud-desktop-modal"
      footer={<><span className="cloud-desktop__hint">{pending ? '正在切换控制权，请稍候…' : manual ? '关闭窗口时自动交还 Bot' : '接管会等待当前命令结束，再暂停所有 Bot 的电脑操作'}</span><Button size="sm" variant="ghost" icon="external" onClick={() => { void screen.current?.requestFullscreen().catch(() => setError('当前无法进入全屏')); }}>全屏</Button><Button size="sm" variant={manual ? 'glass' : 'primary'} disabled={!session || pending} loading={pending} onClick={() => void control(!manual)}>{manual ? '交还 Bot' : '接管电脑'}</Button></>}>
      <div ref={screen} className={`cloud-desktop__screen ${manual ? 'is-manual' : ''}`}>
        {expanded ? viewer(false) : null}
        {!loaded && !error ? <div className="cloud-desktop__loading"><span className="spinner" />连接桌面中…</div> : null}
      </div>
      {error ? <div className="cloud-desktop__error" role="alert">{error}<Button size="sm" variant="ghost" disabled={pending} onClick={() => void reconnect()}>重新连接</Button></div> : null}
    </Sheet>
  </div>;
}
