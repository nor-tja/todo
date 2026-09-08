import test from 'node:test';
import assert from 'node:assert';
import { createPostgrestClient, SyncQueue, MemoryQueueStore, PostgrestError } from '../assets/js/sync.js';

/**
 * A minimal in-memory stand-in for PostgREST, just enough to exercise
 * sync.js's contract: POST upserts by id (idempotent insert), PATCH merges
 * named fields only (per-field last-write-wins), DELETE is idempotent.
 * Also supports scripting a network failure or an HTTP error on the next
 * call, to exercise SyncQueue's retry/drop behaviour.
 */
function fakeServer() {
  const tables = new Map();
  let networkDown = false;
  let nextFailStatus = null;

  function table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  }

  async function fetchImpl(url, { method, body }) {
    if (networkDown) throw new TypeError('fetch failed: network down');
    if (nextFailStatus) {
      const status = nextFailStatus;
      nextFailStatus = null;
      return { ok: false, status, text: async () => `forced ${status}` };
    }
    const u = new URL(url);
    const name = u.pathname.split('/').pop();
    const t = table(name);
    const idMatch = /id=eq\.([^&]+)/.exec(u.search);
    const id = idMatch ? decodeURIComponent(idMatch[1]) : null;

    if (method === 'POST') {
      const row = JSON.parse(body);
      t.set(row.id, row);
      return { ok: true, status: 201, json: async () => [row] };
    }
    if (method === 'PATCH') {
      const existing = t.get(id) ?? {};
      const patch = JSON.parse(body);
      const merged = { ...existing, ...patch };
      t.set(id, merged);
      return { ok: true, status: 200, json: async () => [merged] };
    }
    if (method === 'DELETE') {
      t.delete(id); // deleting a missing row is not an error, same as real PostgREST
      return { ok: true, status: 204, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => [...t.values()] };
  }

  return {
    fetchImpl,
    row: (name, id) => table(name).get(id),
    rowCount: (name) => table(name).size,
    setNetworkDown: (v) => { networkDown = v; },
    failNext: (status) => { nextFailStatus = status; },
  };
}

function makeClient(server) {
  return createPostgrestClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: server.fetchImpl });
}

// -- createPostgrestClient ---------------------------------------------

test('insert sends the row and the server stores it by id', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  await client.insert('tasks', { id: 't1', title: 'write report' });
  assert.deepEqual(server.row('tasks', 't1'), { id: 't1', title: 'write report' });
});

test('insert is idempotent: applying the same row twice does not error or duplicate', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  await client.insert('tasks', { id: 't1', title: 'write report' });
  await client.insert('tasks', { id: 't1', title: 'write report' }); // replayed
  assert.equal(server.rowCount('tasks'), 1);
});

test('update only touches the fields in the patch (per-field last-write-wins)', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  await client.insert('tasks', { id: 't1', title: 'a', state: 'inbox', context: null });
  await client.update('tasks', 't1', { state: 'backlog', context: 'work' });
  assert.deepEqual(server.row('tasks', 't1'), { id: 't1', title: 'a', state: 'backlog', context: 'work' });
});

test('two concurrent per-field updates both survive when they touch different fields', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  await client.insert('tasks', { id: 't1', title: 'a', state: 'inbox', notes: null });
  // Device A changes state; device B (independently) adds notes. Neither
  // resends the field the other changed, so both land.
  await client.update('tasks', 't1', { state: 'backlog' });
  await client.update('tasks', 't1', { notes: 'call plumber first' });
  assert.deepEqual(server.row('tasks', 't1'), {
    id: 't1', title: 'a', state: 'backlog', notes: 'call plumber first',
  });
});

test('delete is idempotent — deleting an already-gone row is not an error', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  await client.insert('tasks', { id: 't1', title: 'a' });
  await client.remove('tasks', 't1');
  await assert.doesNotReject(() => client.remove('tasks', 't1'));
  assert.equal(server.rowCount('tasks'), 0);
});

test('a non-2xx response raises PostgrestError with the status attached', async () => {
  const server = fakeServer();
  server.failNext(403);
  const client = makeClient(server);
  await assert.rejects(
    () => client.insert('tasks', { id: 't1' }),
    (err) => err instanceof PostgrestError && err.status === 403,
  );
});

// -- SyncQueue ------------------------------------------------------------

