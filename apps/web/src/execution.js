import {serverApi,connected,connectionStatus,flushConnection,put,values,localExecutionData,connectionIdentity} from './connection.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog={providers:[],cloud:null},runs={runs:[],approvals:[]},ui,tick=0,polling=false,jobs=[],jobsLoaded=false,sending=false,identity='';
export const executionCatalog=()=>catalog;
export const runningConversation=id=>runs.runs.find(r=>r.conversation===id&&r.status==='running');
export function installExecution(callbacks){ui=callbacks;setInterval(()=>void refresh(),2000);void refresh();}
export const queuedConversation=id=>jobs.find(j=>j.conversationId===id);
async function refresh(){
 if(identity!==connectionIdentity()){identity=connectionIdentity();catalog={providers:[],cloud:null};runs={runs:[],approvals:[]};jobs=[];jobsLoaded=false;}
 if(!connected()||!connectionStatus().enabled||polling)return;
 polling=true;try{
  if(!jobsLoaded){jobs=(await localExecutionData())||[];jobsLoaded=true;ui.refresh();}
  await sendQueued();
  const next=await serverApi('/api/chat/runs');
  const changed=JSON.stringify(next)!==JSON.stringify(runs);runs=next;
  if(tick++%5===0){const nextCatalog=await serverApi('/api/execution/config');if(JSON.stringify(catalog)!==JSON.stringify(nextCatalog)){catalog=nextCatalog;ui.refresh();}}
  if(changed){ui.refresh();renderApprovals();}
 }catch{}finally{polling=false;}
}
export async function chooseModels(botId){
 try{catalog=await serverApi('/api/execution/config');const bot=values('bots').find(b=>b.id===botId);if(!bot)throw new Error('请先同步伙伴');
 ui.open('选择服务商与模型','使用你已授权到自建服务器的配置',`<div class="runtime-options">${catalog.providers.map(p=>`<h3>${escape(p.name)}</h3>${p.models.map(model=>`<button class="runtime-model ${bot.providerId===p.id&&bot.model===model?'selected':''}" data-provider="${escape(p.id)}" data-model="${escape(model)}" data-runtime-bot="${escape(botId)}">${escape(model)}${bot.providerId===p.id&&bot.model===model?' ✓':''}</button>`).join('')}`).join('')||'<p class="form-note">还没有授权的服务商。请在电脑头像 → 连接手机 → 手机聊天与云电脑中选择服务商并授权。</p>'}</div>`);
 }catch(e){ui.toast(e.message);}
}
export async function sendChat(bot,conversationId,text){
 if(!connectionStatus().enabled)throw new Error('请先开启实时同步');
 if(identity!==connectionIdentity()){identity=connectionIdentity();jobs=[];jobsLoaded=false;}
 if(!jobsLoaded){jobs=(await localExecutionData())||[];jobsLoaded=true;}
 const requestId=crypto.randomUUID();jobs.push({botId:bot.id,conversationId,text,requestId,providerId:bot.providerId,model:bot.model});await localExecutionData(jobs);
 put('messages',requestId,{id:requestId,conversationId,botId:bot.id,role:'user',content:text,createdAt:Date.now()});
 await sendQueued();ui.refresh();
}
async function sendQueued(){
 if(sending||!navigator.onLine)return;sending=true;
 const source=connectionIdentity();
 try{for(const job of [...jobs]){if(job.error)continue;try{if(connectionIdentity()!==source)break;await flushConnection();if(connectionIdentity()!==source)break;await serverApi('/api/chat/send',job);if(connectionIdentity()!==source)break;jobs=jobs.filter(j=>j.requestId!==job.requestId);await localExecutionData(jobs);await flushConnection();}catch(e){if(connectionIdentity()!==source)break;if(e.status){job.error=e.message;await localExecutionData(jobs);}else break;}}}finally{sending=false;}
}
export async function stopChat(conversationId){try{const job=runningConversation(conversationId);if(job)await serverApi('/api/chat/stop',{id:job.id});await refresh();}catch(e){ui.toast(e.message);}}
export function showApprovals(){ui.open('工具执行确认','核对命令和写入内容后再允许','<div id="runtime-approvals"></div>');renderApprovals();}
function renderApprovals(){const target=document.querySelector('#runtime-approvals');if(!target)return;target.innerHTML=runs.approvals.map(a=>`<article class="runtime-approval"><strong>${escape(a.tool)}</strong><pre>${escape(JSON.stringify(a.arguments,null,2))}</pre><div><button class="primary-button" data-runtime-approve="${escape(a.id)}">允许本次操作</button><button class="text-button" data-runtime-deny="${escape(a.id)}">拒绝</button></div></article>`).join('')||'<p class="form-note">当前没有等待确认的工具调用。操作请求两分钟后自动拒绝。</p>';}
export const approvalCount=()=>runs.approvals.length;
export async function showProviders(){try{catalog=await serverApi('/api/execution/config');ui.open('模型与服务商','执行凭据保留在你的服务器上',`${catalog.providers.map(p=>`<div class="provider-row"><span><strong>${escape(p.name)}</strong><small>${escape(p.kind)} · ${p.models.length} 个模型</small></span><span>已授权</span></div>`).join('')||'<p class="form-note">请先在电脑端明确授权所需服务商。</p>'}<p class="form-note">手机可在聊天顶部切换模型。服务商地址与 Key 在电脑端管理，修改后重新保存服务器授权。</p>`);}catch(e){ui.toast(e.message);}}
export async function showCloud(){
 try{catalog=await serverApi('/api/execution/config');if(!catalog.cloud)throw new Error('请在电脑端授权云电脑连接');const status=await serverApi('/api/cloud/status');
 ui.open('云电脑','通过自己的服务器连接，无需原电脑在线',`<div class="runtime-cloud"><strong>${escape(catalog.cloud.machineName||'云电脑')}</strong><p>状态：${escape(status.state)} · ${escape(status.machine?.state||'')}</p><p>目录：${escape(catalog.cloud.remoteWorkspaceDir||'/data/moyubot')}</p><div class="runtime-actions"><button class="primary-button" data-runtime-cloud="wake">唤醒</button><button class="text-button" data-runtime-cloud="suspend">休眠</button></div><p class="form-note">文件、命令和写入通过已授权的云电脑执行。此处不会访问原电脑的本地磁盘。</p><form id="runtime-read"><label class="field-label" for="runtime-path">文本文件路径</label><input class="sheet-input" id="runtime-path" name="path" placeholder="/data/moyubot/notes.txt" required/><button class="text-button" type="submit">读取文件</button></form><form id="runtime-write"><label class="field-label">写入路径<input class="sheet-input" name="path" required placeholder="/data/moyubot/notes.txt"/></label><label class="field-label">文件内容<textarea class="sheet-input" name="content" rows="4" required></textarea></label><label><input type="checkbox" name="confirmed" required/> 我确认覆盖此路径的文件</label><button class="text-button" type="submit">确认写入</button></form><form id="runtime-exec"><label class="field-label">执行命令<textarea class="sheet-input" name="cmd" required rows="3" placeholder="pwd"></textarea></label><label><input type="checkbox" name="confirmed" required/> 我确认在云电脑执行以上命令</label><button class="text-button" type="submit">执行命令</button></form><pre id="runtime-result" role="status"></pre></div>`);
 }catch(e){ui.toast(e.message);}
}
document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-runtime-bot],[data-runtime-approve],[data-runtime-deny],[data-runtime-cloud],[data-runtime-retry]');if(!el||el.disabled)return;
 el.disabled=true;try{
  if(el.dataset.runtimeRetry){const job=jobs.find(j=>j.requestId===el.dataset.runtimeRetry);if(job){const bot=values('bots').find(b=>b.id===job.botId);job.providerId=bot?.providerId;job.model=bot?.model;delete job.error;await localExecutionData(jobs);await sendQueued();ui.refresh();}}
  else if(el.dataset.runtimeBot){const bot=values('bots').find(b=>b.id===el.dataset.runtimeBot);put('bots',bot.id,{...bot,providerId:el.dataset.provider,model:el.dataset.model,updatedAt:Date.now()});ui.close();ui.refresh();ui.toast('已选择 '+el.dataset.model);}
  else if(el.dataset.runtimeApprove||el.dataset.runtimeDeny){await serverApi('/api/chat/approve',{id:el.dataset.runtimeApprove||el.dataset.runtimeDeny,allow:!!el.dataset.runtimeApprove});await refresh();renderApprovals();}
  else {await serverApi('/api/cloud/action',{action:el.dataset.runtimeCloud});await showCloud();}
 }catch(e){ui.toast(e.message);}finally{el.disabled=false;}
});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!['runtime-read','runtime-write','runtime-exec'].includes(form.id))return;event.preventDefault();
 const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
 const output=document.querySelector('#runtime-result');output.textContent='正在连接云电脑…';
 try{const data=Object.fromEntries(new FormData(form));data.confirmed=data.confirmed==='on';const result=await serverApi('/api/cloud/'+form.id.slice(8),data);output.textContent=result.content??(result.stdout!==undefined?`${result.stdout}\n${result.stderr}\n退出码：${result.exitCode}`:'文件已保存');}catch(e){output.textContent=e.message;}finally{button.disabled=false;}
});
