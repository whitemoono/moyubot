import jsQR from 'jsqr';
import { SyncClient, emptySyncState } from './vendor/sync.ts';

let database;
let session;
let client;
let camera;
let scanTimer;
let notify = () => {};
const CHANNEL = 'moyu-data';
const broadcasts = new BroadcastChannel(CHANNEL);
const request = (store, method, ...args) => new Promise((resolve,reject) => {
  const tx = database.transaction('state', method==='get'?'readonly':'readwrite');
  const r = tx.objectStore('state')[method](...args);
  tx.oncomplete = () => resolve(r.result); tx.onerror = () => reject(tx.error);
});
export async function initConnection(onChange) {
  notify = onChange;
  database = await new Promise((resolve,reject) => { const r=indexedDB.open('moyubot-mobile',1); r.onupgradeneeded=()=>r.result.createObjectStore('state'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  const savedSession = await request('state','get','session');
  const state = (await request('state','get','sync')) || emptySyncState();
  // Old implicit-host sessions never resume uploading. Keep a local recovery copy.
  if(savedSession && savedSession.server !== location.origin){
    await request('state','put',{session:savedSession,sync:state},'legacy-connection-backup');
    state.enabled=false;
    await request('state','delete','session');
    await request('state','put',state,'sync');
  } else session = savedSession;
  let saving = Promise.resolve();
  client = new SyncClient(state, {
    url: location.origin, token: () => session?.token,
    save: data => { const snapshot=structuredClone(data); saving=saving.then(()=>request('state','put',snapshot,'sync')).catch(()=>{ client.error='本机存储失败，请检查可用空间'; }); },
    changed: () => { broadcasts.postMessage('changed'); notify(); }, status: () => updateStatus(),
  });
  // One network writer per browser profile prevents stale tabs overwriting the outbox.
  if (navigator.locks) navigator.locks.request('moyu-sync-writer',{ifAvailable:true},async lock => {
    if (!lock) {
      document.querySelector('#app').inert=true;
      const warning=document.createElement('aside');warning.id='pwa-notice';
      warning.innerHTML='<span>另一个 MoyuBot 窗口正在使用本机数据。请关闭该窗口后刷新这里。</span><button>刷新</button>';
      warning.querySelector('button').onclick=()=>location.reload();document.body.append(warning);return;
    }
    client.start(); await new Promise(resolve=>window.addEventListener('pagehide',()=>{client.stop();resolve();},{once:true}));
  }); else client.start();
  broadcasts.onmessage = () => {};
  window.addEventListener('online',()=>{ void client.sync(true); });
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void client.sync(true);else stopCamera();});
  notify();
  const match = location.hash.match(/^#pair=(.+)$/);
  if(match){history.replaceState(null,'',location.pathname+location.search);await claim(match[1]);}
  window.addEventListener('hashchange',()=>{const next=location.hash.match(/^#pair=(.+)$/);if(next){history.replaceState(null,'',location.pathname+location.search);void claim(next[1]);}});
}
export const connected = () => !!session;
export const values = collection => client?.values(collection) || [];
export const put = (collection,id,value) => {client.put(collection,id,value);notify();void client.sync(true);};
export const connectionStatus = () => client ? {connected:!!session,enabled:client.state.enabled,pending:Object.keys(client.state.outbox).length,lastSync:client.state.lastSync,error:client.error,conflicts:client.state.conflicts.length} : {};
export const serverApi = async (route,body) => { if(!session)throw new Error('请先连接电脑');return client.api(route,body,{},route.startsWith('/api/cloud/')?300000:15000); };
export const connectionIdentity = () => session ? `${session.workspace}:${session.deviceId}` : '';
export const localExecutionData = async value => {const key=`pending-chat-runs:${connectionIdentity()}`;return value === undefined ? request('state','get',key) : request('state','put',value,key);};
export const flushConnection = async () => {if(!client?.state.enabled)throw new Error('请先开启实时同步');await client.sync(true);if(client.error||Object.keys(client.state.outbox).length)throw new Error(client.error||'仍有本机内容待上传，请稍候重试');};
function updateStatus() {
  const el=document.querySelector('#connection-status');if(!el||!client)return;
  const s=connectionStatus();el.textContent=`${s.error || (s.enabled?'实时同步已开启':'本机同步已暂停')} · ${s.pending} 条待上传${s.lastSync?' · 最近 '+new Date(s.lastSync).toLocaleTimeString():''}`;
  const button=document.querySelector('[data-connect="toggle"]');if(button){button.setAttribute('aria-checked',String(s.enabled));button.classList.toggle('on',s.enabled);}
}
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let showSheet;
export function connectionSheet(openSheet) {
  if(!client){openSheet('正在读取本机数据','请稍候','<p class="form-note">本机数据准备完成后即可连接。</p>');setTimeout(()=>connectionSheet(openSheet),200);return;}
  showSheet=openSheet;
  stopCamera();
  const paired=connected();
  openSheet(paired?'设备与同步':'连接电脑',paired?'把新的内容，带到下一台设备':'电脑端点击头像 → 连接手机，生成二维码',`<div class="connection-content">
    <div class="connection-symbol">⌁</div><p>${paired?'已连接你的自建工作空间。':'请使用你自己部署的 PWA。电脑端先填写同一服务器地址和连接密钥，再生成二维码。'}</p><p class="connection-server">当前站点：${escape(location.origin)}</p>
    ${paired?`<div class="task-row"><span><strong>实时同步到服务器</strong><small>只控制这台手机，电脑开关独立</small></span><button class="toggle ${client.state.enabled?'on':''}" role="switch" aria-label="实时同步到服务器" aria-checked="${client.state.enabled}" data-connect="toggle"><span></span></button></div><p id="connection-status" role="status"></p><button class="primary-button full-width" data-connect="sync">立即同步</button><button class="text-button" data-connect="disconnect">退出本机连接</button>`:
    `<button class="primary-button full-width" data-connect="scan">打开相机扫码</button><video id="pair-camera" playsinline muted hidden></video><p id="scan-status" role="status"></p><form id="pair-link-form"><label class="field-label" for="pair-link">粘贴连接链接</label><input id="pair-link" class="sheet-input" type="text" autocomplete="off" autocapitalize="off" placeholder="粘贴你自建服务器生成的连接链接" required/><button class="text-button" type="submit">连接这台电脑 →</button></form>`}
    <div id="pair-result" role="status"></div>
    ${paired && client.state.conflicts.length ? `<details><summary>${client.state.conflicts.length} 份同时编辑的内容已保留</summary>${client.state.conflicts.map((c,i)=>`<pre class="conflict-value">${escape(JSON.stringify(c.record.value,null,2))}</pre><button class="text-button" data-restore="${i}">恢复此本地版本并同步</button>`).join('')}</details>`:''}
    <p class="form-note">仅在完成配对并主动开启后，内容才会上传到当前自建服务器。没有默认公共同步服务。电脑端可单独授权模型与云电脑凭据，由服务器执行；手机不保存明文 Key。原电脑的本地环境需要原电脑在线，当前手机仅调用已授权的云电脑。</p>
  </div>`);
  updateStatus();
}
function result(message){ const el=document.querySelector('#pair-result');if(el)el.textContent=message; }
async function claim(text) {
  stopCamera();
  if(session){ if(!showSheet)notify('open-connection');result('这台手机已经连接。要更换电脑，请先退出本机连接。');return; }
  notify('open-connection');
  try {
    let raw=text;
    if(text.includes('#pair=')){
      const link=new URL(text);
      if(link.origin!==location.origin)throw new Error(`该二维码属于 ${link.origin}。请在手机打开这个自建服务器地址后再扫码。`);
      raw=link.hash.slice(6);
    }
    const [id,secret,...extra]=raw.split('.');if(!id||!secret||extra.length)throw new Error('连接链接无效，请重新扫描电脑二维码');
    result('正在请求连接…');
    const pending = await client.api('/api/pair/claim',{id,secret,name:/iPhone|iPad/.test(navigator.userAgent)?'iPhone / iPad PWA':'手机 PWA'});
    result('扫码成功，请在电脑端点击「允许连接」。');
    const deadline=Date.now()+5*60*1000;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,2000));
      const status=await client.api('/api/pair/status',{id:pending.id,claim:pending.claim});
      if(status.status==='approved'){
        session={token:pending.token,deviceId:pending.deviceId,workspace:pending.workspace,server:location.origin};
        await request('state','put',session,'session');
        client.state=emptySyncState();await request('state','put',client.state,'sync');
        result('电脑已确认连接。请开启「实时同步到服务器」以获取内容。');
        notify();connectionSheet(showSheet);return;
      }
      if(status.status!=='claimed')throw new Error('连接请求已取消，请重新扫码');
    }
    throw new Error('连接超时，请在电脑端刷新二维码');
  } catch(e){result(e.message);}
}
export function stopCamera(){clearTimeout(scanTimer);camera?.getTracks().forEach(t=>t.stop());camera=undefined;}
async function scan(){
  const status=document.querySelector('#scan-status');
  try {
    stopCamera(); camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:960}},audio:false});
    const video=document.querySelector('#pair-camera');if(!video){stopCamera();return;}
    video.hidden=false;video.srcObject=camera;await video.play();
    status.textContent='将电脑端的二维码放入取景框';
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const tick=()=>{
      if(!camera)return;
      if(!document.querySelector('#pair-camera')){stopCamera();return;}
      if(video.videoWidth){
        canvas.width=Math.min(720,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(pixels.data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
        if(code){void claim(code.data);return;}
      }
      scanTimer=setTimeout(tick,150);
    };tick();
  }catch(e){stopCamera();status.textContent=e.name==='NotAllowedError'?'相机权限未开启。可粘贴连接链接，或在浏览器设置中允许相机。':'相机暂时不可用，请粘贴连接链接。';}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-connect],[data-restore]');if(!button)return;
  try {
    if(button.dataset.restore!==undefined){client.restoreConflict(Number(button.dataset.restore));notify();connectionSheet(showSheet);return;}
    switch(button.dataset.connect){
      case 'scan':await scan();break;
      case 'toggle':client.setEnabled(!client.state.enabled);await client.sync(true);break;
      case 'sync':if(!client.state.enabled){result('请先开启实时同步。');break;}await client.sync(true);result(client.error||'已与服务器同步');break;
      case 'disconnect':
        if(Object.keys(client.state.outbox).length){result('仍有待上传内容，请先联网同步后再退出，避免丢失本机修改。');break;}
        try{await client.api('/api/devices/revoke',{id:session.deviceId});}catch{result('请联网后再退出连接。');break;}
        client.setEnabled(false);session=undefined;await request('state','delete','session');client.state=emptySyncState();await request('state','put',client.state,'sync');notify();connectionSheet(showSheet);break;
    }
  }catch(e){result(e.message);}
});
document.addEventListener('submit',event=>{if(event.target.id==='pair-link-form'){event.preventDefault();const input=document.querySelector('#pair-link');const text=input.value.trim();input.value='';void claim(text);}});
