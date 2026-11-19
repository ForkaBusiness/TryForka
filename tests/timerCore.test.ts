// Cooking timers keep correct time when the screen locks or the cook leaves the app, and
// show as finished on return; several run at once, each labeled with its step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMinute, createTimer, findTimer, formatClock, pause, remainingMs, resume, settle, timerAction, timerDetail, type Timer } from '../src/lib/timerCore.ts';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const simmer = () => createTimer({ label: 'Simmer 10 min', seconds: 600, recipeId: 7, recipeTitle: 'Tomato soup', step: 3 }, T0, 'a');
const bake = () => createTimer({ label: 'Bake 25-30 min', seconds: 1500, recipeId: 7, recipeTitle: 'Tomato soup', step: 5, range: '25-30 min' }, T0, 'b');

test('timers: correct after a screen lock with no ticks at all', () => {
  let list: Timer[] = [simmer()];
  // The phone locks for 7 minutes: no code runs. On return the time left is right.
  const back = T0 + 7 * MIN;
  ({ list } = settle(list, back));
  assert.equal(formatClock(remainingMs(list[0], back)), '3:00');
  assert.equal(list[0].done, false);
});

test('timers: one that ended while locked shows as finished on return, alerted once', () => {
  let list: Timer[] = [simmer()];
  const back = T0 + 25 * MIN;
  const first = settle(list, back);
  list = first.list;
  assert.equal(first.finished.length, 1);
  assert.equal(list[0].done, true);
  assert.equal(list[0].doneAt, T0 + 10 * MIN, 'remembers when it actually finished');
  assert.equal(remainingMs(list[0], back), 0);
  // Later ticks don't alert again, and the finished timer stays until dismissed.
  const again = settle(list, back + 5000);
  assert.equal(again.finished.length, 0);
  assert.equal(again.list.length, 1);
  assert.equal(again.list[0].done, true);
});

test('timers: several at once, each with its own end, across a lock', () => {
  let list: Timer[] = [simmer(), bake()];
  const back = T0 + 12 * MIN;
  const r = settle(list, back);
  list = r.list;
  assert.deepEqual(r.finished.map(t => t.id), ['a']);
  assert.equal(list[0].done, true);
  assert.equal(formatClock(remainingMs(list[1], back)), '13:00');
  const later = settle(list, T0 + 26 * MIN);
  assert.deepEqual(later.finished.map(t => t.id), ['b']);
});

test('timers: a paused timer does not run down while locked', () => {
  let t = pause(simmer(), T0 + 2 * MIN);
  assert.equal(remainingMs(t, T0 + 2 * MIN), 8 * MIN);
  const { list, finished } = settle([t], T0 + 60 * MIN);
  assert.equal(finished.length, 0);
  assert.equal(remainingMs(list[0], T0 + 60 * MIN), 8 * MIN);
  t = resume(list[0], T0 + 60 * MIN);
  assert.equal(remainingMs(t, T0 + 61 * MIN), 7 * MIN);
});

test('timers: a chip finds its own step\'s timer, even when two steps say the same', () => {
  const step2 = createTimer({ label: 'Cook 5 min', seconds: 300, recipeId: 7, recipeTitle: 'Soup', step: 2 }, T0, 's2');
  assert.equal(findTimer([step2], 7, 'Cook 5 min', 2)?.id, 's2');
  assert.equal(findTimer([step2], 7, 'Cook 5 min', 5), undefined, 'step 5 starts its own');
  assert.equal(findTimer([step2], 8, 'Cook 5 min', 2), undefined, 'another recipe');
  const old = { ...step2, step: null };
  assert.equal(findTimer([old], 7, 'Cook 5 min', 5)?.id, 's2', 'a timer saved before steps were kept still shows');
});

test('timers: never more time left than the timer is long (a clock read a moment early)', () => {
  assert.equal(remainingMs(simmer(), T0 - 900), 10 * MIN);
  assert.equal(formatClock(remainingMs(simmer(), T0 - 1500)), '10:00');
  const plus = addMinute(simmer(), T0);
  assert.equal(remainingMs(plus, T0 - 900), 11 * MIN);
});

test('timers: one more minute, also after it finished', () => {
  const t = addMinute(simmer(), T0);
  assert.equal(remainingMs(t, T0), 11 * MIN);
  const done = settle([simmer()], T0 + 10 * MIN).list[0];
  const again = addMinute(done, T0 + 11 * MIN);
  assert.equal(again.done, false);
  assert.equal(remainingMs(again, T0 + 11 * MIN), MIN);
});

test('timers: labeled with the step; a range counts the lower end and says so', () => {
  const b = bake();
  assert.equal(remainingMs(b, T0), 25 * MIN);
  assert.equal(timerAction(b.label), 'Bake');
  assert.equal(timerAction('Simmer 10 min'), 'Simmer');
  assert.equal(timerAction('Marinate 1 hr 30 min'), 'Marinate');
  assert.equal(timerDetail(simmer()), 'Step 3 · Tomato soup');
  assert.equal(timerDetail(b), 'Step 5 · Tomato soup · 25-30 min');
  assert.equal(timerDetail(settle([b], T0 + 26 * MIN).list[0]), 'Check it now. The recipe says 25-30 min.');
  assert.equal(formatClock(3 * 3600 * 1000 + 5000), '3:00:05');
  assert.equal(formatClock(4 * MIN + 12_000), '4:12');
});
