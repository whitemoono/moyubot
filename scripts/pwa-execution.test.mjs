import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const dir=path.resolve('.work/execution-tests',String(Date.now()));fs.mkdirSync(dir,{recursive:true});
test('private model execution, encrypted credentials, isolated devices, tool approval and restart',async t=>{
 let providerCalls=0,commands=[],storedFile='initial',machineState='running';const received=[];
 const fake=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),u=new URL(req.url,'http://localhost');
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(u.pathname==='/anthropic/v1/messages'){
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [event,data]of [['message_start',{type:'message_start',message:{id:'test',type:'message',role:'assistant',model:'test-model',content:[],usage:{input_tokens:2,output_tokens:0}}}],['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'anthropic response'}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}}],['message_stop',{type:'message_stop'}]])res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');res.end();return;
  }
  if(u.pathname.startsWith('/gemini/models/')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({candidates:[{index:0,content:{role:'model',parts:[{text:'gemini response'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:2,candidatesTokenCount:2,totalTokenCount:4}})+'\n\n');return;}
  if(u.pathname==='/v1/chat/completions'){
   const b=JSON.parse(raw);received.push({body:b,auth:req.headers.authorization});providerCalls++;
   const toolResult=b.messages.findLast(m=>m.role==='tool');const last=b.messages.findLast(m=>m.role==='user')?.content;
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   if(last==='slow'){await pause(1500);}
   if(last==='tool'&&!toolResult){res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'tool1',type:'function',function:{name:'cloud_exec',arguments:JSON.stringify({cmd:'echo approved'})}}]},finish_reason:'tool_calls'}]})+'\n\n');}
   else {res.write('data: '+JSON.stringify({choices:[{delta:{content:toolResult?'tool finished':'actual model response'},finish_reason:'stop'}]})+'\n\n');}
   res.end('data: [DONE]\n\n');return;
  }
  assert.equal(req.headers['x-api-key'],'test-cloud-secret-000000');
  if(u.pathname==='/v1/machines/test-machine'&&(req.method==='GET'||req.method==='PATCH'))return json({id:'test-machine',name:'Test machine',state:machineState,autoSuspendAfterSeconds:600});
  if(u.pathname.endsWith('/exec')){const b=JSON.parse(raw);commands.push(b.cmd);return json({stdout:'cloud command result',stderr:'',exitCode:0});}
  if(u.pathname.endsWith('/files/content')){res.end(storedFile);return;}
  if(u.pathname.endsWith('/files')&&req.method==='PUT'){storedFile=raw;return json({ok:true});}
  if(u.pathname.endsWith('/suspend')){machineState='suspended';return json({id:'op1',state:'succeeded'});}
  if(u.pathname.endsWith('/resume')){machineState='running';return json({id:'op2',state:'succeeded'});}
  if(u.pathname==='/v1/machines')return json({machines:[{id:'test-machine',name:'Test machine',state:machineState,autoSuspendAfterSeconds:600}]});
  res.writeHead(404);res.end('{}');
 });await new Promise(r=>fake.listen(18091,'localhost',r));t.after(()=>fake.close());
 const base='http://localhost:18090',ownerKey='test-owner-0000000000000000000000000000';let child;
 const start=async()=>{child=spawn(process.execPath,['apps/web/server/index.mjs'],{env:{...process.env,PORT:'18090',PUBLIC_ORIGIN:base,SYNC_ENABLED:'true',SYNC_SETUP_KEY:ownerKey,DATA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',c=>log+=c);for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await pause(100);}throw new Error(log);};
 t.after(()=>child?.kill());await start();
 const api=async(route,token,body)=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Setup-Key':ownerKey,...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 const owner=(await api('/api/workspaces',null,{})).data,other=(await api('/api/workspaces',null,{})).data;
 const pair=(await api('/api/pair',owner.token,{})).data;const [id,secret]=new URL(pair.url).hash.slice(6).split('.');const mobile=(await api('/api/pair/claim',null,{id,secret})).data;await api('/api/pair/confirm',owner.token,{id});
 const config={authorized:true,providers:[{id:'test-provider',name:'Test',kind:'openai',baseUrl:'http://localhost:18091/v1',models:['test-model','second-model'],defaultModel:'test-model',credential:'test-provider-secret-000000'}],bots:[{id:'bot1',tools:['cloud_exec','cloud_read','cloud_write'],workspaceId:'workspace_cloud'}],cloud:{credential:'test-cloud-secret-000000',settings:{driver:'instabox',baseUrl:'http://localhost:18091',machineId:'test-machine',machineName:'Test machine',remoteWorkspaceDir:'/data/moyubot',autoSuspendAfterSeconds:600,idleSuspendMinutes:0,wakeOnDemand:true}}};
 assert.equal((await api('/api/execution/config',mobile.token,config)).status,403);
 assert.equal((await api('/api/execution/config',owner.token,{...config,authorized:false})).status,400);
 assert.equal((await api('/api/execution/config',owner.token,config)).status,200);
 const visible=(await api('/api/execution/config',mobile.token)).data;assert.equal(visible.providers[0].models.length,2);assert.ok(!JSON.stringify(visible).includes('secret-'));assert.ok(!JSON.stringify(visible).includes('extraHeaders'));
 assert.equal((await api('/api/execution/config',other.token)).data.providers.length,0);
 const db=new DatabaseSync(path.join(dir,'sync.sqlite'));const encrypted=db.prepare('SELECT value FROM execution_vault').get().value;db.close();assert.ok(!encrypted.includes('test-provider-secret'));assert.ok(!encrypted.includes('test-cloud-secret'));
 const changes=[{collection:'bots',id:'bot1',value:{id:'bot1',name:'Test bot',model:'test-model',providerId:'test-provider',systemPrompt:'Be helpful',workspaceId:'workspace_cloud',createdAt:1,updatedAt:1}},{collection:'conversations',id:'conv1',value:{id:'conv1',botId:'bot1',title:'Test chat',createdAt:1,updatedAt:1}}].map(v=>({...v,opId:crypto.randomUUID(),baseRevision:0}));
 assert.equal((await api('/api/sync',owner.token,{cursor:0,changes})).status,200);
 const send=text=>api('/api/chat/send',mobile.token,{requestId:crypto.randomUUID(),botId:'bot1',conversationId:'conv1',text});
 const waitRun=async runId=>{for(let i=0;i<100;i++){const state=(await api('/api/chat/runs',mobile.token)).data;const run=state.runs.find(r=>r.id===runId);if(run.status!=='running')return run;await pause(40);}throw new Error('Run timeout');};
 const plain=await send('hello');assert.equal(plain.status,200);assert.equal((await waitRun(plain.data.runId)).status,'completed');assert.equal(received[0].auth,'Bearer test-provider-secret-000000');
 const synced=(await api('/api/sync',owner.token,{cursor:0})).data;assert.ok(synced.records.some(r=>r.value?.content==='actual model response'));
 for(const kind of ['anthropic','gemini']){const more={...config,providers:[...config.providers,{...config.providers[0],id:kind,kind,baseUrl:'http://localhost:18091/'+kind}]};await api('/api/execution/config',owner.token,more);const run=await api('/api/chat/send',mobile.token,{requestId:crypto.randomUUID(),botId:'bot1',conversationId:'conv1',text:'hello',providerId:kind,model:'test-model'});assert.equal((await waitRun(run.data.runId)).status,'completed',kind+' protocol');}await api('/api/execution/config',owner.token,config);
 const before=providerCalls;const req={requestId:crypto.randomUUID(),botId:'bot1',conversationId:'conv1',text:'again'};const first=await api('/api/chat/send',mobile.token,req);const duplicate=await api('/api/chat/send',mobile.token,req);assert.equal(duplicate.data.runId,first.data.runId);await waitRun(first.data.runId);assert.equal(providerCalls,before+1);
 const toolRun=await send('tool');let approval;
 for(let i=0;i<60;i++){approval=(await api('/api/chat/runs',mobile.token)).data.approvals[0];if(approval)break;await pause(40);}assert.ok(approval);assert.equal(commands.length,0);
 assert.equal((await api('/api/chat/approve',other.token,{id:approval.id,allow:true})).status,404);
 await api('/api/chat/approve',mobile.token,{id:approval.id,allow:true});assert.equal((await waitRun(toolRun.data.runId)).status,'completed');assert.ok(commands.includes('echo approved'));
 assert.equal((await api('/api/cloud/write',mobile.token,{path:'/data/moyubot/test',content:'updated'})).status,400);
 assert.equal((await api('/api/cloud/write',mobile.token,{path:'/data/moyubot/test',content:'updated',confirmed:true})).status,200);
 assert.equal((await api('/api/cloud/read',mobile.token,{path:'/data/moyubot/test'})).data.content,'updated');
 assert.equal((await api('/api/cloud/status',mobile.token)).data.state,'ready');
 const slow=await send('slow');await api('/api/chat/stop',mobile.token,{id:slow.data.runId});assert.equal((await waitRun(slow.data.runId)).status,'failed');
 child.kill();await new Promise(r=>child.once('exit',r));await start();assert.equal((await api('/api/execution/config',mobile.token)).data.providers.length,1);
 assert.equal((await api('/api/execution/revoke',owner.token,{})).status,200);assert.equal((await send('hello')).status,409);assert.equal((await api('/api/cloud/status',mobile.token)).status,409);
 console.log('Model streaming, key isolation, tool confirmation, file read/write, stop and restart verified with local provider/cloud simulators.');
});
