import { useEffect, useState } from 'react';
import type { MemoryScopeSummary } from '@moyu/core';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { formatRelative } from '../lib/format';
import { BotAvatar } from '../components/BotAvatar';
import { Button, Panel } from '../components/Glass';
import { Icon } from '../components/Icon';
function scopeMeta(scope: MemoryScopeSummary): string {
  const parts = [scope.kind === 'group' ? '群聊记忆' : 'Bot 记忆', `${scope.total} 条`];
  if (scope.pinned) parts.push(`${scope.pinned} 条固定`);
  if (scope.latestAt) parts.push(`最近 ${formatRelative(scope.latestAt)}`);
  return parts.join(' · ');
}

export function MemoriesView() {
  const { settings, toast, activeWorkspace } = useMoyu();
  const [scopes, setScopes] = useState<MemoryScopeSummary[]>();
  const [libraryPath, setLibraryPath] = useState('');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    moyu().memoryScopes(activeWorkspace?.id).then((value) => { if (!cancelled) { setScopes(value); setError(''); } }).catch((failure: Error) => { if (!cancelled) setError(failure.message); });
    moyu().memoryPath().then((value) => { if (!cancelled) setLibraryPath(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tick, activeWorkspace?.id]);
  const total = scopes?.reduce((sum, item) => sum + item.total, 0) ?? 0;
  const pinned = scopes?.reduce((sum, item) => sum + item.pinned, 0) ?? 0;
  const open = async (scopeId?: string) => {
    try { await moyu().openMemoryFolder(scopeId); }
    catch (failure) { toast((failure as Error).message, 'error'); }
  };
  const copyPath = async (value: string) => {
    try { await moyu().writeClipboardText(value); toast('已复制路径，粘贴到资源管理器地址栏即可打开'); }
    catch (failure) { toast((failure as Error).message, 'error'); }
  };
  const exportMd = async () => {
    setExporting(true);
    try { const dir = await moyu().exportMemories(); toast(`已导出全部记忆到 ${dir}`); }
    catch (failure) { toast((failure as Error).message, 'error'); }
    finally { setExporting(false); }
  };
  return <Panel className="settings-card settings-memories">
    <h3 className="settings-section-title">记忆存储</h3>
    <div className="settings-rows">
      <div className="settings-row">
        <div><strong>存放位置</strong><p>全部记忆集中保存在一个 SQLite 数据库（memories.db）里，按 Bot / 群聊天然隔离，支持关键词与语义混合检索；向量服务不可用时自动退化为纯关键词检索。检索用的向量模型在「模型供应商」页配置。</p>
          {libraryPath ? <code className="settings-memories__path" title={libraryPath}>{libraryPath}</code> : null}
          <p className="settings-memories__hint">若点击「打开文件夹」没有弹出窗口（部分安全策略会限制应用拉起资源管理器），复制路径后去掉末尾的 memories.db 粘贴到资源管理器地址栏即可。旧版 Markdown 资料库已归档到数据目录的 memories-md-archive。</p></div>
        <div className="settings-memories__actions">
          <Button size="sm" icon="folder" onClick={() => void open()}>打开文件夹</Button>
          <Button size="sm" icon="copy" onClick={() => void copyPath(libraryPath)}>复制路径</Button>
          <Button size="sm" icon="external" disabled={!total || exporting} loading={exporting} onClick={() => void exportMd()}>导出 Markdown</Button>
        </div>
      </div>
    </div>
    <div className="settings-memories__head">
      <h3 className="settings-section-title">各 Bot 与群聊</h3>
      <div className="settings-memories__stats">
        <span>{total} 条记忆</span>
        {pinned ? <span>{pinned} 条固定</span> : null}
        <button type="button" className="settings-memories__refresh" aria-label="刷新记忆统计" onClick={() => setTick((value) => value + 1)}><Icon name="refresh" size={13} /></button>
      </div>
    </div>
    {error ? <p className="settings-memories__error" role="alert">暂时无法读取记忆统计：{error}</p>
      : !scopes ? <p className="settings-memories__loading" role="status">正在读取记忆统计…</p>
      : <div className="settings-memory-list">
        {scopes.map((scope) => {
          const bot = settings.bots.find((item) => item.id === scope.scopeId);
          return <button type="button" key={scope.scopeId} className="settings-memory-row" title={`在文件管理器中打开 ${scope.title} 的记忆`} onClick={() => void open(scope.scopeId)}>
            {bot ? <BotAvatar bot={bot} size="sm" animated={false} /> : <span className="settings-memory-row__monogram">{scope.title.charAt(0).toUpperCase()}</span>}
            <span className="settings-memory-row__body"><strong>{scope.title}</strong><small>{scopeMeta(scope)}</small></span>
            <Icon name="folder" size={15} />
          </button>;
        })}
      </div>}
    <p className="settings-note"><Icon name="check" size={13} />固定（📌）的记忆会优先注入对话；在聊天右侧栏「资料库 → 长期记忆」也可以增删改。</p>
  </Panel>;
}
