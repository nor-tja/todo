/* Track A — tasks (things that finish).
 *
 * Pure logic only: no DOM, no network, no persistence. Everything here
 * operates on plain task objects/arrays and returns new values rather than
 * mutating in place, so it is testable the same way day-math.js is, and so
 * the UI layer can diff old vs. new state for cheap re-renders.
 *
 * Persistence (IndexedDB + Supabase) lives in sync.js and is wired to this
 * module only from ui/*.js — see the module table in the design spec.
 *
 * A task is in exactly one of four states: inbox, backlog, today, done.
 * See docs/superpowers/specs/2026-09-08-todo-app-design.md, "Track A".
 */
'use strict';

import { todayISO, isBefore } from './day-math.js';

/** Hard cap on committed-today tasks. Fixed in v1, deliberately not
 * configurable — a configurable cap is a cap that rises. */
export const CAP = 5;

export const STATES = Object.freeze(['inbox', 'backlog', 'today', 'done']);

/**
 * Builds a new inbox task from a single captured line of text. Capture
 * takes no other fields — type is decided later, at triage.
 *
 * @param {string} title
 * @param {{ now?: string, id?: string }} [opts]
 */
export function createTask(title, opts = {}) {
  const now = opts.now ?? nowISO();
  const trimmed = String(title).trim();
  if (!trimmed) throw new Error('a task needs a title');
  return {
    id: opts.id ?? randomId(),
    user_id: null,
    title: trimmed,
    notes: null,
    context: null,
    state: 'inbox',
    deadline: null,
    committed_on: null,
    declined_count: 0,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    completed_at: null,
    sort_order: 0,
  };
}

/**
 * Inbox -> Backlog. This is the moment "type" is decided — everything else
 * about the task (deadline, notes) can still be added later, but context
 * (work/home) is required from here on, because Work/Home mode filtering
 * depends on every non-inbox task having one.
 *
 * @param {object} task
 * @param {'work'|'home'} context
 * @param {{ now?: string }} [opts]
 */
export function triage(task, context, opts = {}) {
  if (context !== 'work' && context !== 'home') {
    throw new Error(`triage needs a context of 'work' or 'home', got ${context}`);
  }
  const now = opts.now ?? nowISO();
  return { ...task, state: 'backlog', context, updated_at: now, last_seen_at: now };
}

/**
 * Backlog -> Today, enforcing the cap of 5. Returns { ok:false, reason:'cap' }
 * instead of throwing, so the UI can offer "demote one to make room" rather
 * than treating this as an error.
 *
 * @param {object} task
 * @param {object[]} allTasks - full task list, to count today's commitments
 * @param {{ today?: string }} [opts]
 * @returns {{ ok: true, task: object } | { ok: false, reason: string }}
 */
export function commitToday(task, allTasks, opts = {}) {
  if (task.state === 'today') return { ok: true, task };
  if (task.state !== 'backlog' && task.state !== 'inbox') {
    return { ok: false, reason: 'wrong-state' };
  }
  const today = opts.today ?? todayISO();
  const committedCount = allTasks.filter(
    (t) => t.id !== task.id && t.state === 'today',
  ).length;
  if (committedCount >= CAP) return { ok: false, reason: 'cap' };
  return {
    ok: true,
    task: {
      ...task,
      state: 'today',
      committed_on: today,
      // Being picked up resolves the avoidance signal this item may have
      // been carrying from repeated "Not now"s in the weekly rotation.
      declined_count: 0,
      updated_at: today,
      last_seen_at: today,
    },
  };
}

/**
 * Today -> Backlog. A deliberate demotion (to make room under the cap), or
 * the same transition daily rollover applies automatically.
 *
 * @param {object} task
 * @param {{ now?: string }} [opts]
 */
export function demote(task, opts = {}) {
  const now = opts.now ?? nowISO();
  return { ...task, state: 'backlog', committed_on: null, updated_at: now, last_seen_at: now };
}

/**
 * Any non-done state -> Done. Retained rather than deleted — "seeing what
 * you did matters."
 *
 * @param {object} task
 * @param {{ now?: string }} [opts]
 */
export function complete(task, opts = {}) {
  const now = opts.now ?? nowISO();
  return { ...task, state: 'done', completed_at: now, updated_at: now };
}

