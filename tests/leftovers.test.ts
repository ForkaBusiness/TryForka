// Cook once, eat twice: which dinners keep, where the second half goes, and how the
// grocery list counts a double batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLeftovers, groceryMultipliers, keepsWell, scheduleLeftovers,
  type Day, type LeftoverRecipe, type PlanEntryLike, type Slot, type WeekPlanLike,
} from '../src/lib/leftovers.ts';

const DAYS: Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const recipes: LeftoverRecipe[] = [
  { id: 1, name: 'Beef stew', category: 'Beef', total_minutes: 150 },
  { id: 2, name: 'Greek salad', category: 'Vegetarian' },
  { id: 3, name: 'Chicken stir-fry', category: 'Chicken' },
  { id: 4, name: 'Bean chili', category: 'Vegetarian' },
  { id: 5, name: 'Lamb tagine', category: 'Lamb' },
  { id: 6, name: 'Lentil dal', category: 'Vegetarian' },
  { id: 7, name: 'Fish tacos', category: 'Seafood' },
  { id: 8, name: 'Pasta bake', category: 'Pasta' },
];
const byId = new Map(recipes.map(r => [r.id, r]));
const entry = (id: number, extra: Partial<PlanEntryLike> = {}): PlanEntryLike => ({ id, title: byId.get(id)?.name ?? `Recipe ${id}`, image: `img/${id}.jpg`, ...extra });

/** A plan shaped like plan.ts: breakfast, lunch and dinner on every day, all empty. */
function week(dinners: Partial<Record<Day, PlanEntryLike>> = {}): WeekPlanLike {
  return Object.fromEntries(DAYS.map(d => [d, { breakfast: null, lunch: null, dinner: dinners[d] ?? null }])) as WeekPlanLike;
}
const BOTH: Slot[] = ['breakfast', 'lunch', 'dinner'];
const DINNERS: Slot[] = ['breakfast', 'dinner'];

test('keepsWell: stews, curries, chili, soups, bakes, pies and roasts keep; salads, stir-fries and fried dishes do not', () => {
  for (const name of ['Beef stew', 'Chicken curry', 'Bean chili', 'Chili con carne', 'Tomato soup', 'Sausage casserole', 'Pasta bake',
    'Braised short ribs', 'Vegetable lasagne', 'Fish pie', 'Roast chicken', 'Red lentil dal', 'Ragu', 'Spaghetti bolognese',
    'Lamb tagine', 'Clam chowder', 'Steak and ale pie', 'Egg curry']) {
    assert.equal(keepsWell({ id: 0, name }), true, name);
  }
  for (const name of ['Greek salad', 'Chicken stir-fry', 'Beef stir fry', 'Fried rice', 'Crispy pork belly', 'Salmon fillet', 'Steak frites',
    'Ribeye steak', 'Salmon sushi', 'Pancakes', 'Scrambled eggs', 'Cheese on toast', 'Beef burger', 'Club sandwich', 'Chilli prawns',
    'Roast salmon fillets', 'Curry chicken salad', 'Fish tacos']) {
    assert.equal(keepsWell({ id: 0, name }), false, name);
  }
});

test('keepsWell: whole words only, and the category counts too', () => {
  assert.equal(keepsWell({ id: 0, name: 'Chocolate piece' }), false, '"pie" does not match "piece"');
  assert.equal(keepsWell({ id: 0, name: 'Bakewell tart' }), false, '"bake" does not match "Bakewell"');
  assert.equal(keepsWell({ id: 0, name: 'Grandma\'s special', category: 'Stew' }), true);
  assert.equal(keepsWell({ id: 0, name: 'Shepherd\'s Pie' }), true);
  assert.equal(keepsWell({ id: 0, name: 'Tomato Soup', category: null }), true);
});

test('a stew on Monday dinner fills Tuesday lunch', () => {
  const plan = week({ monday: entry(1) });
  const { plan: out, links } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.deepEqual(out.monday.dinner, { ...entry(1), cookTimes: 2 });
  assert.deepEqual(out.tuesday.lunch, { id: 1, title: 'Beef stew', image: 'img/1.jpg', leftoverOf: { day: 'monday', slot: 'dinner', id: 1 } });
  assert.deepEqual(links, [{ from: { day: 'monday', slot: 'dinner' }, to: { day: 'tuesday', slot: 'lunch' }, id: 1 }]);
  assert.equal(plan.monday.dinner?.cookTimes, undefined, 'the input plan is not changed');
  assert.equal(plan.tuesday.lunch, null);
});

