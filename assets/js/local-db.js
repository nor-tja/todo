/* local-db.js — the IndexedDB mirror every read and write goes through
 * first, per the design spec: "Every change writes to IndexedDB first and
 * renders immediately, then enqueues a sync." This is the browser-only
 * persistence layer; sync.js's SyncQueue is what talks to the network.
 *
 * One small database, one object store per entity, keyed by the same `id`
 * every row already carries (client-generated UUIDs from task-store.js /
 * rhythms.js / lists.js). Never imported by node:test — there is no
 * IndexedDB in Node, and there is nothing pure-logic to unit test here;
 * it is a thin, mechanical wrapper.
 */
'use strict';

const DB_NAME = 'todo-app';
const DB_VERSION = 1;
export const STORES = Object.freeze(['tasks', 'rhythms', 'rhythm_log', 'lists', 'list_items', 'review_sessions']);

export class LocalDB {
  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
    this._dbPromise = null;
  }

  _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) {
            req.result.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async getAll(store) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(store, row) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(row);
      tx.oncomplete = () => resolve(row);
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(store, id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Loads every store at once, for app boot. */
  async loadAll() {
    const entries = await Promise.all(STORES.map(async (name) => [name, await this.getAll(name)]));
    return Object.fromEntries(entries);
  }
}
