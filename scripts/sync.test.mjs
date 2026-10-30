import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {SyncClient,emptySyncState,Store,PlainSecretBox}=require('../packages/core/dist/index.js');
const directory=path.resolve('.work/sync-tests',String(Date.now()));fs.mkdirSync(directory,{recursive:true});
const port=18081,origin=`http://localhost:${port}`;
const setupKey='local-test-setup-key-at-least-32-characters';
let child;
async function start(){
 child=spawn(process.execPath,['apps/web/server/index.mjs'],{env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,SYNC_ENABLED:'true',SYNC_SETUP_KEY:setupKey,DATA_DIR:path.join(directory,'server')},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let log='';child.stderr.on('data',d=>log+=d);child.stdout.on('data',d=>log+=d);
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(log);
}
async function stop(){child.kill();await new Promise(r=>child.once('exit',r));}
async function api(route,token,body){const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json','X-Setup-Key':setupKey},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();return {status:r.status,...data};}
async function connect(desktop){
 const pair=await api('/api/pair',desktop.token,{});const [id,secret]=new URL(pair.url).hash.slice(6).split('.');
 const mobile=await api('/api/pair/claim',null,{id,secret,name:'test mobile'});
 assert.equal((await api('/api/sync',mobile.token,{cursor:0})).status,401);
 assert.equal((await api('/api/pair/claim',null,{id,secret})).status,410);
 assert.equal((await api('/api/pair/confirm',desktop.token,{id})).status,200);
 assert.equal((await api('/api/pair/status',null,{id,claim:mobile.claim})).status,'approved');
 return mobile;
}
test('pairing, isolated workspaces, offline bidirectional sync, conflicts and persistence',async t=>{
 await start();t.after(()=>{if(child.exitCode===null)child.kill();});
 const desktop=await api('/api/workspaces',null,{name:'test desktop'}),other=await api('/api/workspaces',null,{name:'other'});
 assert.equal(desktop.status,201);
 assert.equal((await fetch(origin+'/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const mobile=await connect(desktop);
 let aState=emptySyncState(),bState=emptySyncState();aState.enabled=bState.enabled=true;
 const a=new SyncClient(aState,{url:origin,token:()=>desktop.token,save:s=>{aState=structuredClone(s);}});
 const b=new SyncClient(bState,{url:origin,token:()=>mobile.token,save:s=>{bState=structuredClone(s);}});
 a.put('bots','bot1',{id:'bot1',name:'Alice',model:'test',apiKey:'never-upload',tools:['cloud_exec'],avatar:{from:'#999',to:'#aaa',glyph:'A',imageDataUrl:'secret-local'}});
 a.put('conversations','conv1',{id:'conv1',botId:'bot1',title:'chat',createdAt:1,updatedAt:1});
 a.put('messages','msg1',{id:'msg1',conversationId:'conv1',role:'assistant',content:'desktop latest',createdAt:2});
 await a.sync();assert.equal(a.error,'');await b.sync();
 assert.equal(b.values('messages')[0].content,'desktop latest');
 assert.equal(b.values('bots')[0].apiKey,undefined);assert.equal(b.values('bots')[0].tools,undefined);assert.equal(b.values('bots')[0].avatar.imageDataUrl,undefined);
 assert.equal((await api('/api/sync',other.token,{cursor:0})).records.length,0);
 b.setEnabled(false);b.put('messages','msg2',{id:'msg2',conversationId:'conv1',role:'user',content:'mobile while desktop closed',createdAt:3});
 await b.sync();assert.equal(Object.keys(b.state.outbox).length,1);
 // Reopen the mobile client from its durable queue, then let desktop catch up.
 const reopened=new SyncClient(structuredClone(bState),{url:origin,token:()=>mobile.token,save:()=>{}});reopened.state.enabled=true;await reopened.sync();await a.sync();
 assert.equal(a.values('messages').length,2);
 a.put('bots','bot1',{...a.values('bots')[0],name:'Desktop edit'});reopened.put('bots','bot1',{...reopened.values('bots')[0],name:'Mobile edit'});
 await a.sync();await reopened.sync();assert.equal(reopened.state.conflicts.length,1);assert.equal(reopened.values('bots')[0].name,'Desktop edit');
 assert.equal(reopened.state.conflicts[0].record.value.name,'Mobile edit');
 reopened.restoreConflict(0);await new Promise(r=>setTimeout(r,100));await a.sync();assert.equal(a.values('bots')[0].name,'Mobile edit');
 // Duplicate operation replay creates only one event.
 const change={collection:'memories',id:'mem1',opId:'op-fixed',baseRevision:0,value:{id:'mem1',botId:'bot1',text:'remember',createdAt:4,pinned:false}};
 const first=await api('/api/sync',desktop.token,{cursor:0,changes:[change]});const again=await api('/api/sync',desktop.token,{cursor:first.cursor,changes:[change]});assert.equal(again.records.length,0);
 assert.equal((await api('/api/sync',desktop.token,{changes:[{...change,id:'../escape',opId:'bad-op'}]})).status,400);
 const storePath=path.join(directory,'desktop');fs.mkdirSync(storePath,{recursive:true});const store=new Store(storePath,new PlainSecretBox(storePath));
 store.applySyncRecords(Object.values(a.state.records));assert.equal(store.getConversation('conv1').messages.length,2);assert.deepEqual(store.getBot('bot1').tools,[]);
 assert.equal(store.syncSnapshot().find(r=>r.collection==='messages'&&r.id==='msg2').value.content,'mobile while desktop closed');
 await stop();await start();const persisted=await api('/api/sync',desktop.token,{cursor:0});assert.ok(persisted.records.some(r=>r.id==='msg2'));
 await api('/api/devices/revoke',desktop.token,{id:mobile.deviceId});assert.equal((await api('/api/sync',mobile.token,{cursor:0})).status,401);
 await stop();
});
