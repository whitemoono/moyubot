import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { moyu } from '../lib/bridge';
import { Sheet, Button, Toggle } from './Glass';

export function MobileConnectionDialog({onClose}: {onClose: () => void}) {
  const [status, setStatus] = useState<any>({});
  const [pair, setPair] = useState<any>();
  const [qr, setQr] = useState('');
  const [pending, setPending] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [setupKey, setSetupKey] = useState('');
  const [notice, setNotice] = useState('');
  const [execution, setExecution] = useState<any>({providers:[],cloud:null});
  const [localExecution, setLocalExecution] = useState<any>({providers:[],cloudConfigured:false});
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [shareCloud, setShareCloud] = useState(false);
  const [consent, setConsent] = useState(false);
  const refresh = async () => {
    const next = await moyu().mobileSync('status'); setStatus(next);
    setLocalExecution(await moyu().mobileSync('execution-local'));
    setServer(current => current === null ? next.server || '' : current);
    if (next.connected) {
      const [p,d,c] = await Promise.all([moyu().mobileSync('pending'),moyu().mobileSync('devices'),moyu().mobileSync('conflicts')]);
      setPending(p.pairs.filter((p:any) => p.status === 'claimed')); setDevices(d.devices); setConflicts(c);
    }
  };
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void refresh().catch(e => setError(e.message)); const timer = setInterval(() => void refresh().catch(e => setError(e.message)),2500); return () => clearInterval(timer); }, []);
  useEffect(() => { if(status.connected) void moyu().mobileSync('execution-status').then(setExecution).catch(e=>setError(e.message)); else setExecution({providers:[],cloud:null}); },[status.connected,status.server]);
  const createPair = () => run(async () => {
    const p = await moyu().mobileSync('pair'); setPair(p);
    setQr(await QRCode.toDataURL(p.url,{width:280,margin:3,errorCorrectionLevel:'M',color:{dark:'#111111',light:'#ffffff'}}));
  });
  return <Sheet open title="连接手机" subtitle="在手机上接着看，随时同步你的工作空间" onClose={onClose}>
    <div className="mobile-pairing">
      <p>先部署你自己的 PWA 与同步服务，再填写服务器地址。数据只发送到你配置的服务器。</p>
      <form className="mobile-server-form" onSubmit={event => { event.preventDefault(); void run(async () => {
        await moyu().mobileSync('configure',{server,setupKey}); setSetupKey(''); setPair(undefined); setQr(''); setPending([]); setDevices([]); setConflicts([]); setNotice('服务器已保存。生成二维码后，用手机打开同一服务器的 PWA 扫码。');
      }); }}>
        <label htmlFor="mobile-sync-server">自建服务器地址</label>
        <input id="mobile-sync-server" type="url" value={server || ''} onChange={e => setServer(e.target.value)} placeholder="https://sync.example.com" required autoComplete="off" spellCheck={false}/>
        <label htmlFor="mobile-sync-setup-key">服务器连接密钥</label>
        <input id="mobile-sync-setup-key" type="password" value={setupKey} onChange={e => setSetupKey(e.target.value)} placeholder={status.hasSetupKey ? '已保存；留空保持现有密钥' : '部署时设置的 SYNC_SETUP_KEY'} autoComplete="new-password"/>
        <small>更换服务器会暂停同步，并在本机备份旧同步记录；本地对话保留。新服务器需重新配对并开启同步。</small>
        <div><Button type="button" disabled={busy || !server} onClick={() => run(async () => { await moyu().mobileSync('test',{server}); setNotice('服务器连接正常，可保存配置。'); })}>测试连接</Button> <Button type="submit" variant="primary" disabled={busy || !server}>保存服务器</Button></div>
      </form>
      {notice ? <p role="status">{notice}</p> : null}
      {status.configured ? <p>当前服务器：<a href={status.server} target="_blank" rel="noreferrer">{status.server}</a>。手机打开此地址，在「我的 → 连接电脑」扫码，然后在这里确认。</p> : <p>尚未配置服务器，当前不会发送同步请求。</p>}
      {qr && pair ? <div className="mobile-pairing__qr"><img src={qr} width="240" height="240" alt="手机连接二维码"/><small>{Date.now()<pair.expires ? `有效至 ${new Date(pair.expires).toLocaleTimeString()} · 仅可使用一次` : '二维码已过期，请刷新'}</small></div> : null}
      <Button loading={busy} disabled={busy || !status.configured} onClick={createPair}>{qr?'刷新二维码':'生成连接二维码'}</Button>
      {pending.map(p => <div className="mobile-pairing__device" key={p.id}><span><strong>{p.name}</strong><small>请求连接，请核对这是你的手机</small></span><Button disabled={busy} variant="primary" onClick={() => run(() => moyu().mobileSync('confirm',{id:p.id}))}>允许连接</Button></div>)}
      <Toggle label="实时同步到服务器" hint="本机的独立开关。开启后同步对话、伙伴、记忆和任务状态；断网后本地排队，恢复网络自动补齐。" checked={!!status.enabled} disabled={!status.connected || busy} onChange={enabled => run(() => moyu().mobileSync('enable',{enabled}))}/>
      <p role="status">{status.enabled ? (status.error || `已开启 · ${status.pending || 0} 条待上传`) : '同步已暂停，数据保留在本机'}{status.lastSync ? <><br/>最近同步：{new Date(status.lastSync).toLocaleString()}</> : null}</p>
      {status.connected ? <Button disabled={busy || !status.enabled} onClick={() => run(() => moyu().mobileSync('sync'))}>立即同步</Button> : null}
      {status.connected ? <section className="mobile-server-form" aria-label="手机聊天与云电脑授权">
        <strong>手机聊天与云电脑</strong>
        <p>选择要交给当前服务器的服务商与云电脑。手机通过服务器执行，原电脑关闭后也能聊天。</p>
        {localExecution.providers?.map((p:any)=><label className="mobile-execution-choice" key={p.id}><input type="checkbox" checked={selectedProviders.includes(p.id)} onChange={e=>setSelectedProviders(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.name}<small>{p.models?.length||0} 个模型</small></span></label>)}
        <label className="mobile-execution-choice"><input type="checkbox" checked={shareCloud} disabled={!localExecution.cloudConfigured} onChange={e=>setShareCloud(e.target.checked)}/><span>授权当前云电脑<small>{localExecution.cloudHint || (localExecution.cloudConfigured?'允许文件、命令和模型工具通过服务器执行；命令与写入需手机确认':'请先在云电脑设置中保存凭据')}</small></span></label>
        <label className="mobile-execution-choice"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>我同意把所选 API Key、服务商配置及云电脑凭据保存到 {status.server}<small>服务器加密保存；服务器管理员仍可解密。手机不获取明文密钥。本次保存替换已有授权，配置变更后需重新保存。</small></span></label>
        <Button disabled={busy||!consent} variant="primary" onClick={()=>run(async()=>{setExecution(await moyu().mobileSync('execution-authorize',{authorized:true,providerIds:selectedProviders,cloud:shareCloud}));setConsent(false);setNotice('所选服务已授权，手机可选择模型并聊天。');})}>授权并保存到服务器</Button>
        <p>已授权：{execution.providers?.map((p:any)=>p.name).join('、')||'没有服务商'}{execution.cloud?' · 云电脑已授权':''}</p>
        <Button disabled={busy} onClick={()=>run(async()=>{await moyu().mobileSync('execution-revoke');setExecution({providers:[],cloud:null});setNotice('服务器执行凭据已删除，正在执行的任务已停止。');})}>删除服务器上的执行凭据</Button>
      </section> : null}
      {devices.map(d => <div className="mobile-pairing__device" key={d.id}><span><strong>{d.name}{d.id===status.deviceId?'（本机）':''}</strong><small>最近在线 {new Date(d.seen).toLocaleString()}</small></span>{d.id!==status.deviceId ? <Button size="sm" onClick={() => run(() => moyu().mobileSync('revoke',{id:d.id}))}>断开连接</Button> : null}</div>)}
      {conflicts.map((c,i) => <details key={`${c.time}-${i}`}><summary>有一份同时编辑的内容已保留（{c.record.collection}）</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:160,overflow:'auto'}}>{JSON.stringify(c.record.value,null,2)}</pre><Button onClick={() => run(() => moyu().mobileSync('restore',{index:i}))}>恢复此本地版本并同步</Button></details>)}
      {error ? <p role="alert">{error}</p> : null}
      <p className="mobile-pairing__note">服务器保存已同步内容。另一台设备关闭时，本机仍可上传；对方下次打开会补齐。执行凭据仅在明确授权后上传。同步历史不会触发 AI 回复或重复执行任务；手机主动发送才会调用模型。</p>
    </div>
  </Sheet>;
}