function queueOp(overrides = {}) {
  return {
    id: overrides.id ?? `op-${Math.random()}`,
    type: 'insert',
    table: 'tasks',
    rowId: 't1',
    payload: { id: 't1', title: 'x' },
    ...overrides,
  };
}

test('enqueue applies immediately when online and empties the store on success', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  const result = await queue.enqueue(queueOp());
  assert.deepEqual(result.applied.length, 1);
  assert.deepEqual(await store.list(), []);
  assert.equal(server.rowCount('tasks'), 1);
});

test('enqueue with replay:false only persists, without touching the network', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  await queue.enqueue(queueOp(), { replay: false });
  assert.equal((await store.list()).length, 1);
  assert.equal(server.rowCount('tasks'), 0);
});

test('replay drains multiple queued ops in order', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  await queue.enqueue(queueOp({ id: 'op1', rowId: 't1', payload: { id: 't1', title: 'first' } }), { replay: false });
  await queue.enqueue(queueOp({
    id: 'op2', type: 'update', rowId: 't1', payload: { title: 'second' },
  }), { replay: false });
  const result = await queue.replay();
  assert.deepEqual(result.applied, ['op1', 'op2']);
  assert.equal(server.row('tasks', 't1').title, 'second');
  assert.deepEqual(await store.list(), []);
});

test('a transient (network) failure stops replay and leaves ops queued for next time', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  server.setNetworkDown(true);
  const result = await queue.enqueue(queueOp({ id: 'op1' }));
  assert.equal(result.applied.length, 0);
  assert.equal(result.stoppedAt, 'op1');
  assert.equal((await store.list()).length, 1); // still queued

  server.setNetworkDown(false);
  const retryResult = await queue.replay();
  assert.deepEqual(retryResult.applied, ['op1']);
  assert.deepEqual(await store.list(), []);
});

test('a transient failure on the 2nd op leaves the 1st applied and only the rest queued', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  await store.add(queueOp({ id: 'op1', rowId: 't1', payload: { id: 't1', title: 'a' } }));
  await store.add(queueOp({ id: 'op2', rowId: 't2', payload: { id: 't2', title: 'b' } }));
  server.setNetworkDown(true);
  // op1 will fail immediately since the network is down for the whole call.
  const result = await queue.replay();
  assert.equal(result.applied.length, 0);
  assert.equal(result.stoppedAt, 'op1');
  assert.equal((await store.list()).length, 2);
});

test('a permanent (4xx) failure drops the op and keeps draining the rest', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const dropped = [];
  const queue = new SyncQueue({ client, store, onDropped: (op, err) => dropped.push({ op, err }) });
  await store.add(queueOp({ id: 'bad-op', rowId: 't1', payload: { id: 't1' } }));
  await store.add(queueOp({ id: 'good-op', rowId: 't2', payload: { id: 't2', title: 'ok' } }));
  server.failNext(422); // fails only the very next fetch, i.e. bad-op
  const result = await queue.replay();
  assert.deepEqual(result.applied, ['good-op']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].opId, 'bad-op');
  assert.equal(dropped.length, 1);
  assert.deepEqual(await store.list(), []);
});

test('replaying the same op twice (crash-before-remove scenario) does not double-apply', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  const op = queueOp({ id: 'op1', rowId: 't1', payload: { id: 't1', title: 'once' } });
  // Simulate: op applied to the server, but the app crashed before the
  // queue store recorded its removal, so it is still present next launch.
  await queue._apply(op);
  await store.add(op);
  const result = await queue.replay();
  assert.deepEqual(result.applied, ['op1']);
  assert.equal(server.rowCount('tasks'), 1);
});

test('delete op removes the row and is safe to replay twice', async () => {
  const server = fakeServer();
  const client = makeClient(server);
  const store = new MemoryQueueStore();
  const queue = new SyncQueue({ client, store });
  await queue.enqueue(queueOp({ id: 'ins', rowId: 't1', payload: { id: 't1', title: 'x' } }));
  await queue.enqueue(queueOp({ id: 'del1', type: 'delete', rowId: 't1' }));
  await store.add(queueOp({ id: 'del2', type: 'delete', rowId: 't1' })); // duplicate delete, e.g. replay
  const result = await queue.replay();
  assert.deepEqual(result.applied, ['del2']);
  assert.equal(server.rowCount('tasks'), 0);
});
