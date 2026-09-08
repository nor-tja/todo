/* Track B — rhythms (things that repeat).
 *
 * Pure logic only, like task-store.js: no DOM, no network. Streaks and
 * quota progress are DERIVED here from rhythm_log rows, never stored — a
 * stored counter is a second source of truth that drifts the first time a
 * sync is replayed twice (see the design spec, "Data model").
 *
 * Rhythms never count against the Track A cap of 5. Ticking hand cream is
 * not a unit of work.
 */
'use strict';

import { addDays, dayOfWeek, dayOfMonth, startOfWeek, endOfWeek, todayISO } from './day-math.js';

export const KINDS = Object.freeze(['daily', 'quota', 'scheduled']);

/**
 * Pulls the done_on dates for one rhythm out of a flat rhythm_log table,
 * sorted ascending. `log` rows look like { rhythm_id, done_on }.
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {string} rhythmId
 * @returns {string[]}
 */
export function datesForRhythm(log, rhythmId) {
  return log
    .filter((row) => row.rhythm_id === rhythmId)
    .map((row) => row.done_on)
    .sort();
}

/**
 * Has this rhythm already been logged on `date`?
 * @param {string[]} dates - done_on dates for one rhythm, any order
 * @param {string} date
 */
export function isLoggedOn(dates, date) {
  return dates.includes(date);
}

/**
 * Current streak for a `daily` rhythm: the length of the unbroken run of
 * days ending today. If today has not been logged yet, the streak still
 * reads as the run ending yesterday — the day is not over, so it has not
 * been broken yet, only not-yet-extended. A gap of two or more days resets
 * it to zero, and it stays zero until the rhythm is logged again.
 *
 * @param {string[]} dates - done_on dates for one `daily` rhythm
 * @param {{ today?: string }} [opts]
 * @returns {number}
 */
