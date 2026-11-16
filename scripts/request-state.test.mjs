import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../apps/desktop/src/lib/request-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { enqueueRequest, removeRequest, scopedSnapshots } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('concurrent requests stay in arrival order and completion removes only its own ID', () => {
  const first = { id: 'a', botId: 'one' };
  const second = { id: 'b', botId: 'two' };
  const third = { id: 'c', botId: 'three' };
  let queue = enqueueRequest(enqueueRequest(enqueueRequest([], first), second), third);
  queue = enqueueRequest(queue, { ...second });
  assert.deepEqual(queue, [first, second, third]);
  // A request can time out while it is still behind the visible one.
  queue = removeRequest(queue, second.id);
  assert.deepEqual(queue, [first, third]);
  queue = removeRequest(queue, first.id);
  // The IPC reply can finish after the event has already advanced the queue.
  assert.deepEqual(removeRequest(queue, first.id), [third]);
});

test('late responses from the old conversation cannot replace the selected conversation or its newer reload', async () => {
  const values = new Map();
  const snapshots = scopedSnapshots((id, value) => values.set(id, value));
  const oldA = Promise.withResolvers();
  const newA = Promise.withResolvers();
  const firstVisit = snapshots.load('a', () => oldA.promise);
  await snapshots.load('b', async () => 'B 的待办');
  const secondVisit = snapshots.load('a', () => newA.promise);
  newA.resolve('A 的新待办');
  await secondVisit;
  oldA.resolve('A 的旧待办');
  await firstVisit;
  assert.equal(values.get('b'), 'B 的待办');
  assert.equal(values.get('a'), 'A 的新待办');
});

test('a live update takes precedence over an older IPC snapshot', async () => {
  const values = new Map();
  const snapshots = scopedSnapshots((id, value) => values.set(id, value));
  const stale = Promise.withResolvers();
  const loading = snapshots.load('a', () => stale.promise);
  snapshots.set('a', { active: undefined });
  stale.resolve({ active: '已完成的目标' });
  await loading;
  assert.deepEqual(values.get('a'), { active: undefined });
});
