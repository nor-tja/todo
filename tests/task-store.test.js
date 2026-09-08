import test from 'node:test';
import assert from 'node:assert';
import {
  CAP, createTask, triage, commitToday, demote, complete, reopen,
  decline, touchSeen, rollover, selectBacklogRotation, todayList,
  remainingCapacity, repeatedlyDeclined,
} from '../assets/js/task-store.js';

test('createTask starts in inbox with only a title', () => {
  const t = createTask('  water the tomatoes  ', { now: '2026-09-08T08:00:00.000Z' });
  assert.equal(t.state, 'inbox');
  assert.equal(t.title, 'water the tomatoes'); // trimmed
  assert.equal(t.context, null);
  assert.equal(t.deadline, null);
  assert.equal(t.declined_count, 0);
  assert.ok(t.id);
});

test('createTask rejects an empty title', () => {
  assert.throws(() => createTask('   '));
});

test('triage moves inbox to backlog and sets context', () => {
  const t = createTask('renew passport');
  const triaged = triage(t, 'home', { now: '2026-09-08T09:00:00.000Z' });
  assert.equal(triaged.state, 'backlog');
  assert.equal(triaged.context, 'home');
  // original is untouched (pure function)
  assert.equal(t.state, 'inbox');
});

test('triage rejects an invalid context', () => {
  const t = createTask('x');
  assert.throws(() => triage(t, 'personal'));
});

test('commitToday moves backlog to today and sets committed_on', () => {
  const t = triage(createTask('write report'), 'work');
  const result = commitToday(t, [t], { today: '2026-09-08' });
  assert.equal(result.ok, true);
  assert.equal(result.task.state, 'today');
  assert.equal(result.task.committed_on, '2026-09-08');
});

test('commitToday enforces the hard cap of 5', () => {
  const today = '2026-09-08';
  const committed = Array.from({ length: CAP }, (_, i) =>
    commitToday(triage(createTask(`task ${i}`), 'work'), [], { today }).task);
  const sixth = triage(createTask('one more'), 'work');
  const result = commitToday(sixth, committed, { today });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cap');
});

test('committing the 6th succeeds once one of the 5 is demoted', () => {
  const today = '2026-09-08';
  let committed = Array.from({ length: CAP }, (_, i) =>
    commitToday(triage(createTask(`task ${i}`), 'work'), [], { today }).task);
  committed[0] = demote(committed[0]);
  const sixth = triage(createTask('one more'), 'work');
  const result = commitToday(sixth, committed, { today });
  assert.equal(result.ok, true);
});

test('cap is scoped across all tasks regardless of context (one shared Today)', () => {
  const today = '2026-09-08';
  const four = Array.from({ length: 4 }, (_, i) =>
    commitToday(triage(createTask(`work ${i}`), 'work'), [], { today }).task);
  const homeTask = triage(createTask('home task'), 'home');
  // 4 committed + this 1 = 5, within cap.
  const okResult = commitToday(homeTask, four, { today });
  assert.equal(okResult.ok, true);
  const five = [...four, okResult.task];
  const sixthHome = triage(createTask('second home task'), 'home');
  const capped = commitToday(sixthHome, five, { today });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'cap');
});

test('commitToday on an already-today task is a no-op success', () => {
  const t = commitToday(triage(createTask('x'), 'work'), [], { today: '2026-09-08' }).task;
  const result = commitToday(t, [t], { today: '2026-09-08' });
  assert.equal(result.ok, true);
  assert.equal(result.task.state, 'today');
});

