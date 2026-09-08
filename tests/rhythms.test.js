import test from 'node:test';
import assert from 'node:assert';
import {
  datesForRhythm, isLoggedOn, dailyStreak, quotaWeekCount, quotaPips,
  quotaIsOpen, quotaNomination, mostRecentOccurrence, scheduledStatus,
  isOpenToday, todaysStrip,
} from '../assets/js/rhythms.js';

// -- helpers -----------------------------------------------------------

const dailyRhythm = { id: 'r1', kind: 'daily', context: 'home', active: true };
const quotaRhythm = {
  id: 'r2', kind: 'quota', context: 'home', active: true, quota_floor: 2, quota_stretch: 4,
};
const scheduledWeekday = {
  id: 'r3', kind: 'scheduled', context: 'home', active: true, weekday: 6, day_of_month: null,
}; // Sunday
const scheduledMonthly = {
  id: 'r4', kind: 'scheduled', context: 'home', active: true, weekday: null, day_of_month: 1,
};

function log(rows) {
  return rows.map(([rhythm_id, done_on]) => ({ rhythm_id, done_on }));
}

// -- datesForRhythm / isLoggedOn ----------------------------------------

test('datesForRhythm filters and sorts one rhythm out of the flat log', () => {
  const l = log([['r1', '2026-09-03'], ['r2', '2026-09-01'], ['r1', '2026-09-01']]);
  assert.deepEqual(datesForRhythm(l, 'r1'), ['2026-09-01', '2026-09-03']);
});

test('isLoggedOn checks membership', () => {
  assert.ok(isLoggedOn(['2026-09-01'], '2026-09-01'));
  assert.ok(!isLoggedOn(['2026-09-01'], '2026-09-02'));
});

// -- dailyStreak ----------------------------------------------------------

test('dailyStreak counts the unbroken run ending today', () => {
  const dates = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'];
  assert.equal(dailyStreak(dates, { today: '2026-09-08' }), 4);
});

test('dailyStreak counts the run ending yesterday if today is not logged yet', () => {
  const dates = ['2026-09-06', '2026-09-07'];
  assert.equal(dailyStreak(dates, { today: '2026-09-08' }), 2);
});

test('dailyStreak resets to 0 after a gap of 2+ days', () => {
  const dates = ['2026-09-01', '2026-09-02']; // nothing since, and today is far later
  assert.equal(dailyStreak(dates, { today: '2026-09-08' }), 0);
});

test('dailyStreak is 0 with no history', () => {
  assert.equal(dailyStreak([], { today: '2026-09-08' }), 0);
});

test('dailyStreak counts a single day logged today', () => {
  assert.equal(dailyStreak(['2026-09-08'], { today: '2026-09-08' }), 1);
});

// -- quota: week count, pips, open, nomination -----------------------------

test('quotaWeekCount only counts logs within the Monday-Sunday week', () => {
  const dates = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-14']; // last is next week
  // Week of 2026-09-08 (Tue) is Mon 09-07 .. Sun 09-13.
  assert.equal(quotaWeekCount(dates, { today: '2026-09-08' }), 2);
});

test('quotaPips: floor pips fill first, stretch pips are ghosts until logged', () => {
  const pips = quotaPips(quotaRhythm, ['2026-09-07'], { today: '2026-09-08' }); // 1 of floor 2, stretch 4
  assert.equal(pips.length, 4);
  assert.deepEqual(pips.map((p) => p.filled), [true, false, false, false]);
  assert.deepEqual(pips.map((p) => p.ghost), [false, false, true, true]);
});

test('quotaPips grows past stretch if somehow over-logged', () => {
  const dates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
  const pips = quotaPips(quotaRhythm, dates, { today: '2026-09-08' });
  assert.equal(pips.length, 5); // stretch is 4 but 5 were logged
});

test('quotaIsOpen is true until the floor is met, then false', () => {
  assert.ok(quotaIsOpen(quotaRhythm, ['2026-09-07'], { today: '2026-09-08' })); // 1 of 2
  assert.ok(!quotaIsOpen(quotaRhythm, ['2026-09-07', '2026-09-08'], { today: '2026-09-08' })); // 2 of 2
});

test('quota nominates itself only when every remaining day is needed', () => {
  // Sunday 2026-09-13 is the last day of the week: 1 day remaining.
  // Floor 2, 1 logged so far this week -> 1 still needed, 1 day left -> nominate.
  const oneLogged = ['2026-09-08'];
  const nom = quotaNomination(quotaRhythm, oneLogged, { today: '2026-09-13' });
  assert.equal(nom.shouldNominate, true);
  assert.equal(nom.stillNeeded, 1);
  assert.equal(nom.daysRemaining, 1);
});

