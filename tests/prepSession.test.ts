// Meal prep sessions: which meals can be prepped on a day, and the session as cooking steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPicks, prepCandidates, prepServings, prepSteps, sessionSummary, WEEK } from '../src/lib/prepSession.ts';
import { schedulePrep } from '../src/lib/prepSchedule.ts';

const e = (id: number, title: string, extra = {}) => ({ id, title, image: '', ...extra });
const empty = () => Object.fromEntries(WEEK.map(d => [d, { breakfast: null, school_lunch: null, lunch: null, snack: null, dinner: null }])) as never;

function week() {
  const plan = empty() as Record<string, Record<string, unknown>>;
  plan.sunday.dinner = e(1, 'Sunday roast');
  plan.monday.breakfast = e(2, 'Overnight oats');
  plan.monday.dinner = e(3, 'Beef stew', { cookTimes: 2 });
  plan.tuesday.lunch = e(3, 'Beef stew', { leftoverOf: { day: 'monday', slot: 'dinner', id: 3 } });
  plan.tuesday.school_lunch = e(4, 'Turkey wraps');
  plan.tuesday.snack = e(5, 'Apple slices');
  plan.tuesday.dinner = e(6, 'Chicken curry');
  plan.wednesday.dinner = e(7, 'Pasta bake');
  plan.thursday.dinner = e(6, 'Chicken curry');
  plan.friday.dinner = e(8, 'Fish tacos');
  return plan as never;
}

test('prep candidates: from the prep day on, once each, without leftovers or snacks', () => {
  const c = prepCandidates(week(), 'monday');
  assert.deepEqual(c.map(x => x.title), ['Overnight oats', 'Beef stew', 'Turkey wraps', 'Chicken curry', 'Pasta bake', 'Fish tacos', 'Sunday roast']);
  assert.ok(!c.some(x => x.slot === 'snack'));
  assert.deepEqual(prepCandidates(week(), 'wednesday').map(x => x.title), ['Pasta bake', 'Chicken curry', 'Fish tacos', 'Sunday roast']);
  assert.deepEqual(prepCandidates(week(), 'sunday').map(x => x.title), ['Sunday roast']);
});

test('default picks: the first three lunches and dinners before breakfasts', () => {
  assert.deepEqual(defaultPicks(prepCandidates(week(), 'monday')), [3, 4, 6]);
  assert.deepEqual(defaultPicks(prepCandidates(week(), 'sunday')), [1]);
});

test('prep steps: hands-off tasks get a timer for the time they run on their own', () => {
  const plan = schedulePrep([
    { id: 'rice', title: 'Cook the rice', recipeId: 6, minutes: 20, handsOn: false, startMinutes: 2, storage: 'Keeps 4 days in the fridge' },
    { id: 'chop', title: 'Chop the peppers and onions', recipeId: 7, minutes: 15, handsOn: true },
    { id: 'roast', title: 'Roast the vegetables, at 200C', recipeId: 7, minutes: 35, handsOn: false, startMinutes: 3, after: ['chop'] },
  ]);
  const steps = prepSteps(plan);
  assert.equal(steps.length, 3);
  const rice = steps.find(s => /rice/i.test(s.text_us))!;
  assert.equal(rice.timers.length, 1);
  assert.equal(rice.timers[0].seconds, 18 * 60);
  assert.match(rice.timers[0].label, /^Cook the rice 18 min$/);
  assert.match(rice.text_us, /Keeps 4 days in the fridge/);
  const chop = steps.find(s => /Chop/i.test(s.text_us))!;
  assert.equal(chop.timers.length, 0, 'hands-on work needs no timer');
  const roast = steps.find(s => /Roast/i.test(s.text_us))!;
  assert.match(roast.timers[0].label, /^Roast the vegetables 32 min$/);
  for (const s of steps) assert.ok(!/—/.test(s.text_us), 'no em dashes');
});

test('session summary reads plainly', () => {
  const plan = schedulePrep([
    { id: 'a', title: 'Simmer the stew', recipeId: 3, minutes: 50, handsOn: false, startMinutes: 5 },
    { id: 'b', title: 'Chop the salad', recipeId: 4, minutes: 20, handsOn: true },
  ]);
  assert.equal(sessionSummary(plan), 'About 50 minutes, 25 of them hands-on.');
  const long = schedulePrep([
    { id: 'a', title: 'Chop everything', recipeId: 3, minutes: 45, handsOn: true },
    { id: 'b', title: 'Pack the lunches', recipeId: 4, minutes: 30, handsOn: true },
  ]);
  assert.equal(sessionSummary(long), 'About an hour and 15 minutes, all hands-on.');
});

test('a braise that keeps going after the cook is done is said apart, not counted as kitchen time', () => {
  const plan = schedulePrep([
    { id: 'braise', title: 'Braise the beef stew in the oven', recipeId: 3, minutes: 120, handsOn: false, startMinutes: 5 },
    { id: 'chop', title: 'Chop the vegetables', recipeId: 4, minutes: 25, handsOn: true },
    { id: 'rice', title: 'Cook the rice', recipeId: 6, minutes: 20, handsOn: false, startMinutes: 2 },
  ]);
  assert.equal(sessionSummary(plan), 'About 32 minutes, all hands-on. After that, one thing keeps going on its own for about 88 minutes: braise the beef stew in the oven.');
});

test('prep amounts match the grocery list: a double batch twice, a school lunch for the children who take it', () => {
  const plan = week() as Record<string, Record<string, Record<string, unknown> | null>>;
  plan.tuesday.school_lunch = { ...plan.tuesday.school_lunch!, share: 0.5 };
  const c = prepCandidates(plan as never, 'monday');
  const by = (title: string) => c.find(x => x.title === title)!;
  assert.equal(prepServings(by('Beef stew'), 4), 8);
  assert.equal(prepServings(by('Turkey wraps'), 4), 2);
  assert.equal(prepServings(by('Pasta bake'), 4), 4);
  assert.equal(prepServings({ scale: 0.1 }, 4), 1, 'never less than one serving');
});