test('commitToday refuses a done task', () => {
  const t = complete(commitToday(triage(createTask('x'), 'work'), [], { today: '2026-09-08' }).task);
  const result = commitToday(t, [t], { today: '2026-09-08' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong-state');
});

test('demote clears committed_on and returns to backlog', () => {
  const t = commitToday(triage(createTask('x'), 'work'), [], { today: '2026-09-08' }).task;
  const demoted = demote(t, { now: '2026-09-09T00:00:00.000Z' });
  assert.equal(demoted.state, 'backlog');
  assert.equal(demoted.committed_on, null);
});

test('complete sets completed_at and retains the task', () => {
  const t = commitToday(triage(createTask('x'), 'work'), [], { today: '2026-09-08' }).task;
  const done = complete(t, { now: '2026-09-08T18:00:00.000Z' });
  assert.equal(done.state, 'done');
  assert.equal(done.completed_at, '2026-09-08T18:00:00.000Z');
});

test('reopen undoes a completion back to backlog', () => {
  const t = complete(commitToday(triage(createTask('x'), 'work'), [], { today: '2026-09-08' }).task);
  const reopened = reopen(t, { now: '2026-09-09T00:00:00.000Z' });
  assert.equal(reopened.state, 'backlog');
  assert.equal(reopened.completed_at, null);
});

test('decline increments declined_count and bumps last_seen_at', () => {
  const t = triage(createTask('paint fence'), 'home', { now: '2026-08-01T00:00:00.000Z' });
  const d1 = decline(t, { now: '2026-08-08T00:00:00.000Z' });
  assert.equal(d1.declined_count, 1);
  const d2 = decline(d1, { now: '2026-08-15T00:00:00.000Z' });
  assert.equal(d2.declined_count, 2);
  assert.equal(d2.last_seen_at, '2026-08-15T00:00:00.000Z');
});

test('commitToday resets declined_count — being picked up resolves avoidance', () => {
  let t = triage(createTask('paint fence'), 'home');
  t = decline(t);
  t = decline(t);
  assert.equal(t.declined_count, 2);
  const result = commitToday(t, [t], { today: '2026-09-08' });
  assert.equal(result.task.declined_count, 0);
});

test('touchSeen bumps last_seen_at without touching declined_count', () => {
  const t = triage(createTask('x'), 'home', { now: '2026-08-01T00:00:00.000Z' });
  const seen = touchSeen(t, { now: '2026-08-20T00:00:00.000Z' });
  assert.equal(seen.last_seen_at, '2026-08-20T00:00:00.000Z');
  assert.equal(seen.declined_count, 0);
});

test('rollover demotes today-tasks left over from a previous day', () => {
  const stale = commitToday(triage(createTask('yesterday'), 'work'), [], { today: '2026-09-07' }).task;
  const rolled = rollover([stale], { today: '2026-09-08' });
  assert.equal(rolled[0].state, 'backlog');
  assert.equal(rolled[0].committed_on, null);
});

test('rollover leaves tasks committed today untouched (same reference)', () => {
  const fresh = commitToday(triage(createTask('today'), 'work'), [], { today: '2026-09-08' }).task;
  const rolled = rollover([fresh], { today: '2026-09-08' });
  assert.equal(rolled[0], fresh); // same object reference — no-op
});

test('rollover leaves inbox, backlog and done tasks untouched', () => {
  const inbox = createTask('a');
  const backlog = triage(createTask('b'), 'work');
  const done = complete(commitToday(triage(createTask('c'), 'work'), [], { today: '2026-09-07' }).task);
  const rolled = rollover([inbox, backlog, done], { today: '2026-09-08' });
  assert.deepEqual(rolled, [inbox, backlog, done]);
});

test('rollover is idempotent across repeated calls on the same day', () => {
  const stale = commitToday(triage(createTask('yesterday'), 'work'), [], { today: '2026-09-07' }).task;
  const once = rollover([stale], { today: '2026-09-08' });
  const twice = rollover(once, { today: '2026-09-08' });
  assert.deepEqual(once, twice);
});

test('selectBacklogRotation returns least-recently-seen first, capped at count', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i) =>
    triage(createTask(name), 'home', { now: `2026-0${(i % 9) + 1}-01T00:00:00.000Z` }));
  // Shuffle so input order doesn't already match expected output order.
  const shuffled = [items[3], items[0], items[5], items[1], items[4], items[2]];
  const rotation = selectBacklogRotation(shuffled, { count: 5 });
  assert.equal(rotation.length, 5);
  assert.deepEqual(rotation.map((t) => t.title), ['a', 'b', 'c', 'd', 'e']);
});

test('selectBacklogRotation only pulls from backlog, scoped by context', () => {
  const homeBacklog = triage(createTask('home item'), 'home', { now: '2026-01-01T00:00:00.000Z' });
  const workBacklog = triage(createTask('work item'), 'work', { now: '2026-01-01T00:00:00.000Z' });
  const inboxItem = createTask('inbox item');
  const rotation = selectBacklogRotation([homeBacklog, workBacklog, inboxItem], { context: 'home' });
  assert.deepEqual(rotation.map((t) => t.title), ['home item']);
});

test('todayList filters by context and sorts by sort_order', () => {
  const a = { ...commitToday(triage(createTask('a'), 'work'), [], { today: '2026-09-08' }).task, sort_order: 2 };
  const b = { ...commitToday(triage(createTask('b'), 'work'), [], { today: '2026-09-08' }).task, sort_order: 1 };
  const home = commitToday(triage(createTask('c'), 'home'), [], { today: '2026-09-08' }).task;
  const list = todayList([a, b, home], { context: 'work' });
  assert.deepEqual(list.map((t) => t.title), ['b', 'a']);
});

test('remainingCapacity counts down from the cap', () => {
  const today = '2026-09-08';
  assert.equal(remainingCapacity([], { context: 'work' }), CAP);
  const three = Array.from({ length: 3 }, (_, i) =>
    commitToday(triage(createTask(`t${i}`), 'work'), [], { today }).task);
  assert.equal(remainingCapacity(three, { context: 'work' }), CAP - 3);
});

test('repeatedlyDeclined surfaces backlog items declined 3+ times', () => {
  let avoided = triage(createTask('clean gutters'), 'home');
  avoided = decline(decline(decline(avoided)));
  const onceDeclined = decline(triage(createTask('other'), 'home'));
  const list = repeatedlyDeclined([avoided, onceDeclined]);
  assert.deepEqual(list.map((t) => t.title), ['clean gutters']);
});
