import { useEffect, useRef } from 'react';
import { useMesh } from './state';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { Button, Sheet } from './components/Glass';
import { Icon } from './components/Icon';
import { ChatView } from './views/ChatView';
import { BotsView } from './views/BotsView';
import { CloudView } from './views/CloudView';
import { TasksView } from './views/TasksView';
import { SettingsView } from './views/SettingsView';

function Backdrop() {
  return (
    <>
      <div className="wallpaper" aria-hidden="true" />
      <div className="aurora aurora--1" aria-hidden="true" />
      <div className="aurora aurora--2" aria-hidden="true" />
      <div className="aurora aurora--3" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="cursor-glow" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}

function ApprovalSheet() {
  const { approval, respondApproval } = useMesh();
  if (!approval) return null;
  return (
    <Sheet
      open
      title="需要你的确认"
      subtitle={`${approval.toolName} 请求访问共享云电脑`}
      onClose={() => void respondApproval(false)}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={() => void respondApproval(false)}>
            拒绝
          </Button>
          <Button variant="primary" icon="check" onClick={() => void respondApproval(true)}>
            允许一次
          </Button>
        </>
      }
    >
      <p className="approval__summary">{approval.summary}</p>
      {approval.command ? (
        <div className="approval__cmd">
          <div className="approval__cmd-head">
            <Icon name="terminal" size={15} /> 将要执行的命令
          </div>
          <pre>{approval.command}</pre>
        </div>
      ) : null}
      <p className="inline-hint">确认只作用于这一次调用；想永久放行，请把这个 Bot 的权限改成「全部允许」。</p>
    </Sheet>
  );
}

function Toasts() {
  const { toasts } = useMesh();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toastItem) => (
        <div key={toastItem.id} className={`toast toast--${toastItem.level}`}>
          <Icon name={toastItem.level === 'error' ? 'alert' : toastItem.level === 'warn' ? 'shield' : 'spark'} size={16} />
          <span>{toastItem.text}</span>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { ready, view, settings } = useMesh();

  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', settings.ui.reduceMotion);
  }, [settings.ui.reduceMotion]);

  useEffect(() => {
    // Views remount on switch; make sure a restored scroll position never hides the header.
    const reset = () => {
      if (mainRef.current) mainRef.current.scrollTop = 0;
      mainRef.current?.querySelectorAll<HTMLElement>('.view').forEach((element) => {
        element.scrollTop = 0;
      });
    };
    reset();
    const frame = requestAnimationFrame(reset);
    const timers = [60, 200, 420].map((ms) => setTimeout(reset, ms));
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [view]);

  useEffect(() => {
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        document.documentElement.style.setProperty('--mx', `${event.clientX}px`);
        document.documentElement.style.setProperty('--my', `${event.clientY}px`);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="app">
      <Backdrop />
      <TitleBar />
      {!ready ? (
        <div className="splash">
          <div className="hero-orb">
            <span className="hero-orb__glass" />
            <span className="hero-orb__ring" />
          </div>
          <p>正在启动 MeshBot…</p>
        </div>
      ) : (
        <div className={`window-body ${view === 'cloud' || view === 'settings' ? 'window-body--wide' : ''}`.trim()}>
          <Sidebar />
          <main className="main-view" key={view} ref={mainRef}>
            {view === 'chat' ? <ChatView /> : null}
            {view === 'bots' ? <BotsView /> : null}
            {view === 'cloud' ? <CloudView /> : null}
            {view === 'tasks' ? <TasksView /> : null}
            {view === 'settings' ? <SettingsView /> : null}
          </main>
          <Inspector />
        </div>
      )}
      <ApprovalSheet />
      <Toasts />
    </div>
  );
}