test('a salad or a stir-fry never becomes a source', () => {
  const plan = week({ monday: entry(2), tuesday: entry(3), wednesday: entry(7) });
  const { plan: out, links } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.deepEqual(links, []);
  assert.deepEqual(out, plan);
});

test('a recipe the map does not know is never a source', () => {
  const plan = week({ monday: entry(99) });
  assert.deepEqual(scheduleLeftovers(plan, { recipes: byId, slots: BOTH }).links, []);
});

test('chosen or locked targets are skipped and the next valid target is used', () => {
  const plan = week({ monday: entry(1), tuesday: entry(7, { chosen: true }), wednesday: entry(2) });
  plan.tuesday.lunch = entry(2, { locked: true });
  const { plan: out, links } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.deepEqual(links, [{ from: { day: 'monday', slot: 'dinner' }, to: { day: 'wednesday', slot: 'dinner' }, id: 1 }]);
  assert.deepEqual(out.tuesday.lunch, plan.tuesday.lunch);
  assert.deepEqual(out.tuesday.dinner, plan.tuesday.dinner);
  assert.equal(out.wednesday.dinner?.leftoverOf?.day, 'monday', 'a planned but unpicked dinner may be replaced');
});

test('a filled lunch nobody picked may take the leftover', () => {
  const plan = week({ monday: entry(1) });
  plan.tuesday.lunch = entry(2);
  const { plan: out } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.equal(out.tuesday.lunch?.leftoverOf?.id, 1);
});

test('without planned lunches the leftover goes to the next dinner', () => {
  const plan = week({ monday: entry(1) });
  const { plan: out, links } = scheduleLeftovers(plan, { recipes: byId, slots: DINNERS });
  assert.equal(out.tuesday.lunch, null);
  assert.deepEqual(links.map(l => l.to), [{ day: 'tuesday', slot: 'dinner' }]);
});

test('a missing slot key is treated as empty and only planned slots receive leftovers', () => {
  const plan = week({ monday: entry(1) });
  delete (plan.tuesday as Record<string, unknown>).lunch;
  const out = scheduleLeftovers(plan, { recipes: byId, slots: BOTH }).plan;
  assert.equal(out.tuesday.lunch?.leftoverOf?.id, 1);
  const noLunch = scheduleLeftovers(plan, { recipes: byId, slots: DINNERS }).plan;
  assert.equal('lunch' in noLunch.tuesday, false, 'an unplanned slot is not created');
  assert.equal(noLunch.tuesday.dinner?.leftoverOf?.id, 1);
});

test('fixed days are untouched, as source and as target', () => {
  const plan = week({ monday: entry(1), wednesday: entry(4) });
  const fixedSource = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, fixedDays: new Set<Day>(['monday']) });
  assert.deepEqual(fixedSource.plan.monday, plan.monday);
  assert.deepEqual(fixedSource.links.map(l => l.from.day), ['wednesday']);

  const fixedTarget = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, fixedDays: new Set<Day>(['tuesday']) });
  assert.deepEqual(fixedTarget.plan.tuesday, plan.tuesday);
  assert.deepEqual(fixedTarget.links[0], { from: { day: 'monday', slot: 'dinner' }, to: { day: 'wednesday', slot: 'dinner' }, id: 1 },
    'the Wednesday chili dinner was not picked, so it may be replaced');
});

test('never more than 2 days after cooking, and never past Sunday', () => {
  const plan = week({ monday: entry(1), tuesday: entry(2, { chosen: true }), wednesday: entry(3, { locked: true }) });
  const { links } = scheduleLeftovers(plan, { recipes: byId, slots: DINNERS });
  assert.deepEqual(links, [], 'Thursday is 3 days away');

  const sunday = week({ sunday: entry(1) });
  const out = scheduleLeftovers(sunday, { recipes: byId, slots: BOTH });
  assert.deepEqual(out.links, []);
  assert.deepEqual(out.plan, sunday);

  const saturday = week({ saturday: entry(1), sunday: entry(2, { chosen: true }) });
  assert.deepEqual(scheduleLeftovers(saturday, { recipes: byId, slots: DINNERS }).links, [], 'Saturday has only Sunday after it');

  for (let i = 0; i < DAYS.length; i++) {
    const p = week({ [DAYS[i]]: entry(1) });
    for (const l of scheduleLeftovers(p, { recipes: byId, slots: BOTH }).links) {
      const gap = DAYS.indexOf(l.to.day) - DAYS.indexOf(l.from.day);
      assert.ok(gap >= 1 && gap <= 2, `${l.from.day} to ${l.to.day}`);
    }
  }
});

