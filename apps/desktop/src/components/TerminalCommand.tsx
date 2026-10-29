import { Button } from './Glass';

export function TerminalCommand({ command, onChange, onRun, onStop, local, running, disabled = false, label, runLabel = '执行', className = '' }: {
  command: string;
  onChange: (command: string) => void;
  onRun: () => void;
  onStop?: () => void;
  local: boolean;
  running: boolean;
  disabled?: boolean;
  label: string;
  runLabel?: string;
  className?: string;
}) {
  return <form className={`terminal-command ${className}`.trim()} aria-busy={running} data-disabled={disabled || running} onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && !running && command.trim()) onRun();
  }}>
    <div className="terminal-command__bar">
      <span className="terminal-command__prompt" aria-hidden="true">{local ? 'PS' : '$'}<span>›</span></span>
      <input
        aria-label={label}
        value={command}
        disabled={running || disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={running ? '正在执行命令…' : local ? '输入 PowerShell 命令…' : '输入云电脑命令…'}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {running && onStop ? <Button className="terminal-command__action" type="button" size="sm" variant="danger" icon="stop" aria-label="停止终端命令" onClick={onStop}>停止</Button> : <Button className="terminal-command__action" type="submit" size="sm" variant="primary" icon="play" loading={running} disabled={disabled || running || !command.trim()}>{running ? '执行中' : runLabel}</Button>}
    </div>
    <div className="terminal-command__meta">
      <span>{local ? 'PowerShell' : 'Shell'}<span className="terminal-command__divider">/</span>{local ? '本机' : '云电脑'}</span>
      <span>{running ? '命令执行中' : disabled ? '暂不可执行' : <><kbd>Enter ↵</kbd>{runLabel}</>}</span>
    </div>
  </form>;
}
