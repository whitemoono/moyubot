import logoUrl from './assets/brand/logo.png';
import { useEffect, useRef } from 'react';
import { useMoyu } from './state';
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
  return <div className="wallpaper" aria-hidden="true" />;
}

function ApprovalSheet() {
  const { approval, respondApproval } = useMoyu();
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
  const { toasts } = useMoyu();
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
  const { ready, view, settings } = useMoyu();

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

  return (
    <div className="app">
      <Backdrop />
      <TitleBar />
      {!ready ? (
        <div className="splash">
          <img className="splash-logo" src={logoUrl} alt="" />
          <p>正在启动 MoyuBot…</p>
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