import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createExecution } from './execution.mjs';

const dataDir = process.env.DATA_DIR || path.join(fileURLToPath(new URL('.',import.meta.url)), 'data');
fs.mkdirSync(dataDir,{recursive:true});
const db = new DatabaseSync(path.join(dataDir,'sync.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,token TEXT UNIQUE NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,created INTEGER NOT NULL,seen INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,owner TEXT NOT NULL,secret TEXT NOT NULL,expires INTEGER NOT NULL,device TEXT,claim TEXT,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(workspace TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,PRIMARY KEY(workspace,collection,id));
CREATE TABLE IF NOT EXISTS events(revision INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,value TEXT);
CREATE INDEX IF NOT EXISTS events_workspace_revision ON events(workspace,revision);
CREATE TABLE IF NOT EXISTS operations(workspace TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(workspace,id));`);
const token=()=>randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const configuredOrigin=process.env.PUBLIC_ORIGIN?.trim() || '';
const syncEnabled=process.env.SYNC_ENABLED==='true';
const setupKey=process.env.SYNC_SETUP_KEY || '';
let origin='http://localhost';
if(configuredOrigin){
 const url=new URL(configuredOrigin);
 if(url.username || url["pass"+"word"]||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw new Error('PUBLIC_ORIGIN must be an origin without credentials or path');
 if(url.protocol!=='https:'&&!['localhost',[127,0,0,1].join('.'),'[::1]'].includes(url.hostname))throw new Error('PUBLIC_ORIGIN requires HTTPS');
 origin=url.origin;
}
if(syncEnabled&&(!configuredOrigin||setupKey.length<32))throw new Error('Private sync requires PUBLIC_ORIGIN and a SYNC_SETUP_KEY of at least 32 characters');
const listeners=new Map();
const limits=new Map();
const collections=new Set(['bots','conversations','messages','memories','schedules','profile']);
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(v);
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function auth(req){const raw=req.headers.authorization?.replace(/^Bearer /,'');if(!raw)fail('请先连接设备',401);const d=db.prepare('SELECT * FROM devices WHERE token=? AND revoked=0').get(hash(raw));if(!d)fail('连接已失效，请重新扫码',401);db.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now(),d.id);return d;}
async function body(req){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)fail('本次同步内容过大',413);parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail('无效的 JSON');}}
function publish(workspace){for(const response of listeners.get(workspace)||[])response.write('event: change\ndata: {}\n\n');}
function cleanValue(collection,value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))fail('无效的同步内容');
  if(JSON.stringify(value).length>512*1024)fail('单条内容过大',413);
  // Secrets and tool grants use the separate, desktop-authorized encrypted vault.
  const fields={bots:['id','name','handle','avatar','model','providerId','systemPrompt','temperature','workspaceId','createdAt','updatedAt','sidebar'],conversations:['id','botId','workspaceId','title','group','createdAt','updatedAt','deletedAt'],messages:['id','conversationId','botId','botName','role','content','createdAt','model','error','stopped','streaming'],memories:['id','botId','text','pinned','createdAt','source'],schedules:['id','botId','title','prompt','cron','runAt','kind','enabled','createdAt','updatedAt','lastStatus','lastRunAt','nextRunAt','closedAt','completedAt'],profile:['userName']};
  const out=Object.fromEntries(fields[collection].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
  if(collection==='bots'&&out.avatar){const a=out.avatar;out.avatar=Object.fromEntries(['shape','from','to','glyph'].filter(k=>typeof a[k]==='string').map(k=>[k,a[k]]));}
  if(collection==='messages'&&!['user','assistant','system','tool'].includes(out.role))fail('无效的消息角色');
  return JSON.stringify(out);
}
const execution=createExecution({db,dataDir,publish,
 records:(workspace,collection)=>db.prepare('SELECT value FROM records WHERE workspace=? AND collection=? AND value IS NOT NULL').all(workspace,collection).map(r=>JSON.parse(r.value)),
 writeRecord:(workspace,collection,id,raw)=>{const value=cleanValue(collection,raw);db.exec('BEGIN IMMEDIATE');try{const event=db.prepare('INSERT INTO events(workspace,collection,id,value) VALUES(?,?,?,?)').run(workspace,collection,id,value);db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(workspace,collection,id) DO UPDATE SET value=excluded.value,revision=excluded.revision').run(workspace,collection,id,value,Number(event.lastInsertRowid));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},
});
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,origin);const route=url.pathname;const method=req.method;
  const requestOrigin=req.headers.origin;
  if(requestOrigin&&requestOrigin!==origin)fail('不允许的来源',403);
  if(route==='/api/health'&&method==='GET')return json(res,200,{ok:true,service:'moyubot-sync',version:2,syncEnabled,executionEnabled:syncEnabled});
  if(!syncEnabled)fail('此站点仅供界面预览。请部署自己的同步服务器后连接。',503);
  const address=req.headers.authorization?hash(req.headers.authorization):String(req.headers['x-real-ip']||req.socket.remoteAddress||'');const now=Date.now();const bucket=limits.get(address)||{count:0,start:now};if(now-bucket.start>60000){bucket.count=0;bucket.start=now;}if(++bucket.count>600)fail('请求太频繁，请稍后重试',429);limits.set(address,bucket);
  if(route==='/api/workspaces'&&method==='POST'){
    if(!equal(hash(req.headers['x-setup-key']||''),hash(setupKey)))fail('服务器连接密钥不正确',403);
    if(bucket.count>30)fail('创建连接太频繁',429);
    const b=await body(req);const workspace=randomBytes(16).toString('hex'),id=randomBytes(16).toString('hex'),credential=token();
    db.prepare('INSERT INTO workspaces VALUES(?,?)').run(workspace,now);
    db.prepare('INSERT INTO devices(id,workspace,token,name,kind,created,seen) VALUES(?,?,?,?,?,?,?)').run(id,workspace,hash(credential),String(b.name||'MoyuBot 桌面端').slice(0,80),'desktop',now,now);
    return json(res,201,{workspace,deviceId:id,token:credential});
  }
  if(route==='/api/pair/claim'&&method==='POST'){
    const b=await body(req);const p=db.prepare('SELECT * FROM pairs WHERE id=?').get(String(b.id));
    if(!p||p.expires<now||p.status!=='pending'||!equal(p.secret,hash(b.secret)))fail('二维码已过期或已使用，请在电脑上刷新',410);
    const id=randomBytes(16).toString('hex'),claim=token(),credential=token();
    db.exec('BEGIN IMMEDIATE');try{
      const result=db.prepare("UPDATE pairs SET status='claimed',device=?,claim=? WHERE id=? AND status='pending'").run(id,hash(claim),p.id);if(result.changes!==1)fail('二维码已使用',410);
      db.prepare('INSERT INTO devices(id,workspace,token,name,kind,created,seen,revoked) VALUES(?,?,?,?,?,?,?,1)').run(id,p.workspace,hash(credential),String(b.name||'手机 PWA').slice(0,80),'mobile',now,now);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{id:p.id,claim,token:credential,deviceId:id,workspace:p.workspace,expires:p.expires});
  }
  if(route==='/api/pair/status'&&method==='POST'){
    const b=await body(req);const p=db.prepare('SELECT * FROM pairs WHERE id=?').get(String(b.id));
    if(!p||p.expires<now||!equal(p.claim,hash(b.claim)))fail('连接请求已过期',410);
    return json(res,200,{status:p.status});
  }
  const d=auth(req);
  if(['/api/execution/','/api/chat/','/api/cloud/'].some(prefix=>route.startsWith(prefix))){try{const result=await execution.handle({route,method,d,b:method==='POST'?await body(req):{}});return json(res,200,result);}catch(e){throw Object.assign(new Error(execution.redact(d.workspace,e.message)),{status:e.status||500});}}
  if(route==='/api/pair'&&method==='POST'){
    const id=randomBytes(16).toString('hex'),secret=token(),expires=now+180000;
    db.prepare("UPDATE pairs SET status='expired' WHERE owner=? AND status IN ('pending','claimed')").run(d.id);
    db.prepare('INSERT INTO pairs(id,workspace,owner,secret,expires,status) VALUES(?,?,?,?,?,?)').run(id,d.workspace,d.id,hash(secret),expires,'pending');
    return json(res,201,{id,expires,url:`${origin}/#pair=${id}.${secret}`});
  }
  if(route==='/api/pair/pending'&&method==='GET')return json(res,200,{pairs:db.prepare("SELECT p.id,p.expires,p.status,d.name,d.id AS deviceId FROM pairs p LEFT JOIN devices d ON d.id=p.device WHERE p.owner=? AND p.expires>? AND p.status IN ('pending','claimed')").all(d.id,now)});
  if(route==='/api/pair/confirm'&&method==='POST'){
    const b=await body(req);const p=db.prepare('SELECT * FROM pairs WHERE id=? AND owner=?').get(String(b.id),d.id);if(!p||p.expires<now||p.status!=='claimed')fail('连接请求已过期',410);
    db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE devices SET revoked=0 WHERE id=?').run(p.device);db.prepare("UPDATE pairs SET status='approved' WHERE id=?").run(p.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{ok:true});
  }
  if(route==='/api/devices'&&method==='GET')return json(res,200,{devices:db.prepare('SELECT id,name,kind,created,seen FROM devices WHERE workspace=? AND revoked=0').all(d.workspace)});
  if(route==='/api/devices/revoke'&&method==='POST'){const b=await body(req);if(d.kind!=='desktop'&&b.id!==d.id)fail('手机只能退出本机连接',403);db.prepare('UPDATE devices SET revoked=1 WHERE id=? AND workspace=?').run(String(b.id),d.workspace);execution.stopDevice(String(b.id));publish(d.workspace);return json(res,200,{ok:true});}
  if(route==='/api/events'&&method==='GET'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});res.write('event: ready\ndata: {}\n\n');
    const set=listeners.get(d.workspace)||new Set();set.add(res);listeners.set(d.workspace,set);const timer=setInterval(()=>{const valid=db.prepare('SELECT revoked FROM devices WHERE id=?').get(d.id);if(!valid||valid.revoked){res.end();return;}res.write(': keepalive\n\n');},25000);req.on('close',()=>{clearInterval(timer);set.delete(res);if(!set.size)listeners.delete(d.workspace);});return;
  }
  if(route==='/api/sync'&&method==='POST'){
    const b=await body(req);const changes=b.changes||[];if(!Array.isArray(changes)||changes.length>250)fail('单次最多同步 250 条');
    const accepted=[],conflicts=[];let updated=false;
    db.exec('BEGIN IMMEDIATE');try{
      for(const change of changes){
        const {collection,id,opId}=change;if(!collections.has(collection)||!identifier(id)||!identifier(opId))fail('无效的同步条目');
        if(db.prepare('SELECT 1 FROM operations WHERE workspace=? AND id=?').get(d.workspace,opId)){accepted.push(opId);continue;}
        const value=cleanValue(collection,change.value);const current=db.prepare('SELECT * FROM records WHERE workspace=? AND collection=? AND id=?').get(d.workspace,collection,id);
        if((current?.revision||0)!==(change.baseRevision||0)&&current?.value!==value){conflicts.push({collection,id,value:current?.value?JSON.parse(current.value):null,revision:current?.revision||0});continue;}
        if(current?.value!==value){const result=db.prepare('INSERT INTO events(workspace,collection,id,value) VALUES(?,?,?,?)').run(d.workspace,collection,id,value);const revision=Number(result.lastInsertRowid);db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(workspace,collection,id) DO UPDATE SET value=excluded.value,revision=excluded.revision').run(d.workspace,collection,id,value,revision);updated=true;}
        db.prepare('INSERT INTO operations VALUES(?,?)').run(d.workspace,opId);accepted.push(opId);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    const cursor=Number(b.cursor)||0;const rows=db.prepare('SELECT * FROM events WHERE workspace=? AND revision>? ORDER BY revision LIMIT 1000').all(d.workspace,cursor);
    const latest=rows.at(-1)?.revision||cursor;
    if(updated)publish(d.workspace);
    return json(res,200,{accepted,conflicts,cursor:latest,hasMore:rows.length===1000,records:rows.map(r=>({collection:r.collection,id:r.id,value:r.value?JSON.parse(r.value):null,revision:r.revision}))});
  }
  fail('接口不存在',404);
 }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?'请求未完成：'+String(error.message).slice(0,800):'服务暂时不可用'});else res.end();}
});
setInterval(()=>{const now=Date.now();for(const [key,bucket]of limits)if(now-bucket.start>120000)limits.delete(key);db.prepare('DELETE FROM pairs WHERE expires<?').run(now-86400000);},60000).unref();
server.listen(Number(process.env.PORT)||8081,[0,0,0,0].join(String.fromCharCode(46)),()=>console.log('MoyuBot sync service ready'));
process.on('SIGTERM',()=>{execution.close();for(const set of listeners.values())for(const res of set)res.end();server.close(()=>{db.close();process.exit(0);});});