test('quota does not nominate when there is still slack in the week', () => {
  // Tuesday: 6 days remaining, 2 still needed -> plenty of slack, no nomination.
  const nom = quotaNomination(quotaRhythm, [], { today: '2026-09-08' });
  assert.equal(nom.shouldNominate, false);
});

test('quota does not nominate once the floor is already met', () => {
  const met = ['2026-09-07', '2026-09-08'];
  const nom = quotaNomination(quotaRhythm, met, { today: '2026-09-13' });
  assert.equal(nom.shouldNominate, false);
  assert.equal(nom.stillNeeded, 0);
});

test('quota nomination respects alreadyAskedToday and does not nag', () => {
  const nom = quotaNomination(quotaRhythm, ['2026-09-08'], {
    today: '2026-09-13', alreadyAskedToday: true,
  });
  assert.equal(nom.shouldNominate, false);
});

// -- scheduled --------------------------------------------------------------

test('mostRecentOccurrence finds the most recent matching weekday', () => {
  // scheduledWeekday is Sunday (6). 2026-09-08 is a Tuesday.
  assert.equal(mostRecentOccurrence(scheduledWeekday, '2026-09-08'), '2026-09-06');
  // On the day itself, it is its own occurrence.
  assert.equal(mostRecentOccurrence(scheduledWeekday, '2026-09-06'), '2026-09-06');
});

test('mostRecentOccurrence finds the most recent matching day-of-month', () => {
  assert.equal(mostRecentOccurrence(scheduledMonthly, '2026-09-08'), '2026-09-01');
  assert.equal(mostRecentOccurrence(scheduledMonthly, '2026-09-01'), '2026-09-01');
});

test('scheduledStatus is open and not overdue exactly on its day if not yet logged', () => {
  const status = scheduledStatus(scheduledWeekday, [], { today: '2026-09-06' });
  assert.equal(status.open, true);
  assert.equal(status.overdue, false);
});

test('scheduledStatus is satisfied once logged on/after the occurrence', () => {
  const status = scheduledStatus(scheduledWeekday, ['2026-09-06'], { today: '2026-09-06' });
  assert.equal(status.open, false);
});

test('scheduledStatus carries over as overdue, with a marker, when missed', () => {
  const status = scheduledStatus(scheduledWeekday, [], { today: '2026-09-08' }); // Sun 09-06 missed
  assert.equal(status.open, true);
  assert.equal(status.overdue, true);
  assert.equal(status.occurrence, '2026-09-06');
});

test('scheduledStatus clears once the missed occurrence is logged late', () => {
  const status = scheduledStatus(scheduledWeekday, ['2026-09-07'], { today: '2026-09-08' });
  assert.equal(status.open, false);
});

// -- isOpenToday / todaysStrip ----------------------------------------------

test('isOpenToday: daily is open unless logged today', () => {
  assert.ok(isOpenToday(dailyRhythm, [], { today: '2026-09-08' }));
  const l = log([['r1', '2026-09-08']]);
  assert.ok(!isOpenToday(dailyRhythm, l, { today: '2026-09-08' }));
});

test('isOpenToday: inactive rhythms are never open', () => {
  const inactive = { ...dailyRhythm, active: false };
  assert.ok(!isOpenToday(inactive, [], { today: '2026-09-08' }));
});

test('todaysStrip shows only open rhythms for the given context, with display data', () => {
  const l = log([
    ['r1', '2026-09-07'], ['r1', '2026-09-08'], // daily done today -> closed
    ['r2', '2026-09-07'], // quota: 1 of floor 2 -> open
  ]);
  const rhythms = [dailyRhythm, quotaRhythm, scheduledWeekday];
  const strip = todaysStrip(rhythms, l, { context: 'home', today: '2026-09-08' });
  const ids = strip.map((row) => row.rhythm.id);
  // r1 done today -> absent. r2 quota still open. r3 scheduled Sunday, missed -> overdue+open.
  assert.deepEqual(ids.sort(), ['r2', 'r3']);
  const quotaRow = strip.find((row) => row.rhythm.id === 'r2');
  assert.ok(Array.isArray(quotaRow.pips));
  const scheduledRow = strip.find((row) => row.rhythm.id === 'r3');
  assert.equal(scheduledRow.overdue, true);
});

test('todaysStrip is empty once everything for the day is resolved', () => {
  const l = log([['r1', '2026-09-08']]);
  const strip = todaysStrip([dailyRhythm], l, { context: 'home', today: '2026-09-08' });
  assert.deepEqual(strip, []);
});

test('todaysStrip scopes to context and excludes the other one', () => {
  const workRhythm = { ...dailyRhythm, id: 'w1', context: 'work' };
  const strip = todaysStrip([dailyRhythm, workRhythm], [], { context: 'home', today: '2026-09-08' });
  assert.deepEqual(strip.map((r) => r.rhythm.id), ['r1']);
});
