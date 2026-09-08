/* Day-math utilities that operate in LOCAL time.
 *
 * Ported verbatim from katjanorstad.no's assets/js/day-math.js (todayISO,
 * addDays), converted from its UMD wrapper to an ES module to match this
 * app's module architecture. The bug it fixes and the reasoning are
 * unchanged from the original file:
 *
 *   THE BUG: constructing a Date at local midnight but reading it back via
 *   toISOString() reads UTC, so at any positive UTC offset (Europe, Asia)
 *   local midnight falls on the previous UTC day and date math silently
 *   loses a day.
 *
 *   THE FIX: work entirely in local time — parse with local getters, add
 *   days with local Date methods, format back with local getters. Never
 *   touch UTC methods (toISOString, Date.UTC, getUTCFullYear, etc.).
 *
 * Everything in this app that touches a day boundary — rollover at local
 * midnight, streaks, the Monday-Sunday quota week, scheduled rhythms —
 * goes through this module so the fix lives in exactly one place.
 */
'use strict';

/**
 * Returns today's date in local time as 'YYYY-MM-DD'.
 * @returns {string}
 */
export function todayISO() {
  return formatLocal(new Date());
}

/**
 * Adds n days to a date string, operating in local time.
 *
 * @param {string} dateStr - Date in 'YYYY-MM-DD' format
 * @param {number} n - Number of days to add (can be negative)
 * @returns {string} Result date in 'YYYY-MM-DD' format
 */
export function addDays(dateStr, n) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return formatLocal(d);
}

/**
 * Day of week, Monday-first: Monday = 0 ... Sunday = 6.
 *
 * The quota week and the weekly review both run Monday-Sunday, so every
 * "which day is this" question in the app is asked in this convention
 * rather than JS's native Sunday-first getDay().
 *
 * @param {string} dateStr
 * @returns {number} 0 (Monday) .. 6 (Sunday)
 */
export function dayOfWeek(dateStr) {
  const native = parseLocal(dateStr).getDay(); // 0=Sun..6=Sat
  return (native + 6) % 7;
}

/**
 * Day-of-month, 1-31, for matching `scheduled` rhythms like rent on the 1st.
 * @param {string} dateStr
 * @returns {number}
 */
export function dayOfMonth(dateStr) {
  return parseLocal(dateStr).getDate();
}

/**
 * The Monday that starts dateStr's week.
 * @param {string} dateStr
 * @returns {string} 'YYYY-MM-DD'
 */
export function startOfWeek(dateStr) {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

/**
 * The Sunday that ends dateStr's week.
 * @param {string} dateStr
 * @returns {string} 'YYYY-MM-DD'
 */
export function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

/**
 * b - a, in whole days. Local-time safe (DST-safe): both dates are parsed
 * at local midnight and compared as UTC millis of that same wall-clock
 * instant, which is invariant across a DST transition because it never
 * asks "how many hours apart are these," only "how many midnights."
 *
 * @param {string} a - 'YYYY-MM-DD'
 * @param {string} b - 'YYYY-MM-DD'
 * @returns {number}
 */
export function diffDays(a, b) {
  const da = parseLocal(a);
  const db = parseLocal(b);
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

/**
 * -1 if a<b, 0 if equal, 1 if a>b. Plain string comparison works because
 * 'YYYY-MM-DD' sorts lexically the same as chronologically, but this makes
 * the intent explicit at call sites instead of relying on that fact.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareDates(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isBefore(a, b) {
  return compareDates(a, b) < 0;
}

export function isAfter(a, b) {
  return compareDates(a, b) > 0;
}

// -- internal --------------------------------------------------------------

function parseLocal(dateStr) {
  const parts = dateStr.split('-');
  const yyyy = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10) - 1; // month is 0-indexed
  const dd = parseInt(parts[2], 10);
  return new Date(yyyy, mm, dd);
}

function formatLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
