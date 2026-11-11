import logoUrl from './assets/brand/logo.png';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMoyu } from './state';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { Button, Sheet } from './components/Glass';
import { Icon } from './components/Icon';
import { ChatView } from './views/ChatView';
import { CreateBotDialog } from './components/CreateBotDialog';
import { WorkspaceTerminal } from './components/WorkspaceTerminal';
import { Onboarding } from './components/Onboarding';

const Inspector = lazy(() => import('./components/Inspector').then(({ Inspector }) => ({ default: Inspector })));
const TasksView = lazy(() => import('./views/TasksView').then(({ TasksView }) => ({ default: TasksView })));
const SettingsView = lazy(() => import('./views/SettingsView').then(({ SettingsView }) => ({ default: SettingsView })));

function Backdrop() {
  return <div className="wallpaper" aria-hidden="true" />;
}

function ApprovalSheet() {
  const { approval, respondApproval, requestSource } = useMoyu();
  if (!approval) return null;
  return (
    <Sheet
      open
      title="需要你的确认"
      subtitle={`${requestSource(approval)} · ${approval.toolName} 请求操作工作区电脑`}
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

function QuestionSheet() {
  const { question, answerQuestion, conversation, approval, view, settingsOpen, requestSource } = useMoyu();
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(''); }, [question?.id]);
  // 只有聊天页可交互时，才让输入框上方的卡片接管当前会话的问题。
  if (!question || approval || (view === 'chat' && !settingsOpen && question.conversationId === conversation?.id)) return null;
  const send = () => { if (draft.trim()) void answerQuestion({ requestId: question.id, answer: draft }); };
  return (
    <Sheet
      open
      title="Bot 需要你的回答"
      subtitle={requestSource(question)}
      onClose={() => void answerQuestion({ requestId: question.id, answer: '' })}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={() => void answerQuestion({ requestId: question.id, answer: '' })}>
            跳过
          </Button>
          <Button variant="primary" icon="send" disabled={!draft.trim()} onClick={send}>
            发送回答
          </Button>
        </>
      }
    >
      <p className="approval__summary">{question.question}</p>
      <textarea
        className="question__input"
        value={draft}
        rows={4}
        autoFocus
        placeholder="输入你的回答；留空发送 = 跳过"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
        }}
      />
      <p className="inline-hint">Ctrl + Enter 发送。跳过后 Bot 会按现有信息继续，并说明它做了什么假设。</p>
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
  const { ready, view, settings, settingsOpen, closeSettings, activeWorkspace } = useMoyu();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  const settingUp = ready && !settings.onboarding?.completedAt;

  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', settings.ui.reduceMotion);
  }, [settings.ui.reduceMotion]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) setInspectorOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  useEffect(() => setInspectorOpen(false), [view]);
  useEffect(() => setInspectorOpen(false), [activeWorkspace?.id]);

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
      {ready && !settingUp ? <TitleBar collapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} onToggleTerminal={() => setTerminalOpen((value) => !value)} /> : null}
      {!ready ? (
        <div className="splash">
          <img className="splash-logo" src={logoUrl} alt="" />
          <p>正在启动 MoyuBot…</p>
        </div>
      ) : (
        <div inert={settingsOpen || settingUp} className={`window-body ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${inspectorOpen && view === 'chat' ? 'is-inspector-open' : ''}`}>
          <Sidebar collapsed={sidebarCollapsed} onExpand={() => setSidebarCollapsed(false)} onCreateBot={() => setCreatingBot(true)} />
          <main className="main-view workspace-main" key={view} ref={mainRef}>
            <div className="workspace-main__content" key={activeWorkspace?.id}>
            {view === 'chat' ? <ChatView inspectorOpen={inspectorOpen} onToggleInspector={() => setInspectorOpen((value) => !value)} /> : null}
            {view === 'tasks' ? <Suspense fallback={<div role="status">正在加载任务…</div>}><TasksView /></Suspense> : null}
            </div>
            <WorkspaceTerminal open={terminalOpen} onClose={() => setTerminalOpen(false)} />
          </main>
          {inspectorOpen && view === 'chat' ? (
            <Suspense fallback={<aside className="rail inspector" role="status">正在加载对话详情…</aside>}>
              <Inspector key={activeWorkspace?.id} onOpenTerminal={() => setTerminalOpen(true)} onClose={() => setInspectorOpen(false)} onCreateBot={() => setCreatingBot(true)} />
            </Suspense>
          ) : null}
        </div>
      )}
      {settingUp ? <Onboarding /> : <><ApprovalSheet /><QuestionSheet /></>}
      {ready && settingsOpen ? (
        <Suspense fallback={<Sheet open title="设置" onClose={closeSettings}><p role="status">正在加载设置…</p></Sheet>}>
          <SettingsView key={activeWorkspace?.id} onCreateBot={() => setCreatingBot(true)} />
        </Suspense>
      ) : null}
      {creatingBot ? <CreateBotDialog onClose={() => setCreatingBot(false)} /> : null}
      <Toasts />
    </div>
  );
}
