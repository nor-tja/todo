import test from 'node:test';
import assert from 'node:assert';
import { createTask, triage, commitToday, complete } from '../assets/js/task-store.js';
import {
  runMorningRollover, inboxQueue, deadlineNominations, quotaNominations,
  morningRitual, finishedThisWeek, rhythmPerformance, weeklyRitual,
  DEADLINE_LOOKAHEAD_DAYS,
} from '../assets/js/review.js';

test('runMorningRollover surfaces yesterday\'s leftovers as rolledOver', () => {
  const stale = commitToday(triage(createTask('yesterday'), 'work'), [], { today: '2026-09-07' }).task;
  const fresh = createTask('unrelated inbox item');
  const { tasks, rolledOver } = runMorningRollover([stale, fresh], { today: '2026-09-08' });
  assert.equal(rolledOver.length, 1);
  assert.equal(rolledOver[0].title, 'yesterday');
  assert.equal(rolledOver[0].state, 'backlog');
  assert.equal(tasks.find((t) => t.title === 'unrelated inbox item').state, 'inbox');
});

test('runMorningRollover reports no leftovers on a clean morning', () => {
  const fresh = commitToday(triage(createTask('today'), 'work'), [], { today: '2026-09-08' }).task;
  const { rolledOver } = runMorningRollover([fresh], { today: '2026-09-08' });
  assert.deepEqual(rolledOver, []);
});

test('inboxQueue orders oldest-first', () => {
  const a = createTask('first', { now: '2026-09-01T00:00:00.000Z' });
  const b = createTask('second', { now: '2026-09-05T00:00:00.000Z' });
  const backlog = triage(createTask('not inbox'), 'work');
  const queue = inboxQueue([b, backlog, a]);
  assert.deepEqual(queue.map((t) => t.title), ['first', 'second']);
});

test('deadlineNominations includes tasks within the lookahead window', () => {
  const near = triage(createTask('passport renewal'), 'home');
  near.deadline = '2026-09-10'; // 2 days out from 09-08, within 3-day lookahead
  const far = triage(createTask('far off'), 'home');
  far.deadline = '2026-09-20';
  const list = deadlineNominations([near, far], { today: '2026-09-08' });
  assert.deepEqual(list.map((t) => t.title), ['passport renewal']);
});

test('deadlineNominations keeps nominating overdue tasks (never inserted, just asked)', () => {
  const overdue = triage(createTask('overdue bill'), 'home');
  overdue.deadline = '2026-09-01';
  const list = deadlineNominations([overdue], { today: '2026-09-08' });
  assert.deepEqual(list.map((t) => t.title), ['overdue bill']);
});

test('deadlineNominations excludes tasks already asked about today', () => {
  const near = triage(createTask('x'), 'home');
  near.deadline = '2026-09-09';
  const list = deadlineNominations([near], { today: '2026-09-08', askedIds: new Set([near.id]) });
  assert.deepEqual(list, []);
});

test('deadlineNominations ignores tasks with no deadline or already committed today', () => {
  const noDeadline = triage(createTask('x'), 'home');
  const committed = commitToday(triage(createTask('y'), 'home'), [], { today: '2026-09-08' }).task;
  committed.deadline = '2026-09-08';
  const list = deadlineNominations([noDeadline, committed], { today: '2026-09-08' });
  assert.deepEqual(list, []);
});

test('deadline lookahead constant matches the spec (3 days)', () => {
  assert.equal(DEADLINE_LOOKAHEAD_DAYS, 3);
});

test('quotaNominations surfaces at-risk quota rhythms for the ritual', () => {
  const rhythm = { id: 'r1', kind: 'quota', context: 'home', active: true, quota_floor: 2, quota_stretch: 4 };
  const log = [{ rhythm_id: 'r1', done_on: '2026-09-08' }];
  // Sunday, 1 day left, 1 still needed -> nominate.
  const list = quotaNominations([rhythm], log, { today: '2026-09-13', context: 'home' });
  assert.equal(list.length, 1);
  assert.equal(list[0].stillNeeded, 1);
});

test('quotaNominations respects askedIds', () => {
  const rhythm = { id: 'r1', kind: 'quota', context: 'home', active: true, quota_floor: 2, quota_stretch: 4 };
  const list = quotaNominations([rhythm], [], { today: '2026-09-13', askedIds: new Set(['r1']) });
  assert.deepEqual(list, []);
});

test('morningRitual sequences all four steps together', () => {
  const stale = commitToday(triage(createTask('leftover'), 'work'), [], { today: '2026-09-07' }).task;
  const inboxItem = createTask('paper note');
  const deadlineTask = triage(createTask('deadline soon'), 'work');
  deadlineTask.deadline = '2026-09-09';
  const rhythm = { id: 'r1', kind: 'quota', context: 'work', active: true, quota_floor: 1, quota_stretch: 2 };
  const result = morningRitual([stale, inboxItem, deadlineTask], [rhythm], [], {
    today: '2026-09-08', context: 'work',
  });
  assert.equal(result.rolledOver.length, 1);
  assert.equal(result.inbox.length, 1);
  assert.equal(result.deadlineNominations.length, 1);
  // Tuesday, floor 1, none logged: plenty of slack, no quota nomination yet.
  assert.equal(result.quotaNominations.length, 0);
});

test('finishedThisWeek only counts completions within the Mon-Sun week', () => {
  const inWeek = complete(
    commitToday(triage(createTask('a'), 'work'), [], { today: '2026-09-07' }).task,
    { now: '2026-09-09T10:00:00.000Z' },
  );
  const lastWeek = complete(
    commitToday(triage(createTask('b'), 'work'), [], { today: '2026-08-31' }).task,
    { now: '2026-08-31T10:00:00.000Z' },
  );
  const list = finishedThisWeek([inWeek, lastWeek], { today: '2026-09-09' });
  assert.deepEqual(list.map((t) => t.title), ['a']);
});

test('rhythmPerformance summarizes daily, quota and scheduled rhythms', () => {
  const daily = { id: 'd1', kind: 'daily', context: 'home', active: true };
  const quota = { id: 'q1', kind: 'quota', context: 'home', active: true, quota_floor: 2, quota_stretch: 3 };
  const scheduled = { id: 's1', kind: 'scheduled', context: 'home', active: true, weekday: 1, day_of_month: null }; // Tuesday
  const log = [
    { rhythm_id: 'd1', done_on: '2026-09-08' },
    { rhythm_id: 'q1', done_on: '2026-09-07' },
    { rhythm_id: 'q1', done_on: '2026-09-08' },
    { rhythm_id: 's1', done_on: '2026-09-08' }, // this Tuesday, within the current week
  ];
  const perf = rhythmPerformance([daily, quota, scheduled], log, { today: '2026-09-08', context: 'home' });
  const byId = Object.fromEntries(perf.map((p) => [p.rhythm.id, p]));
  assert.equal(byId.d1.streak, 1);
  assert.equal(byId.q1.count, 2);
  assert.equal(byId.q1.metFloor, true);
  assert.equal(byId.q1.metStretch, false);
  assert.equal(byId.s1.hits, 1);
});

test('weeklyRitual bundles finished, performance, rotation and repeated declines', () => {
  const result = weeklyRitual([], [], [], { today: '2026-09-08', context: 'home' });
  assert.deepEqual(result.finished, []);
  assert.deepEqual(result.rhythmPerformance, []);
  assert.deepEqual(result.backlogRotation, []);
  assert.deepEqual(result.repeatedlyDeclined, []);
});
