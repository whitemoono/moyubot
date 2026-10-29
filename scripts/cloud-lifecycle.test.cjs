const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CloudHost, InstaBoxClient, defaultSettings } = require('../packages/core/dist');

async function fixture(t, initial = 'suspended', configuredId = true) {
  let machine = { id: 'existing', name: 'shared', state: initial, autoSuspendAfterSeconds: 1800 };
  const calls = [];
  let failed = false;
  const driver = {
    kind: 'mock',
    listMachines: async () => [{ ...machine }],
    getMachine: async () => { calls.push('read'); return { ...machine }; },
    createMachine: async () => { throw Error('Must reuse the existing machine'); },
    act: async (_id, action) => { calls.push(action); machine = { ...machine, state: action === 'suspend' ? 'suspended' : 'running' }; return { id: 'operation', state: 'running' }; },
    waitOperation: async () => failed ? { id: 'operation', state: 'failed', error: { message: 'resume failed' } } : { id: 'operation', state: 'succeeded' },
    waitForState: async (_id, accept) => {
      calls.push('wait');
      if (!accept.includes(machine.state)) machine = { ...machine, state: 'suspended' };
      assert.ok(accept.includes(machine.state), `Unexpected state ${machine.state}`);
      return { ...machine };
    },
  };
  const host = new CloudHost({ settings: { ...defaultSettings(process.cwd()).cloud, driver: 'instabox', machineId: configuredId ? machine.id : undefined, machineName: machine.name } });
  // No credential during construction: tests never contact the real service.
  host.isConfigured = () => true;
  Object.defineProperty(host, 'driver', { get: () => driver });
  t.after(() => host.dispose());
  if (configuredId) await host.refresh();
  return { host, calls, state(value) { machine = { ...machine, state: value }; }, fail() { failed = true; } };
}

test('suspended machine resumes its snapshot and concurrent wake requests share the operation', async (t) => {
  const f = await fixture(t);
  const result = await Promise.all([f.host.ensureAwake('click'), f.host.ensureAwake('command')]);
  assert.ok(result.every((m) => m.state === 'running'));
  assert.deepEqual(f.calls.filter((c) => ['resume', 'start', 'wake'].includes(c)), ['resume']);
  assert.equal(f.host.status().state, 'ready');
});

test('stale running cache is refreshed before resuming a server-suspended machine', async (t) => {
  const f = await fixture(t, 'running');
  f.state('suspended');
  await f.host.ensureAwake('click');
  assert.ok(f.calls.includes('resume'));
  assert.equal(f.host.status().machine.state, 'running');
});

test('stopped machines start and already-running machines do not receive power actions', async (t) => {
  const f = await fixture(t, 'stopped');
  await f.host.ensureAwake('click');
  assert.ok(f.calls.includes('start'));
  f.calls.length = 0;
  await f.host.ensureAwake('again');
  assert.deepEqual(f.calls, ['read']);
});

test('wake discovers an existing machine even before startup refresh finishes', async (t) => {
  const f = await fixture(t, 'suspended', false);
  await f.host.ensureAwake('click');
  assert.ok(f.calls.includes('resume'));
  assert.equal(f.host.getSettings().machineId, 'existing');
});

test('wake waits for an in-progress suspend, then resumes', async (t) => {
  const f = await fixture(t, 'suspending');
  await f.host.ensureAwake('click');
  assert.ok(f.calls.indexOf('wait') < f.calls.indexOf('resume'));
});

test('operation failures stop wake immediately and remain visible in status', async (t) => {
  const f = await fixture(t);
  f.fail();
  await assert.rejects(f.host.ensureAwake('click'), /resume failed/);
  assert.equal(f.calls.includes('wait'), false);
  assert.equal(f.host.status().state, 'error');
  assert.match(f.host.status().lastError, /resume failed/);
});

test('InstaBox operation failure propagates its server error', async () => {
  const client = new InstaBoxClient({ apiKey: 'test' });
  client.getOperation = async () => ({ id: 'op', state: 'failed', error: { code: 'resume_failed', message: 'Snapshot unavailable' } });
  await assert.rejects(client.waitOperation('op'), (e) => e.code === 'resume_failed' && e.message === 'Snapshot unavailable');
});
