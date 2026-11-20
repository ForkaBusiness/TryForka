// Meal prep in about an hour: one cook, hands-off tasks overlapping hands-on ones,
// dependencies kept, and a calm note when it can't fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepStepTexts, schedulePrep, type PrepPlan, type PrepTask } from '../src/lib/prepSchedule.ts';

const roast: PrepTask = { id: 'roast', title: 'Roast the sweet potatoes', recipeId: 1, minutes: 40, handsOn: false, storage: 'Keeps 4 days in the fridge' };
const rice: PrepTask = { id: 'rice', title: 'Simmer the rice', recipeId: 2, minutes: 20, handsOn: false };
const chop: PrepTask = { id: 'chop', title: 'Chop the peppers', recipeId: 3, minutes: 15, handsOn: true };
const marinade: PrepTask = { id: 'marinade', title: 'Mix the marinade', recipeId: 4, minutes: 10, handsOn: true };
const BASIC = [chop, roast, marinade, rice];

/** Your time on each step never overlaps another: one cook, one thing at a time. */
function assertOneCook(plan: PrepPlan) {
  const busy = plan.steps.map(s => [s.start, s.busyUntil] as const).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < busy.length; i++) assert.ok(busy[i][0] >= busy[i - 1][1], `busy ${busy[i - 1]} overlaps ${busy[i]}`);
}

test('overlapping makes the session far shorter than the sum of the tasks', () => {
  const plan = schedulePrep(BASIC);
  const sum = BASIC.reduce((s, t) => s + t.minutes, 0);
  assert.equal(sum, 85);
  assert.ok(plan.totalMinutes <= 45, `total ${plan.totalMinutes}`);
  assert.equal(plan.totalMinutes, 40);
  assert.equal(plan.fits, true);
  assert.equal(plan.note, null);
  assert.equal(plan.handsOnMinutes, 3 + 3 + 15 + 10);
  assert.deepEqual(plan.steps.map(s => s.task.id), ['roast', 'rice', 'chop', 'marinade'], 'hands-off first, longest first');
  assert.deepEqual(plan.steps.map(s => [s.start, s.busyUntil, s.end]), [[0, 3, 40], [3, 6, 23], [6, 21, 21], [21, 31, 31]]);
  assertOneCook(plan);
});

test('dependencies are respected: the sauce waits for the chopping', () => {
  const onions: PrepTask = { id: 'onions', title: 'Chop the onions', recipeId: 5, minutes: 10, handsOn: true };
  const sauce: PrepTask = { id: 'sauce', title: 'Simmer the tomato sauce', recipeId: 5, minutes: 25, handsOn: false, startMinutes: 5, after: ['onions'] };
  const pack: PrepTask = { id: 'pack', title: 'Pack the lunches', recipeId: null, minutes: 5, handsOn: true, after: ['sauce', 'rice'] };
  const plan = schedulePrep([pack, sauce, ...BASIC, onions]);
  const at = (id: string) => plan.steps.find(s => s.task.id === id)!;
  assert.ok(at('sauce').start >= at('onions').end);
  assert.ok(at('pack').start >= at('sauce').end && at('pack').start >= at('rice').end);
  for (const step of plan.steps) for (const dep of step.task.after ?? []) assert.ok(step.start >= at(dep).end, `${step.task.id} after ${dep}`);
  assert.equal(at('sauce').busyUntil - at('sauce').start, 5, 'startMinutes is your time on a hands-off task');
  assertOneCook(plan);
});

test('the onions come before other chopping when the sauce waits on them', () => {
  const onions: PrepTask = { id: 'onions', title: 'Chop the onions', recipeId: 5, minutes: 5, handsOn: true };
  const sauce: PrepTask = { id: 'sauce', title: 'Simmer the sauce', recipeId: 5, minutes: 30, handsOn: false, after: ['onions'] };
  const plan = schedulePrep([chop, onions, sauce]);
  assert.deepEqual(plan.steps.map(s => s.task.id), ['onions', 'sauce', 'chop']);
  assert.equal(plan.totalMinutes, 35);
});

test('one cook never does two hands-on tasks at once', () => {
  const tasks: PrepTask[] = Array.from({ length: 8 }, (_, i) => ({
    id: `t${i}`, title: `Task ${i}`, recipeId: i, minutes: 5 + ((i * 7) % 13), handsOn: i % 3 !== 0,
    after: i > 2 && i % 2 === 0 ? [`t${i - 3}`] : undefined,
  }));
  const plan = schedulePrep(tasks, { budgetMinutes: 500 });
  assertOneCook(plan);
  assert.equal(plan.steps.length, tasks.length);
  assert.equal(plan.handsOnMinutes, plan.steps.reduce((s, x) => s + (x.busyUntil - x.start), 0));
});

