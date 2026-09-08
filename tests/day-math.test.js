import test from 'node:test';
import assert from 'node:assert';
import {
  todayISO, addDays, dayOfWeek, dayOfMonth,
  startOfWeek, endOfWeek, diffDays, compareDates, isBefore, isAfter,
} from '../assets/js/day-math.js';

test('todayISO returns a well-formed local date', () => {
  const iso = todayISO();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(iso, expected);
});

test('addDays adds forward across a month boundary without UTC drift', () => {
  // The original bug: at a positive UTC offset, this returned the same day
  // instead of advancing, because it read the local-midnight Date back
  // through toISOString(). Regression-pinning it here.
  assert.equal(addDays('2026-09-04', 1), '2026-09-05');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
});

test('addDays adds backward across a year boundary', () => {
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('addDays across a DST spring-forward boundary (Europe, late March)', () => {
  // 2026-03-29 is the last Sunday of March 2026 — Europe/Oslo's DST switch.
  // Local-date arithmetic must not lose or gain a day around it.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
});

test('addDays with n=0 is the identity', () => {
  assert.equal(addDays('2026-09-08', 0), '2026-09-08');
});

test('dayOfWeek is Monday-first: Monday=0 .. Sunday=6', () => {
  // 2026-09-07 is a Monday.
  assert.equal(dayOfWeek('2026-09-07'), 0);
  assert.equal(dayOfWeek('2026-09-08'), 1); // Tuesday
  assert.equal(dayOfWeek('2026-09-13'), 6); // Sunday
});

test('dayOfMonth reads the day number for scheduled rhythms', () => {
  assert.equal(dayOfMonth('2026-09-01'), 1);
  assert.equal(dayOfMonth('2026-09-30'), 30);
});

test('startOfWeek and endOfWeek bracket a Monday-Sunday week', () => {
  // Wednesday 2026-09-09 falls in the week of Mon 2026-09-07..Sun 2026-09-13.
  assert.equal(startOfWeek('2026-09-09'), '2026-09-07');
  assert.equal(endOfWeek('2026-09-09'), '2026-09-13');
  // A Monday is the start of its own week.
  assert.equal(startOfWeek('2026-09-07'), '2026-09-07');
  // A Sunday is the end of its own week.
  assert.equal(endOfWeek('2026-09-13'), '2026-09-13');
});

test('diffDays counts whole days regardless of DST', () => {
  assert.equal(diffDays('2026-09-08', '2026-09-11'), 3);
  assert.equal(diffDays('2026-09-11', '2026-09-08'), -3);
  assert.equal(diffDays('2026-09-08', '2026-09-08'), 0);
  // Spans the March 2026 DST transition; must still read 3 whole days.
  assert.equal(diffDays('2026-03-28', '2026-03-31'), 3);
});

test('compareDates / isBefore / isAfter agree with each other', () => {
  assert.equal(compareDates('2026-09-08', '2026-09-09'), -1);
  assert.equal(compareDates('2026-09-09', '2026-09-08'), 1);
  assert.equal(compareDates('2026-09-08', '2026-09-08'), 0);
  assert.ok(isBefore('2026-09-08', '2026-09-09'));
  assert.ok(!isBefore('2026-09-09', '2026-09-08'));
  assert.ok(isAfter('2026-09-09', '2026-09-08'));
  assert.ok(!isAfter('2026-09-08', '2026-09-09'));
});
