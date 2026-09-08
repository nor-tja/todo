/* store.js — the app-level glue: holds in-memory state, applies the pure
 * transitions from task-store.js / rhythms.js / lists.js, and persists
 * every change local-first (localDb) before enqueuing it for sync
 * (syncQueue) — "every change writes to IndexedDB first and renders
 * immediately, then enqueues a sync."
 *
 * Deliberately takes `localDb` and `syncQueue` as constructor arguments
 * rather than importing local-db.js / sync.js by name: both are duck-typed
 * (localDb: getAll/put/remove/loadAll; syncQueue: enqueue), so this module
 * has no hard dependency on IndexedDB or the network and is unit-testable
 * in Node against fakes — see tests/store.test.js. ui/*.js is what wires
 * the real LocalDB and SyncQueue to it in the browser.
 */
'use strict';

import {
  createTask, triage as triageTask, commitToday as commitTodayTx, demote as demoteTx,
  complete as completeTx, reopen as reopenTx, decline as declineTx, touchSeen as touchSeenTx,
} from './task-store.js';
import { createList, createListItem, toggleBought as toggleBoughtTx } from './lists.js';

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Fields present in `after` but not equal to `before` — used to build
 * PATCH bodies that only touch what actually changed (per-field LWW). */
function diffFields(before, after) {
  const patch = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) patch[key] = after[key];
  }
  return patch;
}

export class Store {
  /**
   * @param {{ localDb?: object, syncQueue?: object }} [opts]
   */
  constructor(opts = {}) {
    this.localDb = opts.localDb ?? null;
    this.syncQueue = opts.syncQueue ?? null;
    this.tasks = [];
    this.rhythms = [];
    this.rhythmLog = [];
    this.lists = [];
    this.listItems = [];
  }

  async load() {
    if (!this.localDb) return;
    const all = await this.localDb.loadAll();
    this.tasks = all.tasks ?? [];
    this.rhythms = all.rhythms ?? [];
    this.rhythmLog = all.rhythm_log ?? [];
    this.lists = all.lists ?? [];
    this.listItems = all.list_items ?? [];
  }

  // -- internal persistence plumbing ---------------------------------

  async _persistInsert(storeName, table, row) {
    if (this.localDb) await this.localDb.put(storeName, row);
    if (this.syncQueue) {
      await this.syncQueue.enqueue({ id: randomId(), type: 'insert', table, rowId: row.id, payload: row });
    }
  }

  async _persistUpdate(storeName, table, before, after) {
    if (this.localDb) await this.localDb.put(storeName, after);
    const patch = diffFields(before, after);
    if (this.syncQueue && Object.keys(patch).length) {
      await this.syncQueue.enqueue({ id: randomId(), type: 'update', table, rowId: after.id, payload: patch });
    }
  }

  async _persistDelete(storeName, table, id) {
    if (this.localDb) await this.localDb.remove(storeName, id);
    if (this.syncQueue) {
      await this.syncQueue.enqueue({ id: randomId(), type: 'delete', table, rowId: id });
    }
  }

  // -- Track A: tasks --------------------------------------------------

  async capture(title) {
    const task = createTask(title);
    this.tasks = [...this.tasks, task];
    await this._persistInsert('tasks', 'tasks', task);
    return task;
  }

  async _updateTask(id, transition) {
    const before = this.tasks.find((t) => t.id === id);
    if (!before) throw new Error(`no task ${id}`);
    const after = transition(before);
    this.tasks = this.tasks.map((t) => (t.id === id ? after : t));
    await this._persistUpdate('tasks', 'tasks', before, after);
    return after;
  }

  triage(id, context) {
    return this._updateTask(id, (t) => triageTask(t, context));
  }

  async commitToday(id) {
    const before = this.tasks.find((t) => t.id === id);
    if (!before) throw new Error(`no task ${id}`);
    const result = commitTodayTx(before, this.tasks);
    if (!result.ok) return result;
    this.tasks = this.tasks.map((t) => (t.id === id ? result.task : t));
    await this._persistUpdate('tasks', 'tasks', before, result.task);
    return result;
  }

  demoteTask(id) {
    return this._updateTask(id, demoteTx);
  }

  completeTask(id) {
    return this._updateTask(id, completeTx);
  }

  reopenTask(id) {
    return this._updateTask(id, reopenTx);
  }

  declineTask(id) {
    return this._updateTask(id, declineTx);
  }

  touchSeenTask(id) {
    return this._updateTask(id, touchSeenTx);
  }

  async setTasks(nextTasks) {
    // Bulk-apply the result of task-store.rollover(): persist every task
    // whose reference actually changed, leave the rest alone.
    const changed = [];
    for (let i = 0; i < this.tasks.length; i += 1) {
      if (this.tasks[i] !== nextTasks[i]) changed.push([this.tasks[i], nextTasks[i]]);
    }
    this.tasks = nextTasks;
    for (const [before, after] of changed) {
      await this._persistUpdate('tasks', 'tasks', before, after);
    }
    return changed.length;
  }

  /** Bin, in triage: the task is discarded outright, not sent to backlog. */
  async discardTask(id) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    await this._persistDelete('tasks', 'tasks', id);
  }

  /** "-> List" in triage: the inbox line becomes a list item instead of a task. */
  async sendInboxItemToList(id, listId) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`no task ${id}`);
    const item = await this.addListItem(listId, task.title);
    await this.discardTask(id);
    return item;
  }

  // -- Track B: rhythms --------------------------------------------------

  async addRhythm(rhythm) {
    const row = { id: randomId(), active: true, ...rhythm };
    this.rhythms = [...this.rhythms, row];
    await this._persistInsert('rhythms', 'rhythms', row);
    return row;
  }

  /** Logs a rhythm as done on `date` (default today). Safe to call once
   * per day per rhythm — rhythm_log has a unique(rhythm_id, done_on). */
  async logRhythm(rhythmId, date) {
    const done_on = date ?? new Date().toISOString().slice(0, 10);
    if (this.rhythmLog.some((r) => r.rhythm_id === rhythmId && r.done_on === done_on)) {
      return null; // already logged
    }
    const row = { id: randomId(), rhythm_id: rhythmId, done_on };
    this.rhythmLog = [...this.rhythmLog, row];
    await this._persistInsert('rhythm_log', 'rhythm_log', row);
    return row;
  }

  /** Undoes today's log entry for a rhythm, e.g. a mis-tap. */
  async unlogRhythm(rhythmId, date) {
    const done_on = date ?? new Date().toISOString().slice(0, 10);
    const row = this.rhythmLog.find((r) => r.rhythm_id === rhythmId && r.done_on === done_on);
    if (!row) return;
    this.rhythmLog = this.rhythmLog.filter((r) => r.id !== row.id);
    await this._persistDelete('rhythm_log', 'rhythm_log', row.id);
  }

  // -- Track C: lists ------------------------------------------------

  async addList(name, opts = {}) {
    const list = createList(name, opts);
    this.lists = [...this.lists, list];
    await this._persistInsert('lists', 'lists', list);
    return list;
  }

  async addListItem(listId, text) {
    const item = createListItem(listId, text);
    this.listItems = [...this.listItems, item];
    await this._persistInsert('list_items', 'list_items', item);
    return item;
  }

  async toggleItemBought(id) {
    const before = this.listItems.find((i) => i.id === id);
    if (!before) throw new Error(`no list item ${id}`);
    const after = toggleBoughtTx(before);
    this.listItems = this.listItems.map((i) => (i.id === id ? after : i));
    await this._persistUpdate('list_items', 'list_items', before, after);
    return after;
  }
}
