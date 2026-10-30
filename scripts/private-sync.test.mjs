import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Store,PlainSecretBox,emptySyncState}=require('../packages/core/dist/index.js');
const {MobileSync}=require('../apps/desktop/dist-electron/mobile-sync.js');
const {normalizeSyncServer}=require('../apps/desktop/dist-electron/sync-server.js');
const dir=path.resolve('.work/private-sync-tests',String(Date.now()));fs.mkdirSync(dir,{recursive:true});
test('no default endpoint; legacy connections paused; explicit private server setup and isolation',async()=>{
 const store=new Store(dir,new PlainSecretBox(dir));
 store.secrets.set('mobile:sync-session',JSON.stringify({token:'legacy-device-credential',deviceId:'legacy',workspace:'old'}));
 fs.writeFileSync(path.join(dir,'mobile-sync.json'),JSON.stringify({...emptySyncState(),enabled:true}));
 const originalFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push({url:String(url),headers:options?.headers});
  if(String(url).endsWith('/api/health'))return Response.json({service:'moyubot-sync',syncEnabled:true});
  if(String(url).endsWith('/api/workspaces'))return Response.json({token:'private-device-credential',deviceId:'private',workspace:'mine'});
  if(String(url).endsWith('/api/pair'))return Response.json({url:'https://sync.example.com/#pair=one.secret',expires:Date.now()+1000});
  return Response.json({accepted:[],conflicts:[],records:[],cursor:0});
 };
 let sync;
 try{
  sync=new MobileSync(store,()=>{});sync.start();await new Promise(r=>setTimeout(r,100));
  assert.equal(requests.length,0);assert.equal(sync.status().server,'');assert.equal(sync.status().enabled,false);
  assert.ok(fs.readdirSync(dir).some(n=>n.startsWith('mobile-sync.json.backup-')));
  await assert.rejects(()=>sync.pair(),/先填写/);await assert.rejects(()=>sync.enable(true),/配置/);
  await sync.configure({server:'https://sync.example.com',setupKey:'local-owner-key-000000000000000000000000'});
  assert.equal(sync.status().enabled,false);await sync.pair();
  assert.ok(requests.every(r=>r.url.startsWith('https://sync.example.com/')));
  assert.equal(requests.find(r=>r.url.endsWith('/api/workspaces')).headers['X-Setup-Key'],'local-owner-key-000000000000000000000000');
  const config=fs.readFileSync(path.join(dir,'mobile-sync-server.json'),'utf8');assert.ok(!config.includes('owner-key'));
  sync.client.put('messages','queued',{id:'queued',role:'user',content:'local draft'});
  await sync.configure({server:'https://other.example.com',setupKey:'another-owner-key-00000000000000000000'});
  assert.equal(sync.status().connected,false);assert.equal(sync.status().pending,0);assert.equal(sync.status().enabled,false);
  assert.equal(store.getSettings().bots.length,1);
  for(const bad of ['http://public.example.com','https://sync.example.com/api','https://sync.example.com/?token=abc','ftp://example.com'])assert.throws(()=>normalizeSyncServer(bad));
 }finally{sync?.stop();globalThis.fetch=originalFetch;}
});
test('cloud authorization uses discovered runtime machine when persisted settings lack its id',async()=>{
 const localDir=path.join(dir,'cloud-runtime');fs.mkdirSync(localDir,{recursive:true});
 const store=new Store(localDir,new PlainSecretBox(localDir));
 store.updateSettings({cloud:{driver:'instabox',machineId:undefined}});
 store.secrets.set('cloud:instabox','local-test-cloud-credential');
 let current={...store.getSettings().cloud,machineId:'discovered-machine',machineName:'Current cloud'};
 let refreshes=0,uploaded;
 const host={getSettings:()=>current,refresh:async()=>{refreshes++;current={...current,machineId:'refreshed-machine'};return {state:'ready'};}};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/api/health'))return Response.json({service:'moyubot-sync',syncEnabled:true});
  if(String(url).endsWith('/api/workspaces'))return Response.json({token:'local-test-device',deviceId:'desktop',workspace:'workspace'});
  if(String(url).endsWith('/api/pair'))return Response.json({url:'https://sync.example.com/#pair=test.secret'});
  if(String(url).endsWith('/api/execution/config')){uploaded=JSON.parse(options.body);return Response.json({providers:[],cloud:{authorized:true}});}
  throw new Error('Unexpected network request');
 };
 const sync=new MobileSync(store,()=>{},()=>host);
 try{
  const info=await sync.action('execution-local');assert.equal(info.cloudConfigured,true);assert.equal(info.cloudMachineId,'discovered-machine');
  assert.equal(store.getSettings().cloud.machineId,undefined);
  await sync.configure({server:'https://sync.example.com',setupKey:'local-test-owner-key-00000000000000000'});await sync.pair();
  await sync.action('execution-authorize',{authorized:true,providerIds:[],cloud:true});
  assert.equal(uploaded.cloud.settings.machineId,'discovered-machine');assert.equal(uploaded.cloud.settings.workspaceDir,undefined);assert.equal(refreshes,0);
  current={...current,machineId:undefined};assert.equal((await sync.action('execution-local')).cloudConfigured,true);
  await sync.action('execution-authorize',{authorized:true,providerIds:[],cloud:true});assert.equal(uploaded.cloud.settings.machineId,'refreshed-machine');assert.equal(refreshes,1);
  store.secrets.delete('cloud:instabox');assert.equal((await sync.action('execution-local')).cloudConfigured,false);
 }finally{sync.stop();globalThis.fetch=originalFetch;}
});

test('server default preview mode refuses registration, pairing and upload',async t=>{
 const port=18082,origin=`http://localhost:${port}`;
 const child=spawn(process.execPath,['apps/web/server/index.mjs'],{env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:'',SYNC_ENABLED:'false',SYNC_SETUP_KEY:'',DATA_DIR:path.join(dir,'preview')},stdio:'ignore',windowsHide:true});
 t.after(()=>child.kill());let ready=false;
 for(let i=0;i<50;i++){try{const health=await fetch(origin+'/api/health').then(r=>r.json());assert.equal(health.syncEnabled,false);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 for(const route of ['/api/workspaces','/api/pair/claim','/api/sync'])assert.equal((await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
});