test('maxPairs is respected, earliest sources first, one leftover per source', () => {
  const plan = week({ monday: entry(1), tuesday: entry(4), wednesday: entry(5), thursday: entry(6), friday: entry(8) });
  const two = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.deepEqual(two.links.map(l => l.from.day), ['monday', 'tuesday']);
  assert.deepEqual(two.links.map(l => l.to), [{ day: 'tuesday', slot: 'lunch' }, { day: 'wednesday', slot: 'lunch' }]);

  const one = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, maxPairs: 1 });
  assert.equal(one.links.length, 1);
  const none = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, maxPairs: 0 });
  assert.deepEqual(none.plan, plan);

  const many = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, maxPairs: 10 });
  assert.equal(many.links.length, 5);
  const sources = many.links.map(l => `${l.from.day}:${l.from.slot}`);
  assert.equal(new Set(sources).size, sources.length);
});

test('a dinner overwritten by an earlier leftover does not become a source itself', () => {
  const plan = week({ monday: entry(1), tuesday: entry(4) });
  const { links, plan: out } = scheduleLeftovers(plan, { recipes: byId, slots: DINNERS, maxPairs: 5 });
  assert.deepEqual(links, [{ from: { day: 'monday', slot: 'dinner' }, to: { day: 'tuesday', slot: 'dinner' }, id: 1 }]);
  assert.equal(out.tuesday.dinner?.cookTimes, undefined);
});

test('idempotent, and existing links are kept and count toward maxPairs', () => {
  const plan = week({ monday: entry(1), tuesday: entry(4), wednesday: entry(5), thursday: entry(6) });
  const first = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  const second = scheduleLeftovers(first.plan, { recipes: byId, slots: BOTH });
  assert.deepEqual(second.plan, first.plan);
  assert.deepEqual(second.links, first.links);

  const more = scheduleLeftovers(first.plan, { recipes: byId, slots: BOTH, maxPairs: 3 });
  assert.equal(more.links.length, 3);
  assert.deepEqual(more.links.slice(0, 2), first.links);
});

test('groceryMultipliers: a double batch counts 2, its leftover 0, everything else 1', () => {
  const plan = week({ monday: entry(1), tuesday: entry(2), wednesday: entry(4) });
  plan.monday.breakfast = entry(20);
  const { plan: out } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH, maxPairs: 1 });
  const rows = groceryMultipliers(out);
  assert.deepEqual(rows, [
    { day: 'monday', slot: 'breakfast', id: 20, multiplier: 1 },
    { day: 'monday', slot: 'dinner', id: 1, multiplier: 2 },
    { day: 'tuesday', slot: 'lunch', id: 1, multiplier: 0 },
    { day: 'tuesday', slot: 'dinner', id: 2, multiplier: 1 },
    { day: 'wednesday', slot: 'dinner', id: 4, multiplier: 1 },
  ]);
  const total = (id: number) => rows.filter(r => r.id === id).reduce((s, r) => s + r.multiplier, 0);
  assert.equal(total(1), 2, 'the stew is bought for two meals, once');
  assert.equal(rows.reduce((s, r) => s + r.multiplier, 0), 5, 'five meals planned, five bought');
});

test('groceryMultipliers: slot order within a day, and a leftover with no double batch still counts once', () => {
  const plan: WeekPlanLike = week();
  plan.monday = { dinner: entry(1), snack: entry(31), lunch: entry(32), school_lunch: entry(33), breakfast: entry(34) };
  assert.deepEqual(groceryMultipliers(plan).map(r => r.slot), ['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner']);

  const orphan = week();
  orphan.tuesday.lunch = { ...entry(1), leftoverOf: { day: 'monday', slot: 'dinner', id: 1 } };
  assert.deepEqual(groceryMultipliers(orphan), [{ day: 'tuesday', slot: 'lunch', id: 1, multiplier: 1 }]);
});

test('clearLeftovers restores the plan from before', () => {
  const plan = week({ monday: entry(1), wednesday: entry(4, { chosen: true }), friday: entry(2) });
  const { plan: out, links } = scheduleLeftovers(plan, { recipes: byId, slots: BOTH });
  assert.equal(links.length, 2);
  const cleared = clearLeftovers(out);
  assert.deepEqual(cleared, plan);
  assert.ok(groceryMultipliers(cleared).every(r => r.multiplier === 1));
  assert.equal(out.monday.dinner?.cookTimes, 2, 'the input of clearLeftovers is not changed');
  assert.deepEqual(clearLeftovers(plan), plan);
});