export function dailyStreak(dates, opts = {}) {
  const today = opts.today ?? todayISO();
  const set = new Set(dates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * How many times a `quota` rhythm has been logged in the Monday-Sunday
 * week containing `today`.
 * @param {string[]} dates
 * @param {{ today?: string }} [opts]
 */
export function quotaWeekCount(dates, opts = {}) {
  const today = opts.today ?? todayISO();
  const start = startOfWeek(today);
  const end = endOfWeek(today);
  return dates.filter((d) => d >= start && d <= end).length;
}

/**
 * Pip states for rendering a `quota` rhythm's progress: one entry per pip
 * up to the stretch target (or the floor, if no stretch is set), each
 * marked filled (logged) or ghost (beyond the floor — the optional
 * stretch pips). Hitting the floor is drawn as a complete row of filled
 * pips, so it reads as a win rather than a partial one.
 *
 * @param {{quota_floor: number, quota_stretch?: number|null}} rhythm
 * @param {string[]} dates
 * @param {{ today?: string }} [opts]
 * @returns {{filled: boolean, ghost: boolean}[]}
 */
export function quotaPips(rhythm, dates, opts = {}) {
  const count = quotaWeekCount(dates, opts);
  const floor = rhythm.quota_floor;
  const total = Math.max(rhythm.quota_stretch ?? floor, floor, count);
  const pips = [];
  for (let i = 0; i < total; i += 1) {
    pips.push({ filled: i < count, ghost: i >= floor });
  }
  return pips;
}

/**
 * Whether an `open` quota rhythm should still show in today's strip. Once
 * the floor is met the row quiets down and disappears — "a good day
 * physically shrinks the screen" — even though stretch pips remain
 * available to log elsewhere if the user wants to keep going.
 * @param {{quota_floor: number}} rhythm
 * @param {string[]} dates
 * @param {{ today?: string }} [opts]
 */
export function quotaIsOpen(rhythm, dates, opts = {}) {
  return quotaWeekCount(dates, opts) < rhythm.quota_floor;
}

/**
 * Whether a `quota` rhythm should nominate itself in the morning ritual:
 * every day remaining in the week must be used to still reach the floor.
 * Asks at most once per day — pass `alreadyAskedToday: true` once it has,
 * so a caller with session state can silence it without this function
 * needing to hold any state of its own.
 *
 * @param {{quota_floor: number}} rhythm
 * @param {string[]} dates
 * @param {{ today?: string, alreadyAskedToday?: boolean }} [opts]
 * @returns {{ shouldNominate: boolean, stillNeeded: number, daysRemaining: number }}
 */
export function quotaNomination(rhythm, dates, opts = {}) {
  const today = opts.today ?? todayISO();
  const count = quotaWeekCount(dates, { today });
  const stillNeeded = Math.max(0, rhythm.quota_floor - count);
  const daysRemaining = daysLeftInWeek(today);
  const shouldNominate = !opts.alreadyAskedToday && stillNeeded > 0 && daysRemaining <= stillNeeded;
  return { shouldNominate, stillNeeded, daysRemaining };
}

/** Days left in the Monday-Sunday week, counting today. */
function daysLeftInWeek(today) {
  const end = endOfWeek(today);
  // diffDays would need importing separately; compute inline via dayOfWeek.
  return 7 - dayOfWeek(today);
}

/**
 * The most recent date on/before `today` that a `scheduled` rhythm falls
 * on, given its fixed weekday or day-of-month. Returns null for a
 * malformed rhythm (neither weekday nor day_of_month set).
 *
 * @param {{weekday?: number|null, day_of_month?: number|null}} rhythm
 * @param {string} today
 * @returns {string|null}
 */
export function mostRecentOccurrence(rhythm, today) {
  if (rhythm.weekday != null) {
    const delta = (dayOfWeek(today) - rhythm.weekday + 7) % 7;
    return addDays(today, -delta);
  }
  if (rhythm.day_of_month != null) {
    // Walk back at most 31 days to find a matching day-of-month. Handles
    // short months (e.g. day_of_month=31 in a 30-day month) by finding the
    // most recent calendar day that actually matched, rather than assuming
    // every month has one.
    let cursor = today;
    for (let i = 0; i < 31; i += 1) {
      if (dayOfMonth(cursor) === rhythm.day_of_month) return cursor;
      cursor = addDays(cursor, -1);
    }
    return null;
  }
  return null;
}

/**
 * Whether a `scheduled` rhythm is open today: due today, or overdue from a
 * past occurrence it was never logged for ("missed ones carry over with a
 * quiet marker rather than vanishing").
 *
 * @param {object} rhythm
 * @param {string[]} dates
 * @param {{ today?: string }} [opts]
 * @returns {{ open: boolean, overdue: boolean, occurrence: string|null }}
 */
export function scheduledStatus(rhythm, dates, opts = {}) {
  const today = opts.today ?? todayISO();
  const occurrence = mostRecentOccurrence(rhythm, today);
  if (!occurrence) return { open: false, overdue: false, occurrence: null };
  const satisfied = dates.some((d) => d >= occurrence);
  return { open: !satisfied, overdue: !satisfied && occurrence !== today, occurrence };
}

/**
 * Whether a rhythm belongs in today's strip at all, dispatching by kind.
 * The strip only ever shows what is still open today — completed rhythms
 * disappear immediately, rhythms not due today are absent.
 *
 * @param {object} rhythm
 * @param {{rhythm_id: string, done_on: string}[]} log - full rhythm_log
 * @param {{ today?: string }} [opts]
 */
export function isOpenToday(rhythm, log, opts = {}) {
  if (!rhythm.active) return false;
  const dates = datesForRhythm(log, rhythm.id);
  const today = opts.today ?? todayISO();
  if (rhythm.kind === 'daily') return !isLoggedOn(dates, today);
  if (rhythm.kind === 'quota') return quotaIsOpen(rhythm, dates, { today });
  if (rhythm.kind === 'scheduled') return scheduledStatus(rhythm, dates, { today }).open;
  throw new Error(`unknown rhythm kind: ${rhythm.kind}`);
}

/**
 * Today's strip: every active, currently-open rhythm for a context, each
 * annotated with the display data its row needs (streak / pips / overdue).
 *
 * @param {object[]} rhythms
 * @param {{rhythm_id: string, done_on: string}[]} log
 * @param {{ context?: 'work'|'home', today?: string }} [opts]
 */
export function todaysStrip(rhythms, log, opts = {}) {
  const today = opts.today ?? todayISO();
  return rhythms
    .filter((r) => r.active && (!opts.context || r.context === opts.context))
    .filter((r) => isOpenToday(r, log, { today }))
    .map((r) => {
      const dates = datesForRhythm(log, r.id);
      if (r.kind === 'daily') return { rhythm: r, streak: dailyStreak(dates, { today }) };
      if (r.kind === 'quota') return { rhythm: r, pips: quotaPips(r, dates, { today }) };
      const status = scheduledStatus(r, dates, { today });
      return { rhythm: r, overdue: status.overdue, occurrence: status.occurrence };
    });
}