/**
 * Done -> Backlog. Undoes an accidental completion. Context is required
 * (backlog tasks always have one); done tasks keep the context they had.
 * @param {object} task
 * @param {{ now?: string }} [opts]
 */
export function reopen(task, opts = {}) {
  const now = opts.now ?? nowISO();
  return { ...task, state: 'backlog', completed_at: null, committed_on: null, updated_at: now };
}

/**
 * Records a "Not now" from the weekly rotation, or a declined deadline
 * nomination in the morning ritual. Bumps last_seen_at so the item goes to
 * the back of the backlog rotation, and increments declined_count so three
 * declines can be surfaced plainly in the weekly review.
 *
 * @param {object} task
 * @param {{ now?: string }} [opts]
 */
export function decline(task, opts = {}) {
  const now = opts.now ?? nowISO();
  return {
    ...task,
    declined_count: (task.declined_count ?? 0) + 1,
    last_seen_at: now,
    updated_at: now,
  };
}

/**
 * Marks a task as seen without declining it (e.g. shown in a review and
 * kept as-is). Bumps last_seen_at only.
 * @param {object} task
 * @param {{ now?: string }} [opts]
 */
export function touchSeen(task, opts = {}) {
  const now = opts.now ?? nowISO();
  return { ...task, last_seen_at: now, updated_at: now };
}

/**
 * Daily rollover: at local midnight, any `today` task not committed to
 * *today* (i.e. left over from a previous day and not completed) returns
 * to backlog. Pure and idempotent — safe to call every time the app loads,
 * not just once at midnight, since a task already rolled over (state
 * backlog, or committed_on === today) is left untouched.
 *
 * @param {object[]} tasks
 * @param {{ today?: string }} [opts]
 * @returns {object[]} a new array; unaffected tasks keep their same reference
 */
export function rollover(tasks, opts = {}) {
  const today = opts.today ?? todayISO();
  return tasks.map((t) => {
    if (t.state !== 'today') return t;
    if (t.committed_on === today) return t;
    if (t.committed_on && !isBefore(t.committed_on, today)) return t; // future-dated, leave alone
    return demote(t, { now: today });
  });
}

/**
 * The backlog rotation for the weekly review: roughly `count` items, least-
 * recently-seen first. This is what lets a home-maintenance task resurface
 * every few weeks without ever scrolling a full backlog.
 *
 * @param {object[]} tasks
 * @param {{ context?: 'work'|'home', count?: number }} [opts]
 * @returns {object[]}
 */
export function selectBacklogRotation(tasks, opts = {}) {
  const count = opts.count ?? 5;
  const pool = tasks.filter(
    (t) => t.state === 'backlog' && (!opts.context || t.context === opts.context),
  );
  return [...pool]
    .sort((a, b) => (a.last_seen_at < b.last_seen_at ? -1 : a.last_seen_at > b.last_seen_at ? 1 : 0))
    .slice(0, count);
}

/**
 * Tasks committed today, in a stable display order. Optionally scoped to a
 * Work/Home context, since Work mode must show zero home content.
 * @param {object[]} tasks
 * @param {{ context?: 'work'|'home' }} [opts]
 */
export function todayList(tasks, opts = {}) {
  return tasks
    .filter((t) => t.state === 'today' && (!opts.context || t.context === opts.context))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** How many more tasks can be committed today before hitting the cap. */
export function remainingCapacity(tasks, opts = {}) {
  return Math.max(0, CAP - todayList(tasks, opts).length);
}

/**
 * Backlog items declined 3 or more times — "repeated avoidance is a signal
 * worth seeing," surfaced plainly in the weekly review.
 * @param {object[]} tasks
 * @param {{ context?: 'work'|'home', threshold?: number }} [opts]
 */
export function repeatedlyDeclined(tasks, opts = {}) {
  const threshold = opts.threshold ?? 3;
  return tasks.filter(
    (t) => t.state === 'backlog'
      && (t.declined_count ?? 0) >= threshold
      && (!opts.context || t.context === opts.context),
  );
}

// -- internal ---------------------------------------------------------------

function nowISO() {
  return new Date().toISOString();
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID (older WebViews).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
