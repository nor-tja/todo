/* Rituals — morning and weekly review sequencing.
 *
 * Pure logic: this module decides WHAT to show and in what order, not how
 * to render it. It composes task-store.js and rhythms.js, mirroring the
 * architecture table in the design spec. Every function here is a plain
 * data transform: (tasks/rhythms/log, today) -> the next thing to show.
 *
 * Both rituals are "guided, one item at a time" — so most of what this
 * module returns is either a single item to act on, or a short queue of
 * them, rather than a big filtered list to scroll.
 */
'use strict';

import { todayISO, startOfWeek, endOfWeek, diffDays } from './day-math.js';
import { rollover, selectBacklogRotation, repeatedlyDeclined } from './task-store.js';
import {
  datesForRhythm, dailyStreak, quotaWeekCount, quotaNomination,
} from './rhythms.js';

/** How many days before a deadline it starts nominating in the morning. */
export const DEADLINE_LOOKAHEAD_DAYS = 3;

// -- morning ------------------------------------------------------------

/**
 * Step 1: run the daily rollover and report which tasks just fell back to
 * backlog, so the ritual can surface them first as "yesterday's leftovers"
 * — re-promised rather than silently inherited.
 *
 * @param {object[]} tasks
 * @param {{ today?: string }} [opts]
 * @returns {{ tasks: object[], rolledOver: object[] }}
 */
export function runMorningRollover(tasks, opts = {}) {
  const today = opts.today ?? todayISO();
  const next = rollover(tasks, { today });
  const rolledOver = next.filter((t, i) => t !== tasks[i] && t.state === 'backlog');
  return { tasks: next, rolledOver };
}

/**
 * Step 2: inbox items to triage, one at a time, oldest first — the order
 * they were transcribed from paper in.
 * @param {object[]} tasks
 */
export function inboxQueue(tasks) {
  return tasks
    .filter((t) => t.state === 'inbox')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/**
 * Step 3a: backlog tasks with a deadline close enough to nominate — within
 * `DEADLINE_LOOKAHEAD_DAYS`, or already overdue ("a deadline never inserts
 * anything into Today, it only nominates," and overdue ones keep asking
 * rather than turning red and shouting). Excludes anything already asked
 * about today, so a caller with session state can keep this to once per
 * morning without this function holding any state itself.
 *
 * @param {object[]} tasks
 * @param {{ today?: string, askedIds?: Set<string> }} [opts]
 */
export function deadlineNominations(tasks, opts = {}) {
  const today = opts.today ?? todayISO();
  const asked = opts.askedIds ?? new Set();
  return tasks.filter((t) => {
    if (t.state !== 'backlog' || !t.deadline || asked.has(t.id)) return false;
    return diffDays(today, t.deadline) <= DEADLINE_LOOKAHEAD_DAYS;
  });
}

/**
 * Step 3b: quota rhythms at risk of missing their floor this week.
 * @param {object[]} rhythms
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {{ today?: string, askedIds?: Set<string>, context?: 'work'|'home' }} [opts]
 */
export function quotaNominations(rhythms, log, opts = {}) {
  const today = opts.today ?? todayISO();
  const asked = opts.askedIds ?? new Set();
  return rhythms
    .filter((r) => r.active && r.kind === 'quota' && (!opts.context || r.context === opts.context))
    .map((r) => {
      const dates = datesForRhythm(log, r.id);
      const nom = quotaNomination(r, dates, { today, alreadyAskedToday: asked.has(r.id) });
      return { rhythm: r, ...nom };
    })
    .filter((row) => row.shouldNominate);
}

/**
 * Bundles the whole morning ritual into its four steps, in order. The
 * caller (ui/*.js) walks through it and calls task-store/rhythms mutators
 * as the user answers each prompt; nothing here is mutated in place.
 *
 * @param {object[]} tasks
 * @param {object[]} rhythms
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {{ today?: string, context?: 'work'|'home', askedDeadlineIds?: Set<string>, askedQuotaIds?: Set<string> }} [opts]
 */
export function morningRitual(tasks, rhythms, log, opts = {}) {
  const today = opts.today ?? todayISO();
  const { tasks: rolledTasks, rolledOver } = runMorningRollover(tasks, { today });
  return {
    today,
    rolledOver,
    inbox: inboxQueue(rolledTasks),
    deadlineNominations: deadlineNominations(rolledTasks, { today, askedIds: opts.askedDeadlineIds }),
    quotaNominations: quotaNominations(rhythms, log, {
      today, context: opts.context, askedIds: opts.askedQuotaIds,
    }),
    tasks: rolledTasks,
  };
}

// -- weekly ---------------------------------------------------------------

/**
 * Step 1: tasks actually finished this week (Monday-Sunday containing
 * `today`), regardless of when they were committed.
 * @param {object[]} tasks
 * @param {{ today?: string, context?: 'work'|'home' }} [opts]
 */
export function finishedThisWeek(tasks, opts = {}) {
  const today = opts.today ?? todayISO();
  const start = startOfWeek(today);
  const end = endOfWeek(today);
  return tasks.filter((t) => {
    if (t.state !== 'done' || !t.completed_at) return false;
    if (opts.context && t.context !== opts.context) return false;
    const day = t.completed_at.slice(0, 10);
    return day >= start && day <= end;
  });
}

/**
 * Step 2: this week's performance per rhythm — streak for daily rhythms,
 * count-vs-floor/stretch for quota, hits-vs-misses for scheduled.
 * @param {object[]} rhythms
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {{ today?: string, context?: 'work'|'home' }} [opts]
 */
export function rhythmPerformance(rhythms, log, opts = {}) {
  const today = opts.today ?? todayISO();
  return rhythms
    .filter((r) => r.active && (!opts.context || r.context === opts.context))
    .map((r) => {
      const dates = datesForRhythm(log, r.id);
      if (r.kind === 'daily') {
        return { rhythm: r, streak: dailyStreak(dates, { today }) };
      }
      if (r.kind === 'quota') {
        const count = quotaWeekCount(dates, { today });
        return {
          rhythm: r,
          count,
          metFloor: count >= r.quota_floor,
          metStretch: r.quota_stretch != null ? count >= r.quota_stretch : null,
        };
      }
      // scheduled: how many of this week's Mon-Sun days fall on/after this
      // rhythm's cadence and were logged. Kept simple — one hit/miss count
      // per week, since a scheduled rhythm fires at most once a week
      // (weekday) or is out of scope for weekly rollup (day_of_month).
      const start = startOfWeek(today);
      const end = endOfWeek(today);
      const hits = dates.filter((d) => d >= start && d <= end).length;
      return { rhythm: r, hits };
    });
}

/**
 * Bundles the whole weekly ritual into its four steps.
 * @param {object[]} tasks
 * @param {object[]} rhythms
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {{ today?: string, context?: 'work'|'home' }} [opts]
 */
export function weeklyRitual(tasks, rhythms, log, opts = {}) {
  const today = opts.today ?? todayISO();
  return {
    today,
    finished: finishedThisWeek(tasks, { today, context: opts.context }),
    rhythmPerformance: rhythmPerformance(rhythms, log, { today, context: opts.context }),
    backlogRotation: selectBacklogRotation(tasks, { context: opts.context }),
    repeatedlyDeclined: repeatedlyDeclined(tasks, { context: opts.context }),
  };
}
