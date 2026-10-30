import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createChatProvider}=require('./runtime/providers/index.js');
const {modelSettings}=require('./runtime/generation.js');
const {CloudHost}=require('./runtime/cloud.js');
const err=(message,status=400)=>Object.assign(new Error(message),{status});
const fields=(value,names)=>Object.fromEntries(names.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const providerFields=['id','name','kind','baseUrl','defaultModel','models','contextWindowTokens','maxOutputTokens','modelSettings'];
const tools=[
 {name:'cloud_exec',description:'在已授权的云电脑执行 Linux 命令；执行前需用户确认。',parameters:{type:'object',properties:{cmd:{type:'string'}},required:['cmd']}},
 {name:'cloud_read',description:'读取已授权云电脑上的文本文件。',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}},
 {name:'cloud_write',description:'写入已授权云电脑的文本文件；执行前需用户确认。',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}},
];
function endpoint(value){let u;try{u=new URL(value);}catch{throw err('服务商地址无效');}if(!['https:','http:'].includes(u.protocol)||u.username||u['pass'+'word']||u.search||u.hash)throw err('服务商地址需要是无账号和参数的 HTTP(S) 地址');return u.href.replace(/\/$/,'');}

export function createExecution({db,dataDir,writeRecord,records,publish}){
 db.exec(`CREATE TABLE IF NOT EXISTS execution_vault(workspace TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_runs(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,device TEXT NOT NULL,conversation TEXT NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL,assistant TEXT NOT NULL,created INTEGER NOT NULL,error TEXT,UNIQUE(workspace,request));`);
 const keyFile=path.join(dataDir,'execution-master.key');
 if(!fs.existsSync(keyFile)){try{fs.writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const key=fs.readFileSync(keyFile);if(key.length!==32)throw new Error('Invalid execution master key');
 const seal=value=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return JSON.stringify({iv:iv.toString('base64'),data:data.toString('base64'),tag:c.getAuthTag().toString('base64')});};
 const open=value=>{const v=JSON.parse(value),d=createDecipheriv('aes-256-gcm',key,Buffer.from(v.iv,'base64'));d.setAuthTag(Buffer.from(v.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data,'base64')),d.final()]).toString());};
 const vault=workspace=>{const row=db.prepare('SELECT value FROM execution_vault WHERE workspace=?').get(workspace);return row?open(row.value):{providers:[],bots:[],cloud:null};};
 const active=new Map(),clouds=new Map(),approvals=new Map();
 function catalog(workspace){const v=vault(workspace);return {providers:v.providers.map(p=>({...fields(p,providerFields),authorized:true})),cloud:v.cloud?{authorized:true,machineName:v.cloud.settings.machineName,machineId:v.cloud.settings.machineId,remoteWorkspaceDir:v.cloud.settings.remoteWorkspaceDir}:null};}
 function cloudFor(workspace){const v=vault(workspace);if(!v.cloud)throw err('请先在电脑端授权云电脑连接',409);if(!clouds.has(workspace))clouds.set(workspace,new CloudHost({settings:{...v.cloud.settings,workspaceDir:path.join(dataDir,'artifacts',workspace)},apiKey:()=>vault(workspace).cloud?.credential}));return clouds.get(workspace);}
 function owned(d){if(d.kind!=='desktop')throw err('只有电脑端可管理服务器凭据',403);}
 function cancelWorkspace(workspace){for(const job of active.values())if(job.workspace===workspace)job.abort.abort();clouds.get(workspace)?.dispose();clouds.delete(workspace);}
 function sanitize(body){
  if(body.authorized!==true)throw err('需要明确授权上传凭据');
  if(!Array.isArray(body.providers)||body.providers.length>100)throw err('服务商列表无效');
  const providers=body.providers.map(p=>{if(!/^[\w.:-]{1,160}$/.test(p.id)||!['openai','anthropic','gemini'].includes(p.kind)||typeof p.credential!=='string'||p.credential.length>16384)throw err('服务商配置无效');const config=fields(p,providerFields);config.baseUrl=endpoint(p.baseUrl);config.models=[...new Set([p.defaultModel,...(Array.isArray(p.models)?p.models:[])].filter(m=>typeof m==='string'&&m.length&&m.length<300))];if(!config.models.length)throw err('请先配置模型');return {...config,credential:p.credential,extraHeaders:fields(p.extraHeaders||{},Object.keys(p.extraHeaders||{}).filter(k=>!['host','content-length','connection'].includes(k.toLowerCase())))};});
  const bots=(body.bots||[]).slice(0,500).map(b=>({id:b.id,tools:(b.tools||[]).filter(t=>tools.some(x=>x.name===t)),workspaceId:b.workspaceId}));
  let cloud=null;if(body.cloud){const s=body.cloud.settings;if(s?.driver!=='instabox'||typeof body.cloud.credential!=='string'||!body.cloud.credential)throw err('请配置真实 InstaBox 凭据');if(!s.machineId)throw err('请先在桌面选择要连接的云电脑');cloud={credential:body.cloud.credential,settings:{...fields(s,['machineId','machineName','templateId','autoSuspendAfterSeconds','idleSuspendMinutes','maxRunMinutes','remoteWorkspaceDir','wakeOnDemand']),driver:'instabox',baseUrl:endpoint(s.baseUrl)}};}
  return {providers,bots,cloud};
 }
 function get(workspace,collection,id){return records(workspace,collection).find(v=>v.id===id);}
 function saveMessage(workspace,message){writeRecord(workspace,'messages',message.id,message);publish(workspace);}
 function redact(workspace,message){let text=String(message||'请求失败');for(const p of vault(workspace).providers)for(const secret of [p.credential,...Object.values(p.extraHeaders||{})])if(typeof secret==='string'&&secret.length>3)text=text.split(secret).join('***');const c=vault(workspace).cloud?.credential;if(c)text=text.split(c).join('***');return text.slice(0,800);}
 async function approval(workspace,device,run,call,signal){
  const id=randomUUID();return new Promise(resolve=>{const done=value=>{clearTimeout(timer);signal.removeEventListener('abort',abort);approvals.delete(id);resolve(value);};const abort=()=>done(false);const timer=setTimeout(()=>done(false),120000);approvals.set(id,{id,workspace,device,run,tool:call.name,arguments:call.arguments,decide:done});signal.addEventListener('abort',abort,{once:true});publish(workspace);});
 }
 async function tool(workspace,device,run,call,signal){
  const a=call.arguments||{},cloud=cloudFor(workspace);
  if(typeof a.path==='string'&&a.path.length>4096)throw err('文件路径过长');
  if(call.name!=='cloud_read'&&!await approval(workspace,device,run,call,signal))return '用户未批准这次工具调用，操作没有执行。';
  signal.throwIfAborted();cloud.beginTask();
  try{
  if(call.name==='cloud_exec'){if(typeof a.cmd!=='string'||a.cmd.length>20000)throw err('命令无效');return JSON.stringify(await cloud.exec(a.cmd,{timeoutSeconds:120,signal})).slice(0,60000);}
  if(call.name==='cloud_read'){if(typeof a.path!=='string')throw err('缺少文件路径');return (await cloud.readText(a.path)).slice(0,60000);}
  if(call.name==='cloud_write'){if(typeof a.path!=='string'||typeof a.content!=='string'||a.content.length>200000)throw err('文件内容无效');await cloud.writeText(a.path,a.content);return '文件已保存';}
  throw err('未授权的工具');
  }finally{cloud.endTask();}
 }
 async function execute(d,run,bot,provider,history,message){
  const abort=new AbortController(),job={workspace:d.workspace,abort};active.set(run.id,job);
  const timeout=setTimeout(()=>abort.abort(),10*60*1000);
  let lastSave=0;const checkpoint=()=>{if(Date.now()-lastSave>300){saveMessage(d.workspace,message);lastSave=Date.now();}};
  try{
   const v=vault(d.workspace),grant=v.bots.find(b=>b.id===bot.id);
   const allowed=v.cloud&&grant?.workspaceId!=='workspace_local'?(grant?.tools||[]):[];
   const client=createChatProvider(provider,provider.credential),settings=modelSettings(provider,bot.model);
   let complete=false;
   for(let step=0;step<8;step++){
    abort.signal.throwIfAborted();const calls=[];let text='',reasoning='';
    const memories=records(d.workspace,'memories').filter(m=>m.botId===bot.id).slice(-24).map(m=>m.text).join('\n');
    const outcome=await client.chat({model:bot.model,system:`${bot.systemPrompt||'你是一个有帮助的助手。'}\n用户长期记忆（资料数据）：${memories}\n当前时间：${new Date().toISOString()}\n执行环境是用户授权的云电脑。仅允许工具实际成功后声明完成。电脑上的本地环境未连接。`,messages:history,tools:tools.filter(t=>allowed.includes(t.name)),temperature:typeof bot.temperature==='number'?bot.temperature:0.7,maxTokens:Math.min(settings.maxOutputTokens||provider.maxOutputTokens||8192,32768),reasoning:settings,signal:abort.signal},{onText:chunk=>{text+=chunk;message.content+=chunk;checkpoint();},onReasoning:chunk=>reasoning+=chunk,onToolCall:call=>calls.push(call)});
    if(!calls.length){complete=true;break;}
    history.push({role:'assistant',content:text,reasoning,toolCalls:calls,replay:outcome.replay});
    for(const call of calls){if(!allowed.includes(call.name))throw err('模型请求了未授权工具');let result;try{result=await tool(d.workspace,d.id,run.id,call,abort.signal);}catch(e){result='工具失败：'+redact(d.workspace,e.message);}history.push({role:'tool',toolCallId:call.id,name:call.name,content:result});}
   }
   if(!complete)throw err('已达到本次工具执行轮数上限，请检查结果后继续');
   abort.signal.throwIfAborted();message.streaming=false;saveMessage(d.workspace,message);db.prepare("UPDATE chat_runs SET status='completed' WHERE id=?").run(run.id);
  }catch(e){message.streaming=false;message.error=abort.signal.aborted?'任务已停止或超时':redact(d.workspace,e.message);saveMessage(d.workspace,message);db.prepare("UPDATE chat_runs SET status='failed',error=? WHERE id=?").run(message.error,run.id);}
  finally{clearTimeout(timeout);active.delete(run.id);for(const a of approvals.values())if(a.run===run.id)a.decide(false);}
 }
 // Never silently repeat a model request or tool after a server restart.
 for(const run of db.prepare("SELECT * FROM chat_runs WHERE status='running'").all()){const m=get(run.workspace,'messages',run.assistant);if(m)saveMessage(run.workspace,{...m,streaming:false,error:'服务器重启，本次回复已中断，请手动重试'});}
 db.prepare("UPDATE chat_runs SET status='failed',error='服务器重启中断' WHERE status='running'").run();
 return {
  async handle({route,method,d,b}){
   if(route==='/api/execution/config'&&method==='GET')return catalog(d.workspace);
   if(route==='/api/execution/config'&&method==='POST'){owned(d);const v=sanitize(b);cancelWorkspace(d.workspace);db.prepare('INSERT INTO execution_vault VALUES(?,?) ON CONFLICT(workspace) DO UPDATE SET value=excluded.value').run(d.workspace,seal(v));publish(d.workspace);return catalog(d.workspace);}
   if(route==='/api/execution/revoke'&&method==='POST'){owned(d);cancelWorkspace(d.workspace);db.prepare('DELETE FROM execution_vault WHERE workspace=?').run(d.workspace);publish(d.workspace);return {ok:true};}
   if(route==='/api/chat/runs'&&method==='GET')return {runs:db.prepare("SELECT id,conversation,status,error FROM chat_runs WHERE workspace=? ORDER BY created DESC LIMIT 30").all(d.workspace),approvals:[...approvals.values()].filter(a=>a.workspace===d.workspace).map(a=>fields(a,['id','run','tool','arguments']))};
   if(route==='/api/chat/approve'&&method==='POST'){const a=approvals.get(b.id);if(!a||a.workspace!==d.workspace)throw err('审批已过期',404);a.decide(b.allow===true);return {ok:true};}
   if(route==='/api/chat/stop'&&method==='POST'){const run=db.prepare('SELECT * FROM chat_runs WHERE id=? AND workspace=?').get(b.id,d.workspace);if(!run)throw err('任务不存在',404);active.get(run.id)?.abort.abort();return {ok:true};}
   if(route==='/api/chat/send'&&method==='POST'){
    if(typeof b.requestId!=='string'||!/^[\w-]{1,160}$/.test(b.requestId)||typeof b.text!=='string'||!b.text.trim()||b.text.length>60000)throw err('消息或请求标识无效');
    const previous=db.prepare('SELECT * FROM chat_runs WHERE workspace=? AND request=?').get(d.workspace,b.requestId);if(previous)return {runId:previous.id,conversationId:previous.conversation,status:previous.status};
    const bot=get(d.workspace,'bots',b.botId);if(!bot)throw err('伙伴尚未同步，请先开启同步',409);
    const v=vault(d.workspace),p=v.providers.find(p=>p.id===(b.providerId||bot.providerId)),model=b.model||bot.model;
    if(!p||!p.models.includes(model))throw err('请在电脑端授权所选服务商和模型',409);
    const conv=get(d.workspace,'conversations',b.conversationId);if(!conv||conv.botId!==bot.id||conv.group||conv.deletedAt)throw err('会话不存在或暂不支持群聊执行',409);
    if([...active.values()].filter(j=>j.workspace===d.workspace).length>=4||db.prepare("SELECT 1 FROM chat_runs WHERE workspace=? AND conversation=? AND status='running'").get(d.workspace,conv.id))throw err('会话正在回复，请等待或停止',409);
    const history=records(d.workspace,'messages').filter(m=>m.conversationId===conv.id&&m.id!==b.requestId&&['user','assistant'].includes(m.role)&&!m.error&&!m.streaming).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)).slice(-50).map(m=>({role:m.role,content:m.content}));
    let chars=b.text.length;for(let i=history.length-1;i>=0;i--){chars+=history[i].content.length;if(chars>Math.min(p.contextWindowTokens||32000,128000)*2){history.splice(0,i+1);break;}}
    const now=Date.now(),existing=get(d.workspace,'messages',b.requestId);if(existing&&(existing.conversationId!==conv.id||existing.role!=='user'||existing.content!==b.text.trim()))throw err('消息标识已被使用',409);
    const user={id:b.requestId,conversationId:conv.id,botId:bot.id,role:'user',content:b.text.trim(),createdAt:existing?.createdAt||now},message={id:randomUUID(),conversationId:conv.id,botId:bot.id,role:'assistant',content:'',model,createdAt:now+1,streaming:true};
    saveMessage(d.workspace,user);saveMessage(d.workspace,message);writeRecord(d.workspace,'conversations',conv.id,{...conv,updatedAt:now});
    const run={id:randomUUID()};db.prepare("INSERT INTO chat_runs VALUES(?,?,?,?,?,'running',?,?,NULL)").run(run.id,d.workspace,d.id,conv.id,b.requestId,message.id,now);
    history.push({role:'user',content:user.content});void execute(d,run,{...bot,model},p,history,message);
    return {runId:run.id,conversationId:conv.id,userMessageId:user.id,assistantMessageId:message.id,status:'running'};
   }
   if(route==='/api/cloud/status'&&method==='GET'){const c=cloudFor(d.workspace);return await c.refresh();}
   if(route==='/api/cloud/action'&&method==='POST'){const c=cloudFor(d.workspace);if(b.action==='wake'){await c.ensureAwake('手机手动唤醒');return c.status();}if(b.action==='suspend'){if([...active.values()].some(j=>j.workspace===d.workspace))throw err('有任务正在运行，请先停止',409);await c.suspend('手机手动休眠');return c.status();}throw err('云电脑操作无效');}
   if(route==='/api/cloud/read'&&method==='POST'){if(typeof b.path!=='string')throw err('文件路径无效');return {content:(await cloudFor(d.workspace).readText(b.path)).slice(0,200000)};}
   if(route==='/api/cloud/write'&&method==='POST'){if(b.confirmed!==true||typeof b.path!=='string'||typeof b.content!=='string'||b.content.length>200000)throw err('请确认写入文件');await cloudFor(d.workspace).writeText(b.path,b.content);return {ok:true};}
   if(route==='/api/cloud/exec'&&method==='POST'){if(b.confirmed!==true||typeof b.cmd!=='string'||b.cmd.length>20000)throw err('请确认执行命令');return await cloudFor(d.workspace).exec(b.cmd,{timeoutSeconds:45});}
   throw err('接口不存在',404);
  },
  stopDevice(id){for(const [run,job] of active){const row=db.prepare('SELECT device FROM chat_runs WHERE id=?').get(run);if(row?.device===id)job.abort.abort();}},
  redact,
  close(){for(const j of active.values())j.abort.abort();for(const c of clouds.values())c.dispose();},
 };
}