test('during names the hands-off task running while you work', () => {
  const plan = schedulePrep(BASIC);
  const at = (id: string) => plan.steps.find(s => s.task.id === id)!;
  assert.equal(at('roast').during, null, 'nothing is running yet');
  assert.equal(at('rice').during, 'While the sweet potatoes roast');
  assert.equal(at('chop').during, 'While the sweet potatoes roast', 'the roast overlaps the chopping more than the rice');

  const solo = schedulePrep([{ id: 'r', title: 'Cook the rice', recipeId: 1, minutes: 20, handsOn: false }, chop]);
  assert.equal(solo.steps[1].during, 'While the rice cooks');
  const marinate = schedulePrep([{ id: 'm', title: 'Marinate the chicken in yogurt', recipeId: 1, minutes: 30, handsOn: false }, chop]);
  assert.equal(marinate.steps[1].during, 'While the chicken marinates');

  const after = schedulePrep([chop, { ...marinade, id: 'm2' }]);
  assert.ok(after.steps.every(s => s.during === null), 'hands-on only: nothing runs on its own');
});

test('over budget: fits is false and the note says what to move', () => {
  const soup: PrepTask = { id: 'soup', title: 'Simmer the soup', recipeId: 9, minutes: 85, handsOn: false };
  const plan = schedulePrep([...BASIC, soup]);
  assert.equal(plan.totalMinutes, 85);
  assert.equal(plan.fits, false);
  assert.equal(plan.note, 'This takes about 85 minutes. Move the soup to another day to fit an hour.');

  const tight = schedulePrep(BASIC, { budgetMinutes: 30 });
  assert.equal(tight.fits, false);
  assert.match(tight.note ?? '', /^This takes about 40 minutes\. Move the .+ to another day to fit half an hour\.$/);

  const longChop: PrepTask[] = [1, 2, 3].map(i => ({ id: `c${i}`, title: `Chop batch ${i}`, recipeId: 1, minutes: 30, handsOn: true }));
  const split = schedulePrep(longChop);
  assert.equal(split.note, 'This takes about 90 minutes. Split it across two sessions, or pick fewer recipes, to fit an hour.');

  const fits = schedulePrep(BASIC, { budgetMinutes: 40 });
  assert.equal(fits.fits, true);
  assert.equal(fits.note, null);
});

test('the same tasks always give the same plan', () => {
  const tasks = [...BASIC, { id: 'beans', title: 'Soak the beans', recipeId: 7, minutes: 20, handsOn: false }, { ...chop, id: 'chop2', title: 'Chop the herbs' }];
  const a = schedulePrep(tasks);
  const b = schedulePrep(tasks.map(t => ({ ...t })));
  assert.deepEqual(a, b);
  assert.deepEqual(prepStepTexts(a), prepStepTexts(b));
  // Ties go to input order.
  const x: PrepTask = { id: 'x', title: 'Grate the cheese', recipeId: 1, minutes: 5, handsOn: true };
  const y: PrepTask = { id: 'y', title: 'Wash the lettuce', recipeId: 2, minutes: 5, handsOn: true };
  assert.deepEqual(schedulePrep([x, y]).steps.map(s => s.task.id), ['x', 'y']);
  assert.deepEqual(schedulePrep([y, x]).steps.map(s => s.task.id), ['y', 'x']);
});

test('cycles, unknown ids and duplicate ids throw a clear error', () => {
  const a: PrepTask = { id: 'a', title: 'A', recipeId: null, minutes: 5, handsOn: true, after: ['b'] };
  const b: PrepTask = { id: 'b', title: 'B', recipeId: null, minutes: 5, handsOn: true, after: ['a'] };
  assert.throws(() => schedulePrep([a, b]), /wait on each other in a loop: a then b then a/);
  assert.throws(() => schedulePrep([{ ...a, after: ['a'] }]), /waits on itself/);
  assert.throws(() => schedulePrep([{ ...a, after: ['nope'] }]), /waits on "nope", which is not in this session/);
  assert.throws(() => schedulePrep([chop, chop]), /share the id "chop"/);
  assert.throws(() => schedulePrep([{ ...chop, minutes: -1 }]), /0 minutes or more/);
});

test('an empty session is zero minutes and fits', () => {
  assert.deepEqual(schedulePrep([]), { steps: [], totalMinutes: 0, handsOnMinutes: 0, fits: true, note: null });
  assert.deepEqual(prepStepTexts(schedulePrep([])), []);
});

test('prepStepTexts reads like cooking-mode steps, with no em dashes', () => {
  const plan = schedulePrep(BASIC);
  const texts = prepStepTexts(plan);
  assert.deepEqual(texts, [
    'Roast the sweet potatoes (40 min, 3 min of your time). Come back to it in 37 min, at the 40 min mark. Keeps 4 days in the fridge.',
    'While the sweet potatoes roast: simmer the rice (20 min, 3 min of your time). Come back to it in 17 min, at the 23 min mark.',
    'While the sweet potatoes roast: chop the peppers (15 min).',
    'While the sweet potatoes roast: mix the marinade (10 min).',
  ]);
  const overBudget = schedulePrep([...BASIC, { id: 'soup', title: 'Simmer the soup', recipeId: 9, minutes: 85, handsOn: false }]);
  for (const line of [...texts, ...prepStepTexts(overBudget), overBudget.note ?? '']) {
    assert.ok(!line.includes('—') && !line.includes('–'), line);
    assert.ok(!/\bAI\b/.test(line), line);
  }
});
