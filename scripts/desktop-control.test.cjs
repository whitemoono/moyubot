const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ComputerControl, DesktopSessions, InstaBoxClient, runTool, toolNamesFor, defaultSettings } = require('../packages/core/dist');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const events = [], control = new ComputerControl(); let tasks = 0, revokeFailure = false, streamFailure = false;
  const host = {
    control,
    status: () => ({ state: 'ready', machine: { id: 'machine' } }),
    beginTask: () => { tasks++; }, endTask: () => { tasks--; },
    driver: {
      desktopStart: async () => ({ installed: true, running: true }),
      desktopStream: async (_id, viewOnly) => { events.push(viewOnly ? 'view' : 'manual'); if(streamFailure) throw Error('stream unavailable'); return { url: 'https://desktop.example/view', expiresAt: new Date(Date.now()+600000).toISOString() }; },
      desktopRevoke: async () => { events.push('revoke'); if(revokeFailure) throw Error('offline'); },
    },
  };
  const sessions = new DesktopSessions(host, (machine) => events.push(machine ? 'journal-save' : 'journal-clear'));
  return { control, events, sessions, tasks: () => tasks, setRevokeFailure: (value) => revokeFailure = value, setStreamFailure: (value) => streamFailure = value };
}

test('takeover blocks new automatic operations, drains existing work, and cancellation remains effective', async () => {
  const gate = new ComputerControl(), first = await gate.acquire();
  let drained = false;
  const pending = gate.drain().then(() => { drained = true; });
  const abort = new AbortController();
  const waiting = gate.acquire(abort.signal);
  await tick(); assert.equal(drained, false);
  abort.abort(); await assert.rejects(waiting);
  first(); first(); await pending; assert.equal(drained, true);
  let entered = false; const next = gate.acquire().then((release) => { entered = true; return release; });
  await tick(); assert.equal(entered, false); gate.resume(); (await next)();
});

test('readonly is default; return revokes control before allowing all Bots to continue', async () => {
  const f = fixture();
  assert.equal((await f.sessions.open()).mode, 'view'); assert.deepEqual(f.events, ['view']);
  const first = await f.control.acquire(); const take = f.sessions.take();
  await tick(); assert.equal(f.control.paused, true); assert.equal(f.events.includes('manual'), false);
  first(); assert.equal((await take).mode, 'manual'); assert.equal(f.tasks(), 1);
  assert.deepEqual(f.events, ['view', 'journal-save', 'revoke', 'manual']);
  const returned = f.sessions.release(); await tick(); assert.equal(f.control.paused, true);
  assert.equal((await returned).mode, 'view'); assert.equal(f.control.paused, false); assert.equal(f.tasks(), 0);
  assert.deepEqual(f.events.slice(-3), ['revoke', 'journal-clear', 'view']);
  await f.sessions.dispose();
});

test('failed revocation retains pause and recovery record until retry succeeds', async () => {
  const f = fixture(); await f.sessions.open(); await f.sessions.take();
  f.setRevokeFailure(true); await assert.rejects(f.sessions.close(), /offline/);
  assert.equal(f.control.paused, true); assert.equal(f.tasks(), 1); assert.equal(f.events.includes('journal-clear'), false);
  f.setRevokeFailure(false); await f.sessions.dispose(); assert.equal(f.control.paused, false); assert.equal(f.tasks(), 0);
});

test('failed creation of manual link revokes any uncertain link and releases host task', async () => {
  const f = fixture(); await f.sessions.open(); f.setStreamFailure(true);
  await assert.rejects(f.sessions.take()); assert.equal(f.control.paused, false); assert.equal(f.tasks(), 0);
  assert.equal(f.events.filter((e) => e === 'revoke').length, 2); await f.sessions.dispose();
});

test('close queued during a pending takeover revokes the newly created control session', async () => {
  const f = fixture(); await f.sessions.open(); const first = await f.control.acquire();
  const taking = f.sessions.take(), closing = f.sessions.close(); await tick(); first();
  await taking; await closing; assert.equal(f.control.paused, false); assert.equal(f.tasks(), 0); await f.sessions.dispose();
});

test('computer gate is acquired after approval and released on execution failure', async () => {
  const gate = new ComputerControl(); gate.block(); let approve;
  const approval = new Promise((resolve) => { approve = resolve; });
  const settings = defaultSettings(process.cwd()), bot = settings.bots[0];
  const call = runTool({ id:'exec', name:'cloud_exec', arguments:{cmd:'test'} }, { bot, cloud:{control:gate, beginTask(){},endTask(){},status(){return {};},exec:async()=>{throw Error('intentional failure');}}, requestApproval:()=>approval, emitStatus(){}, signal:new AbortController().signal });
  // Waiting for user approval must not count as an executing computer action.
  await gate.drain(AbortSignal.timeout(100)); approve(true); await tick();
  gate.resume(); assert.equal((await call).ok, false); await gate.drain(AbortSignal.timeout(100)); gate.resume();
  assert.equal(toolNamesFor({...bot,tools:['cloud_exec'],workspaceId:'workspace_cloud'}).includes('desktop_action'),true);
  assert.equal(toolNamesFor({...bot,tools:['cloud_exec'],workspaceId:'workspace_local'}).includes('desktop_action'),false);
});

test('desktop API explicitly requests server enforced readonly and real revocation', async () => {
  const original = global.fetch, calls=[];
  global.fetch=async(url,init)=>{calls.push({url,method:init.method,body:init.body&&JSON.parse(init.body)});return new Response(JSON.stringify({url:'https://desktop.example/',expiresAt:new Date().toISOString()}));};
  try { const client=new InstaBoxClient({apiKey:'test',baseUrl:'https://api.example'}); await client.desktopStream('m',true); await client.desktopStream('m',false); await client.desktopRevoke('m'); }
  finally { global.fetch=original; }
  assert.deepEqual(calls.map((c)=>c.body?.viewOnly),[true,false,undefined]); assert.equal(calls[2].method,'DELETE');
});
