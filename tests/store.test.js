import test from 'node:test';
import assert from 'node:assert';
import { Store } from '../assets/js/store.js';
import { rollover } from '../assets/js/task-store.js';

/** A fake localDb: same getAll/put/remove/loadAll shape as local-db.js's
 * LocalDB, backed by plain objects instead of IndexedDB. */
function fakeLocalDb() {
  const data = { tasks: [], rhythms: [], rhythm_log: [], lists: [], list_items: [] };
  return {
    data,
    async loadAll() { return structuredClone(data); },
    async getAll(store) { return structuredClone(data[store]); },
    async put(store, row) {
      const i = data[store].findIndex((r) => r.id === row.id);
      if (i === -1) data[store].push(row); else data[store][i] = row;
    },
    async remove(store, id) {
      data[store] = data[store].filter((r) => r.id !== id);
    },
  };
}

/** A fake syncQueue that just records what was enqueued. */
function fakeSyncQueue() {
  const ops = [];
  return { ops, async enqueue(op) { ops.push(op); return { applied: [op.id], failed: [], stoppedAt: null }; } };
}

test('capture adds an inbox task, persists it, and enqueues an insert', async () => {
  const localDb = fakeLocalDb();
  const syncQueue = fakeSyncQueue();
  const store = new Store({ localDb, syncQueue });
  const task = await store.capture('water the tomatoes');
  assert.equal(store.tasks.length, 1);
  assert.equal(task.state, 'inbox');
  assert.equal(localDb.data.tasks.length, 1);
  assert.equal(syncQueue.ops.length, 1);
  assert.equal(syncQueue.ops[0].type, 'insert');
  assert.equal(syncQueue.ops[0].table, 'tasks');
  assert.equal(syncQueue.ops[0].payload.title, 'water the tomatoes');
});

test('triage updates in-memory state and enqueues a patch with only the changed fields', async () => {
  const localDb = fakeLocalDb();
  const syncQueue = fakeSyncQueue();
  const store = new Store({ localDb, syncQueue });
  const task = await store.capture('renew passport');
  syncQueue.ops.length = 0; // reset, we only care about the triage op now
  await store.triage(task.id, 'home');
  assert.equal(store.tasks[0].state, 'backlog');
  assert.equal(store.tasks[0].context, 'home');
  const op = syncQueue.ops[0];
  assert.equal(op.type, 'update');
  assert.equal(op.rowId, task.id);
  assert.equal(op.payload.state, 'backlog');
  assert.equal(op.payload.context, 'home');
  // Fields that didn't change (e.g. title) must not be in the patch —
  // that's what makes concurrent per-field edits on another device safe.
  assert.ok(!('title' in op.payload));
});

test('commitToday enforces the cap and reports { ok:false } without mutating state', async () => {
  const localDb = fakeLocalDb();
  const store = new Store({ localDb, syncQueue: fakeSyncQueue() });
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const t = await store.capture(`t${i}`);
    await store.triage(t.id, 'work');
    await store.commitToday(t.id);
    ids.push(t.id);
  }
  const sixth = await store.capture('one more');
  await store.triage(sixth.id, 'work');
  const result = await store.commitToday(sixth.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cap');
  assert.equal(store.tasks.find((t) => t.id === sixth.id).state, 'backlog');
});

test('discardTask (Bin) removes the task and enqueues a delete', async () => {
  const localDb = fakeLocalDb();
  const syncQueue = fakeSyncQueue();
  const store = new Store({ localDb, syncQueue });
  const task = await store.capture('noise');
  syncQueue.ops.length = 0;
  await store.discardTask(task.id);
  assert.equal(store.tasks.length, 0);
  assert.equal(localDb.data.tasks.length, 0);
  assert.equal(syncQueue.ops[0].type, 'delete');
  assert.equal(syncQueue.ops[0].rowId, task.id);
});

test('sendInboxItemToList ("-> List") creates a list item and discards the task', async () => {
  const localDb = fakeLocalDb();
  const store = new Store({ localDb, syncQueue: fakeSyncQueue() });
  const list = await store.addList('Want to buy');
  const task = await store.capture('new hand cream');
  const item = await store.sendInboxItemToList(task.id, list.id);
  assert.equal(item.text, 'new hand cream');
  assert.equal(item.list_id, list.id);
  assert.equal(store.tasks.length, 0);
  assert.equal(store.listItems.length, 1);
});

test('logRhythm is idempotent for the same rhythm and day', async () => {
  const localDb = fakeLocalDb();
  const store = new Store({ localDb, syncQueue: fakeSyncQueue() });
  const rhythm = await store.addRhythm({ name: 'meditate', kind: 'daily', context: 'home' });
  const first = await store.logRhythm(rhythm.id, '2026-09-08');
  const second = await store.logRhythm(rhythm.id, '2026-09-08');
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(store.rhythmLog.length, 1);
});

test('unlogRhythm removes today\'s entry', async () => {
  const localDb = fakeLocalDb();
  const store = new Store({ localDb, syncQueue: fakeSyncQueue() });
  const rhythm = await store.addRhythm({ name: 'meditate', kind: 'daily', context: 'home' });
  await store.logRhythm(rhythm.id, '2026-09-08');
  await store.unlogRhythm(rhythm.id, '2026-09-08');
  assert.equal(store.rhythmLog.length, 0);
  assert.equal(localDb.data.rhythm_log.length, 0);
});

test('toggleItemBought flips state and persists', async () => {
  const localDb = fakeLocalDb();
  const store = new Store({ localDb, syncQueue: fakeSyncQueue() });
  const list = await store.addList('Want to buy');
  const item = await store.addListItem(list.id, 'hand cream');
  const bought = await store.toggleItemBought(item.id);
  assert.equal(bought.bought, true);
  assert.equal(localDb.data.list_items[0].bought, true);
});

test('setTasks bulk-persists only the tasks rollover() actually changed', async () => {
  const localDb = fakeLocalDb();
  const syncQueue = fakeSyncQueue();
  const store = new Store({ localDb, syncQueue });
  const stale = await store.capture('yesterday');
  await store.triage(stale.id, 'work');
  await store.commitToday(stale.id);
  // Force it into a "committed yesterday" shape for the rollover test.
  store.tasks = store.tasks.map((t) => (t.id === stale.id ? { ...t, committed_on: '2026-09-07' } : t));
  const fresh = await store.capture('untouched');
  syncQueue.ops.length = 0;

  const rolled = rollover(store.tasks, { today: '2026-09-08' });
  const changedCount = await store.setTasks(rolled);

  assert.equal(changedCount, 1);
  assert.equal(store.tasks.find((t) => t.id === stale.id).state, 'backlog');
  assert.equal(syncQueue.ops.length, 1);
  assert.equal(syncQueue.ops[0].rowId, stale.id);
});

test('load() populates state from localDb.loadAll()', async () => {
  const localDb = fakeLocalDb();
  localDb.data.tasks.push({ id: 't1', title: 'x', state: 'inbox' });
  localDb.data.lists.push({ id: 'l1', name: 'Want to buy' });
  const store = new Store({ localDb });
  await store.load();
  assert.equal(store.tasks.length, 1);
  assert.equal(store.lists.length, 1);
});
