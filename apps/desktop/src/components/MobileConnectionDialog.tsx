import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { moyu } from '../lib/bridge';
import { useMoyu } from '../state';
import { Button, Sheet, Toggle } from './Glass';
import { formatRelative } from '../lib/format';

interface SyncStatus { server: string; configured: boolean; hasSetupKey: boolean; connected: boolean; enabled: boolean; pending: number; conflicts: number; lastSync?: number; error: string; deviceId?: string }
interface PairInfo { id: string; expires: number; url: string }
interface PendingPair { id: string; expires: number; status: string; name?: string; deviceId?: string }
interface DeviceRow { id: string; name: string; kind: string; created: number; seen: number }
interface LocalExecution { providers: { id: string; name: string; models: unknown[] }[]; cloudConfigured: boolean; cloudMachineName: string; cloudMachineId: string; cloudHint: string }

/** 连接手机 / 自建同步服务器：服务器配置 → 配对二维码 → 实时同步 → 执行授权 → 设备管理。
 *  全部驱动主进程 MobileSync 的现成 action，本组件不做任何协议逻辑。 */
export function MobileConnectionDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useMoyu();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [server, setServer] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [qr, setQr] = useState('');
  const [pending, setPending] = useState<PendingPair[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [localExecution, setLocalExecution] = useState<LocalExecution | null>(null);
  const [savedProviderIds, setSavedProviderIds] = useState<string[]>([]);
  const [savedCloud, setSavedCloud] = useState(false);
  const [chosenProviders, setChosenProviders] = useState<string[]>([]);
  const [chooseCloud, setChooseCloud] = useState(false);
  const [consent, setConsent] = useState(false);
  const [conflicts, setConflicts] = useState<{ record: { collection: string; id: string }; time: number }[]>([]);
  const pairTimer = useRef<number | undefined>(undefined);

  const act = useCallback(async (action: string, payload?: unknown) => {
    setBusy(action);
    try { return await moyu().mobileSync(action, payload); }
    catch (error) { toast((error as Error).message, 'error'); return undefined; }
    finally { setBusy(null); }
  }, [toast]);

  const refresh = useCallback(async () => {
    const next = await act('status');
    if (next) setStatus(next);
  }, [act]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (pairTimer.current) window.clearInterval(pairTimer.current); }, []);

  // 配对二维码有效期内轮询待确认设备；手机扫码认领后出现「确认连接」。
  useEffect(() => {
    if (!pair) { if (pairTimer.current) { window.clearInterval(pairTimer.current); pairTimer.current = undefined; } return; }
    const poll = async () => {
      const result = await act('pending');
      if (result?.pairs) setPending(result.pairs);
      if (pair.expires - Date.now() <= 0) { setPair(null); setQr(''); }
    };
    void poll();
    pairTimer.current = window.setInterval(() => void poll(), 3000);
    return () => { if (pairTimer.current) { window.clearInterval(pairTimer.current); pairTimer.current = undefined; } };
  }, [pair?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDevices = useCallback(async () => {
    const result = await act('devices');
    if (result?.devices) setDevices(result.devices);
  }, [act]);
  useEffect(() => { if (status?.connected) void loadDevices(); }, [status?.connected, loadDevices]);

  const loadExecution = useCallback(async () => {
    const local = await act('execution-local');
    if (local) setLocalExecution(local);
    const saved = status?.connected ? await act('execution-status') : undefined;
    const ids: string[] = (saved?.providers ?? []).map((item: { id: string }) => item.id);
    setSavedProviderIds(ids);
    setChosenProviders(ids);
    setSavedCloud(!!saved?.cloud);
    setChooseCloud(!!saved?.cloud);
  }, [act, status?.connected]);
  useEffect(() => { void loadExecution(); }, [loadExecution]);

  const loadConflicts = useCallback(async () => {
    const list = await act('conflicts');
    if (Array.isArray(list)) setConflicts(list);
  }, [act]);
  useEffect(() => { if (status?.connected) void loadConflicts(); }, [status?.lastSync, status?.connected, loadConflicts]);

  const test = async () => {
    const result = await act('test', { server });
    if (result?.ok) toast('服务器连接成功，私有同步已开启', 'info');
  };
  const save = async () => {
    const next = await act('configure', { server, setupKey: setupKey.trim() || undefined });
    if (next) { setStatus(next); toast('服务器已保存', 'info'); }
  };
  const generatePair = async () => {
    const next = await act('pair');
    if (!next?.url) return;
    setPair(next);
    setQr(await QRCode.toDataURL(next.url, { margin: 1, width: 240 }));
    setPending([]);
  };
  const confirmPair = async (id: string) => {
    const result = await act('confirm', { id });
    if (result?.ok) { toast('设备已连接', 'info'); setPair(null); setQr(''); setPending([]); void refresh(); void loadDevices(); }
  };
  const toggleSync = async (enabled: boolean) => {
    const next = await act('enable', { enabled });
    if (next) { setStatus(next); toast(enabled ? '实时同步已开启' : '实时同步已暂停', 'info'); }
  };
  const syncNow = async () => {
    const next = await act('sync');
    if (next) { setStatus(next); toast('已同步', 'info'); void loadConflicts(); }
  };
  const saveExecution = async () => {
    const result = await act('execution-authorize', { authorized: consent, providerIds: chosenProviders, cloud: chooseCloud });
    if (result !== undefined) { toast('执行授权已保存到服务器', 'info'); setSavedProviderIds(chosenProviders); setSavedCloud(chooseCloud); setConsent(false); }
  };
  const revokeExecution = async () => {
    const result = await act('execution-revoke');
    if (result !== undefined) { toast('已撤销执行授权', 'info'); setSavedProviderIds([]); setSavedCloud(false); setChosenProviders([]); setChooseCloud(false); }
  };

  const connected = !!status?.connected;
  const sectionTitle = 'settings-section-title';

  return <Sheet open title="连接手机" subtitle="自建服务器 · 三端数据实时互通" onClose={onClose}>
    <div style={{ display: 'grid', gap: 18 }}>
      <section>
        <h3 className={sectionTitle}>1 · 自建同步服务器</h3>
        <p className="inspector-note">部署方法见仓库 apps/web/DEPLOY.md（Docker + HTTPS）。地址只含协议、域名和可选端口，不带子路径。</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <input className="input mono" aria-label="服务器地址" placeholder="https://sync.example.com" value={server} onChange={(event) => setServer(event.target.value)} />
          <input className="input mono" aria-label="连接密钥" type="password" placeholder="部署时设置的 SYNC_SETUP_KEY（至少 32 字符）" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="ghost" loading={busy === 'test'} disabled={!server.trim()} onClick={() => void test()}>测试连接</Button>
            <Button size="sm" loading={busy === 'configure'} disabled={!server.trim()} onClick={() => void save()}>保存服务器</Button>
          </div>
          {status?.server ? <p className="inspector-note">当前：{status.server}{connected ? ' · 已配对' : ' · 未配对'}{status.error ? ` · ${status.error}` : ''}</p> : null}
        </div>
      </section>

      <section>
        <h3 className={sectionTitle}>2 · 配对手机</h3>
        {!connected ? <p className="inspector-note">先保存服务器（需要连接密钥），再生成二维码。手机打开同一服务器的 PWA，在「我的 → 连接电脑」扫码，然后在这里确认。</p> : null}
        <Button size="sm" loading={busy === 'pair'} disabled={!connected} onClick={() => void generatePair()}>生成连接二维码</Button>
        {pair && qr ? <div style={{ display: 'grid', gap: 8, justifyItems: 'start', marginTop: 10 }}>
          <img src={qr} alt="配对二维码" width={180} height={180} style={{ borderRadius: 12 }} />
          <p className="inspector-note">五分钟内有效、单次使用；也可以把链接发给手机打开。</p>
        </div> : null}
        {pending.length ? <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {pending.map((item) => <div className="settings-row" key={item.id}>
            <div><strong>{item.name || '新设备'}</strong><p>{item.status === 'claimed' ? '已扫码，等待确认' : '等待扫码'} · {formatRelative(item.expires)}</p></div>
            {item.status === 'claimed' ? <Button size="sm" loading={busy === 'confirm'} onClick={() => void confirmPair(item.id)}>确认连接</Button> : null}
          </div>)}
        </div> : null}
      </section>

      <section>
        <h3 className={sectionTitle}>3 · 实时同步</h3>
        <Toggle label="实时同步到服务器" hint={connected ? (status?.enabled ? `已开启 · 待上传 ${status.pending} · 冲突 ${status.conflicts}${status.lastSync ? ` · 上次 ${formatRelative(status.lastSync)}` : ''}` : '已连接，未开启') : '配对后可用'} checked={!!status?.enabled} disabled={!connected} onChange={(value) => void toggleSync(value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button size="sm" variant="ghost" loading={busy === 'sync'} disabled={!connected} onClick={() => void syncNow()}>立即同步</Button>
        </div>
        {conflicts.length ? <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <p className="capability-error">有 {conflicts.length} 条冲突（服务器版本更新，本地副本已保留）</p>
          {conflicts.slice(0, 5).map((item, index) => <div className="settings-row" key={`${item.record.collection}/${item.record.id}/${item.time}`}>
            <div><strong>{item.record.collection}</strong><p>{item.record.id} · {formatRelative(item.time)}</p></div>
            <Button size="sm" variant="ghost" onClick={() => void act('restore', { index }).then(() => { void syncNow(); })}>用本地覆盖</Button>
          </div>)}
        </div> : null}
      </section>

      <section>
        <h3 className={sectionTitle}>4 · 手机聊天与云电脑（执行授权）</h3>
        <p className="inspector-note">勾选后，所选服务商凭据{localExecution?.cloudConfigured ? '和云电脑配置' : ''}会加密保存到服务器，手机才能替你发消息、操作云电脑。可随时撤销。</p>
        {!localExecution ? <p className="inspector-note">读取本机配置中…</p> : <div style={{ display: 'grid', gap: 6 }}>
          {localExecution.providers.map((provider) => <Toggle key={provider.id} label={provider.name} hint={savedProviderIds.includes(provider.id) ? '已授权 · 手机可用' : '未授权'} checked={chosenProviders.includes(provider.id)} onChange={(value) => setChosenProviders((current) => value ? [...new Set([...current, provider.id])] : current.filter((id) => id !== provider.id))} />)}
          {localExecution.cloudConfigured ? <Toggle label={`云电脑 · ${localExecution.cloudMachineName || '未识别'}`} hint={savedCloud ? '已授权 · 手机可执行命令与读写文件' : '未授权'} checked={chooseCloud} onChange={setChooseCloud} /> : <p className="inspector-note">{localExecution.cloudHint}</p>}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            我明确同意把所选凭据加密保存到当前服务器
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" loading={busy === 'execution-authorize'} disabled={!connected || !consent || (!chosenProviders.length && !chooseCloud)} onClick={() => void saveExecution()}>保存授权</Button>
            {savedProviderIds.length || savedCloud ? <Button size="sm" variant="ghost" loading={busy === 'execution-revoke'} disabled={!connected} onClick={() => void revokeExecution()}>撤销授权</Button> : null}
          </div>
        </div>}
      </section>

      <section>
        <h3 className={sectionTitle}>5 · 已连接设备</h3>
        {!devices.length ? <p className="inspector-note">还没有已配对的设备。</p> : <div style={{ display: 'grid', gap: 6 }}>
          {devices.map((device) => <div className="settings-row" key={device.id}>
            <div><strong>{device.name}</strong><p>{device.kind === 'desktop' ? '桌面端' : '手机'} · 最近活跃 {formatRelative(device.seen)}</p></div>
            <Button size="sm" variant="ghost" onClick={() => void act('revoke', { id: device.id }).then(() => { void loadDevices(); void refresh(); })}>移除</Button>
          </div>)}
        </div>}
      </section>
    </div>
  </Sheet>;
}
