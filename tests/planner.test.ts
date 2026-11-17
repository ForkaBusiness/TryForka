// Planner tests: ranking from what the family told us, allergies as hard filters, the
// days the daily update may touch, and the note that explains a change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaste, changeNote, emptyWeek, markChosen, NO_SIGNALS, openDays, planEdits, planWeek, rankRecipes, scoreRecipe, updatePlan, when, who,
  type PlannerMember, type PlannerRecipe, type PlannerWeek, type Signals,
} from '../src/lib/planner.ts';
import { shoppedRecipeIds } from '../src/lib/groceryMerge.ts';

const NOW = new Date('2026-11-18T19:30:00'); // a Wednesday evening
const none = { allergies: [], skip_ingredients: [] };

let nextId = 1;
function recipe(name: string, category: string, area: string, ingredients: string[], extra: Partial<PlannerRecipe> = {}): PlannerRecipe {
  return { id: nextId++, name, category, area, ingredient_names: ingredients, total_minutes: 30, meal_role: 'main', allergens: [], diets: [], ...extra };
}

const tacos = recipe('Chicken tacos', 'Chicken', 'Mexican', ['chicken thigh', 'tortilla', 'lime']);
const fajitas = recipe('Chicken fajitas', 'Chicken', 'Mexican', ['chicken thigh', 'tortilla', 'bell pepper']);
const curry = recipe('Fish curry', 'Seafood', 'Thai', ['cod', 'coconut milk', 'lime leaf']);
const fishPie = recipe('Fish pie', 'Seafood', 'British', ['cod', 'potato', 'milk'], { allergens: ['dairy', 'fish'] });
const stew = recipe('Beef stew', 'Beef', 'Irish', ['beef', 'carrot', 'potato'], { total_minutes: 150 });
const pasta = recipe('Tomato pasta', 'Pasta', 'Italian', ['spaghetti', 'tomato', 'basil'], { allergens: ['gluten'] });
const satay = recipe('Peanut noodles', 'Chicken', 'Thai', ['peanut butter', 'noodles', 'chicken thigh'], { allergens: ['peanut', 'gluten'] });
const chili = recipe('Bean chili', 'Vegetarian', 'American', ['kidney bean', 'tomato', 'cumin']);
const pilaf = recipe('Lamb pilaf', 'Lamb', 'Turkish', ['lamb', 'rice', 'onion']);
const omelette = recipe('Herb omelette', 'Breakfast', 'French', ['egg', 'chive'], { meal_role: 'breakfast', allergens: ['egg'] });
const ALL = [tacos, fajitas, curry, fishPie, stew, pasta, satay, chili, pilaf, omelette];

const mia: PlannerMember = { id: 'mia', name: 'Mia', kind: 'kid', likes: [], dislikes: [] };
const leo: PlannerMember = { id: 'leo', name: 'Leo', kind: 'kid', likes: [], dislikes: [] };
const sam: PlannerMember = { id: 'sam', name: 'Sam', kind: 'adult', likes: [], dislikes: [] };
const FAMILY = [sam, mia, leo];

const signals = (s: Partial<Signals>): Signals => ({ ...NO_SIGNALS, ...s });
const checkin = (r: PlannerRecipe, date: string, answers: Record<string, 'loved' | 'fine' | 'skipped'>) =>
  Object.entries(answers).map(([memberId, response]) => ({ recipeId: r.id, memberId, response, date }));
const taste = (s: Partial<Signals>, members = FAMILY, avoid: string[] = []) => buildTaste(signals(s), ALL, members, NOW, avoid);
const order = (t: ReturnType<typeof taste>, food = none) => rankRecipes(ALL, t, food).map(c => c.recipe.name);
const week = (dinners: Partial<Record<keyof PlannerWeek, PlannerRecipe>>): PlannerWeek => {
  const plan = emptyWeek();
  for (const [day, r] of Object.entries(dinners)) plan[day as keyof PlannerWeek].dinner = { id: r.id, title: r.name, image: '' };
  return plan;
};

// ── Ranking ────────────────────────────────────────────────────────────────

test('with no history every recipe scores the same', () => {
  const t = taste({});
  for (const r of ALL) assert.equal(scoreRecipe(r, t).total, 0);
});

test('a dinner everyone loved ranks first once it is out of the repeat window', () => {
  const t = taste({ checkins: checkin(curry, '2026-11-02', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  assert.equal(order(t)[0], 'Fish curry');
  assert.ok(scoreRecipe(curry, t).direct > 2.5);
});

test('a dinner nobody ate ranks last', () => {
  const t = taste({ checkins: checkin(stew, '2026-11-02', { sam: 'skipped', mia: 'skipped', leo: 'skipped' }) });
  assert.equal(order(t).at(-1), 'Beef stew');
});

test('one person refusing a dinner outweighs the others liking it', () => {
  const split = taste({ checkins: checkin(curry, '2026-11-02', { sam: 'loved', mia: 'loved', leo: 'skipped' }) });
  const allLoved = taste({ checkins: checkin(curry, '2026-11-02', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  assert.ok(scoreRecipe(curry, split).direct < 1, 'a split table is close to neutral');
  assert.ok(scoreRecipe(curry, allLoved).direct > scoreRecipe(curry, split).direct + 2);
});

test('what was learned spreads to similar recipes, and not to unrelated ones', () => {
  const t = taste({
    checkins: [
      ...checkin(tacos, '2026-10-20', { sam: 'loved', mia: 'loved', leo: 'loved' }),
      ...checkin(tacos, '2026-11-03', { sam: 'loved', mia: 'loved', leo: 'loved' }),
    ],
  });
  const similar = scoreRecipe(fajitas, t);
  assert.ok(similar.similar > 1, `fajitas share category, cuisine and ingredients with tacos (${similar.similar})`);
  assert.equal(scoreRecipe(pilaf, t).similar, 0);
  assert.ok(order(t).indexOf('Chicken fajitas') < order(t).indexOf('Lamb pilaf'));
});

test('salt and other everyday ingredients teach nothing', () => {
  // Enough recipes for "common" to mean something: salt is in all of them.
  const roast = recipe('Salted roast', 'Roast', 'Welsh', ['leek', 'salt']);
  const many = [roast, ...Array.from({ length: 20 }, (_, i) => recipe(`Filler ${i}`, `Cat${i}`, `Area${i}`, [`thing ${i}`, 'salt']))];
  const t = buildTaste(signals({ checkins: checkin(roast, '2026-11-02', { sam: 'loved', mia: 'loved', leo: 'loved' }) }), many, FAMILY, NOW);
  assert.ok(scoreRecipe(roast, t).direct > 0);
  assert.equal(scoreRecipe(many.at(-1)!, t).similar, 0);
});

test('favorites, ratings, picks and cooking count for a recipe; swaps and removals count against', () => {
  const up = taste({ favorites: [chili.id], ratings: [{ recipeId: pasta.id, rating: 5 }], events: [{ recipeId: pilaf.id, kind: 'picked', at: '2026-11-10T18:00:00Z' }], cooked: [{ recipeId: curry.id, at: '2026-10-01T18:00:00Z' }] });
  for (const r of [chili, pasta, pilaf, curry]) assert.ok(scoreRecipe(r, up).direct > 0, r.name);
  const down = taste({ ratings: [{ recipeId: pasta.id, rating: 1 }], events: [{ recipeId: pilaf.id, kind: 'swapped_out', at: '2026-11-10T18:00:00Z' }, { recipeId: chili.id, kind: 'removed', at: '2026-11-10T18:00:00Z' }] });
  for (const r of [pasta, pilaf, chili]) assert.ok(scoreRecipe(r, down).direct < 0, r.name);
});

test('a meal eaten this week waits, then comes back', () => {
  const justAte = taste({ checkins: checkin(curry, '2026-11-17', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  assert.ok(scoreRecipe(curry, justAte).recent < -3.5);
  assert.notEqual(order(justAte)[0], 'Fish curry');
  const lastWeek = taste({ checkins: checkin(curry, '2026-11-10', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  assert.equal(order(lastWeek)[0], 'Fish curry');
});

test('old evidence counts for less than recent evidence', () => {
  const recent = taste({ checkins: checkin(curry, '2026-11-01', { sam: 'loved' }) });
  const old = taste({ checkins: checkin(curry, '2026-06-01', { sam: 'loved' }) });
  assert.ok(scoreRecipe(curry, recent).direct > scoreRecipe(curry, old).direct * 2);
});

test("a person's likes lift a recipe and their dislikes lower it", () => {
  const picky = [{ ...mia, dislikes: ['tomato'], likes: ['rice'] }];
  const t = buildTaste(NO_SIGNALS, ALL, picky, NOW);
  assert.ok(scoreRecipe(pasta, t).people < 0);
  assert.deepEqual(scoreRecipe(pasta, t).dislikedBy, [{ name: 'Mia', what: 'tomato' }]);
  assert.ok(scoreRecipe(pilaf, t).people > 0);
  assert.ok(order(t).indexOf('Lamb pilaf') < order(t).indexOf('Tomato pasta'));
});

test('"avoid if possible" ingredients rank a recipe lower without removing it', () => {
  const t = taste({}, FAMILY, ['potato']);
  const names = order(t);
  assert.ok(names.includes('Beef stew'));
  assert.ok(names.indexOf('Beef stew') > names.indexOf('Bean chili'));
});

// ── Allergies are hard filters ─────────────────────────────────────────────

const lovesPeanutNoodles: Partial<Signals> = {
  favorites: [satay.id],
  ratings: [{ recipeId: satay.id, rating: 5 }],
  checkins: [
    ...checkin(satay, '2026-10-01', { sam: 'loved', mia: 'loved', leo: 'loved' }),
    ...checkin(satay, '2026-10-15', { sam: 'loved', mia: 'loved', leo: 'loved' }),
    ...checkin(satay, '2026-11-01', { sam: 'loved', mia: 'loved', leo: 'loved' }),
  ],
};

test('an allergy removes a recipe however much the family loved it', () => {
  const t = taste(lovesPeanutNoodles);
  assert.equal(order(t)[0], 'Peanut noodles', 'without the allergy it is the top pick');
  assert.ok(scoreRecipe(satay, t).total >= 6);
  for (const allergies of [['peanut'], ['peanuts'], ['peanut butter']]) {
    assert.ok(!order(t, { allergies, skip_ingredients: [] }).includes('Peanut noodles'), allergies[0]);
  }
});

test('a new week never contains an allergen, a skipped ingredient or a recipe off the diet', () => {
  const t = taste(lovesPeanutNoodles);
  for (let seed = 1; seed <= 25; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: t, food: { allergies: ['peanut', 'fish'], skip_ingredients: ['lamb'], diet: 'none' }, slots: ['dinner', 'lunch'], maxWeeknightMinutes: null, seed });
    const ids = Object.values(plan).flatMap(d => Object.values(d)).flatMap(m => (m ? [m.id] : []));
    for (const banned of [satay, curry, fishPie, pilaf]) assert.ok(!ids.includes(banned.id), `${banned.name} (seed ${seed})`);
  }
  const { plan } = planWeek({ candidates: ALL, taste: t, food: { ...none, diet: 'vegetarian' }, slots: ['dinner'], maxWeeknightMinutes: null, seed: 1 });
  assert.deepEqual(Object.values(plan).map(d => d.dinner), Array(7).fill(null), 'no test recipe is marked vegetarian');
});

test('the daily update never swaps in an allergen', () => {
  const t = taste(lovesPeanutNoodles);
  const plan = week({ thursday: chili, friday: pilaf });
  const free = updatePlan({ plan, days: ['thursday', 'friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.ok(free.changes.some(c => c.to.id === satay.id), 'without the allergy the loved meal is swapped in');
  const safe = updatePlan({ plan, days: ['thursday', 'friday'], candidates: ALL, taste: t, food: { allergies: ['peanut'], skip_ingredients: [] }, maxWeeknightMinutes: null });
  assert.ok(!safe.changes.some(c => c.to.id === satay.id));
  assert.ok(!Object.values(safe.plan).some(d => d.dinner?.id === satay.id));
});

// ── Planning a week ────────────────────────────────────────────────────────

test('a week fills every planned slot without repeating a main', () => {
  const { plan, relaxed } = planWeek({ candidates: ALL, taste: taste({}), food: none, slots: ['dinner'], maxWeeknightMinutes: null, seed: 7 });
  const dinners = Object.values(plan).map(d => d.dinner?.id);
  assert.equal(dinners.filter(Boolean).length, 7);
  assert.equal(new Set(dinners).size, 7);
  assert.equal(relaxed.size, 0);
  assert.ok(Object.values(plan).every(d => d.lunch === null && d.breakfast === null));
});

test('the same seed gives the same week; another seed gives a different one', () => {
  const input = { candidates: ALL, taste: taste({}), food: none, slots: ['dinner'] as const, maxWeeknightMinutes: null };
  assert.deepEqual(planWeek({ ...input, seed: 3 }).plan, planWeek({ ...input, seed: 3 }).plan);
  const weeks = new Set([1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(planWeek({ ...input, seed }).plan)));
  assert.ok(weeks.size > 1);
});

test('weeknight dinners respect the time limit; the weekend may take longer', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: taste({ favorites: [stew.id] }), food: none, slots: ['dinner'], maxWeeknightMinutes: 45, seed });
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) assert.notEqual(plan[day].dinner?.id, stew.id, `${day} (seed ${seed})`);
  }
});

test('when recipes run short the week says which rule it bent', () => {
  const few = [tacos, curry, chili];
  const { plan, relaxed } = planWeek({ candidates: few, taste: buildTaste(NO_SIGNALS, few, [], NOW), food: none, slots: ['dinner'], maxWeeknightMinutes: null, seed: 1 });
  assert.equal(Object.values(plan).filter(d => d.dinner).length, 7);
  assert.ok(relaxed.has('repeat'));
  const counts = Object.values(plan).map(d => d.dinner!.id).reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<number, number>());
  assert.ok(Math.max(...counts.values()) <= 3, 'repeats are spread evenly');
});

test('breakfasts come from breakfast recipes and mains never do', () => {
  const { plan } = planWeek({ candidates: ALL, taste: taste({}), food: none, slots: ['breakfast', 'dinner'], maxWeeknightMinutes: null, seed: 2 });
  for (const d of Object.values(plan)) {
    assert.equal(d.breakfast?.id, omelette.id);
    assert.notEqual(d.dinner?.id, omelette.id);
  }
});

test('a locked day survives a new week, and its recipe is not used twice', () => {
  const current = week({ friday: pasta });
  current.friday.dinner!.locked = true;
  for (let seed = 1; seed <= 10; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: taste({}), food: none, slots: ['dinner'], maxWeeknightMinutes: null, keep: current, seed });
    assert.deepEqual(plan.friday.dinner, { id: pasta.id, title: 'Tomato pasta', image: '', locked: true });
    assert.equal(Object.values(plan).filter(d => d.dinner?.id === pasta.id).length, 1);
  }
});

test('a loved recipe is planned, and a refused one is left out while there are others', () => {
  const t = taste({
    checkins: [
      ...checkin(curry, '2026-11-01', { sam: 'loved', mia: 'loved', leo: 'loved' }),
      ...checkin(stew, '2026-11-02', { sam: 'skipped', mia: 'skipped', leo: 'skipped' }),
    ],
  });
  for (let seed = 1; seed <= 20; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: t, food: none, slots: ['dinner'], maxWeeknightMinutes: null, seed });
    const ids = Object.values(plan).map(d => d.dinner?.id);
    assert.ok(ids.includes(curry.id), `seed ${seed}`);
    assert.ok(!ids.includes(stew.id), `seed ${seed}`);
  }
});

// ── The daily update ───────────────────────────────────────────────────────

test('open days: after today only, and never a locked, cooked or shopped-for day', () => {
  const plan = week({ monday: tacos, wednesday: curry, thursday: chili, friday: pilaf, saturday: pasta, sunday: stew });
  assert.deepEqual(openDays(plan, 'wednesday', new Set(), new Set()), ['thursday', 'friday', 'saturday', 'sunday']);
  plan.friday.dinner!.locked = true;
  assert.deepEqual(openDays(plan, 'wednesday', new Set([pasta.id]), new Set([stew.id])), ['thursday']);
  assert.deepEqual(openDays(plan, 'sunday', new Set(), new Set()), []);
  assert.deepEqual(openDays(week({ thursday: chili }), 'monday', new Set(), new Set()), ['thursday'], 'empty days are not open');
});

test('checked-off groceries mark their recipes as shopped for; staples do not', () => {
  const items = [
    { key: 'cod', staple: false, recipes: [curry.id, fishPie.id] },
    { key: 'rice', staple: false, recipes: [pilaf.id] },
    { key: 'salt', staple: true, recipes: [chili.id, pilaf.id] },
  ];
  assert.deepEqual([...shoppedRecipeIds(items, ['cod', 'salt'])].sort(), [curry.id, fishPie.id].sort());
  assert.equal(shoppedRecipeIds(items, []).size, 0);
});

test('the update leaves a quiet week alone', () => {
  const plan = week({ thursday: chili, friday: pilaf, saturday: pasta });
  const result = updatePlan({ plan, days: ['thursday', 'friday', 'saturday'], candidates: ALL, taste: taste({}), food: none, maxWeeknightMinutes: null });
  assert.deepEqual(result.changes, []);
  assert.equal(result.plan, plan);
});

test('one loved dinner is not enough to reshuffle the week around it', () => {
  const t = taste({ checkins: checkin(tacos, '2026-11-18', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  const plan = week({ wednesday: tacos, thursday: chili, friday: pilaf });
  assert.deepEqual(updatePlan({ plan, days: ['thursday', 'friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null }).changes, []);
});

test('a dinner the kids loved last week replaces an ordinary one, with a note that says so', () => {
  const t = taste({ checkins: checkin(curry, '2026-11-10', { sam: 'fine', mia: 'loved', leo: 'loved' }) });
  const plan = week({ wednesday: tacos, thursday: chili, friday: pilaf });
  const { changes, plan: next } = updatePlan({ plan, days: ['friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.equal(changes.length, 1);
  assert.equal(next.friday.dinner?.id, curry.id);
  assert.equal(next.thursday.dinner?.id, chili.id, 'a day that was not offered is untouched');
  assert.equal(changeNote(changes), 'Swapped Friday for something the kids loved last week.');
});

test('a dinner like the one nobody ate tonight is swapped out', () => {
  const t = taste({ checkins: checkin(tacos, '2026-11-18', { sam: 'skipped', mia: 'skipped', leo: 'skipped' }) });
  const plan = week({ wednesday: tacos, friday: fajitas });
  const { changes, plan: next } = updatePlan({ plan, days: ['friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.equal(changes.length, 1);
  assert.notEqual(next.friday.dinner?.id, fajitas.id);
  assert.equal(changes[0].reason, 'Swapped Friday for something different. Nobody ate a dinner like it tonight.');
});

test('the update only touches the days it is given, and never a locked one', () => {
  const t = taste(lovesPeanutNoodles);
  const plan = week({ thursday: chili, friday: pilaf, saturday: pasta });
  plan.friday.dinner!.locked = true;
  const before = JSON.parse(JSON.stringify(plan));
  const { plan: next, changes } = updatePlan({ plan, days: ['friday', 'saturday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.deepEqual(next.thursday, before.thursday);
  assert.deepEqual(next.friday, before.friday);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].day, 'saturday');
  assert.deepEqual(updatePlan({ plan, days: [], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null }).changes, []);
});

test('one update brings in at most one liked meal, and changes at most two days', () => {
  const loved = [curry, chili, pilaf].flatMap(r => checkin(r, '2026-11-05', { sam: 'loved', mia: 'loved', leo: 'loved' }));
  const calm = updatePlan({ plan: week({ thursday: pasta, friday: stew, saturday: omelette }), days: ['thursday', 'friday', 'saturday'], candidates: ALL, taste: taste({ checkins: loved }), food: none, maxWeeknightMinutes: null });
  assert.equal(calm.changes.length, 1, 'three liked meals are waiting, one comes in');

  const refused = [tacos, pasta, stew].flatMap(r => checkin(r, '2026-11-05', { sam: 'skipped', mia: 'skipped', leo: 'skipped' }));
  const plan = week({ thursday: tacos, friday: pasta, saturday: stew, sunday: fishPie });
  const { plan: next, changes } = updatePlan({ plan, days: ['thursday', 'friday', 'saturday', 'sunday'], candidates: ALL, taste: taste({ checkins: [...loved, ...refused] }), food: none, maxWeeknightMinutes: null });
  assert.equal(changes.length, 2, 'three refused dinners are planned, two go');
  const ids = Object.values(next).flatMap(d => (d.dinner ? [d.dinner.id] : []));
  assert.equal(new Set(ids).size, ids.length, 'no recipe lands on two days');
});

test("a planned dinner with its own bad history says whose", () => {
  const t = taste({ checkins: checkin(pasta, '2026-11-11', { sam: 'fine', mia: 'skipped', leo: 'skipped' }) });
  const { changes } = updatePlan({ plan: week({ friday: pasta }), days: ['friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "Swapped Friday's dinner. The kids didn't eat it last week.");
});

test('the update keeps weeknights inside the time limit', () => {
  const t = taste({ checkins: checkin(stew, '2026-11-05', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  const plan = week({ friday: chili, saturday: pasta });
  const { changes } = updatePlan({ plan, days: ['friday', 'saturday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: 45 });
  assert.deepEqual(changes.map(c => [c.day, c.to.id]), [['saturday', stew.id]]);
});

test('a day the household filled by hand is left alone, and so is one they put back with Undo', () => {
  const t = taste(lovesPeanutNoodles);
  const plan = week({ thursday: chili, friday: pilaf });
  // By hand: Friday's pilaf was picked in the app.
  const edited = markChosen(week({ thursday: chili }), plan);
  assert.equal(edited.friday.dinner?.chosen, true);
  assert.equal(edited.thursday.dinner?.chosen, undefined, 'a meal that did not move is not marked');
  assert.deepEqual(openDays(edited, 'monday', new Set(), new Set()), ['thursday']);
  const { changes } = updatePlan({ plan: edited, days: ['thursday', 'friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.deepEqual(changes.map(c => c.day), ['thursday']);

  // Undo: the update swapped Thursday, the household put chili back. Tomorrow chili stays,
  // and the dinner they turned down isn't offered on another day either.
  const swapped = updatePlan({ plan, days: ['thursday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.equal(swapped.changes.length, 1);
  const undone = markChosen(swapped.plan, plan);
  assert.equal(undone.thursday.dinner?.id, chili.id);
  const turnedDown = taste({ ...lovesPeanutNoodles, events: [{ recipeId: swapped.changes[0].to.id, kind: 'swapped_out', at: '2026-11-18T19:00:00' }] });
  assert.deepEqual(openDays(undone, 'monday', new Set(), new Set()), ['friday']);
  assert.deepEqual(updatePlan({ plan: undone, days: ['friday'], candidates: ALL, taste: turnedDown, food: none, maxWeeknightMinutes: null }).changes, []);
});

test('a heart or a rating alone does not move the week; it shapes the next new one', () => {
  const t = taste({ favorites: [curry.id], ratings: [{ recipeId: curry.id, rating: 5 }] });
  const plan = week({ thursday: chili, friday: pilaf });
  assert.deepEqual(updatePlan({ plan, days: ['thursday', 'friday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null }).changes, []);
  for (let seed = 1; seed <= 10; seed++) {
    const ids = Object.values(planWeek({ candidates: ALL, taste: t, food: none, slots: ['dinner'], maxWeeknightMinutes: null, seed }).plan).map(d => d.dinner?.id);
    assert.ok(ids.includes(curry.id), `seed ${seed}`);
  }
});

test('"everyone" is only said when everyone answered', () => {
  // Only Leo answered, and he loved it: that is Leo, not everyone.
  const onlyLeo = taste({ checkins: checkin(curry, '2026-11-10', { leo: 'loved' }) });
  const { changes } = updatePlan({ plan: week({ friday: pilaf }), days: ['friday'], candidates: ALL, taste: onlyLeo, food: none, maxWeeknightMinutes: null });
  assert.equal(changeNote(changes), 'Swapped Friday for something Leo loved last week.');
  // Only the two kids answered, and neither ate it: the kids, not "nobody".
  const kids = taste({ checkins: checkin(pasta, '2026-11-11', { mia: 'skipped', leo: 'skipped' }) });
  const bad = updatePlan({ plan: week({ friday: pasta }), days: ['friday'], candidates: ALL, taste: kids, food: none, maxWeeknightMinutes: null });
  assert.equal(changeNote(bad.changes), "Swapped Friday's dinner. The kids didn't eat it last week.");
  // All three answered the same: everyone. And a household with no people set up answers as one.
  const all = taste({ checkins: checkin(curry, '2026-11-10', { sam: 'loved', mia: 'loved', leo: 'loved' }) });
  assert.equal(changeNote(updatePlan({ plan: week({ friday: pilaf }), days: ['friday'], candidates: ALL, taste: all, food: none, maxWeeknightMinutes: null }).changes), 'Swapped Friday for something everyone loved last week.');
  const asOne = buildTaste(signals({ checkins: [{ recipeId: curry.id, memberId: null, response: 'loved', date: '2026-11-10' }] }), ALL, [], NOW);
  assert.equal(changeNote(updatePlan({ plan: week({ friday: pilaf }), days: ['friday'], candidates: ALL, taste: asOne, food: none, maxWeeknightMinutes: null }).changes), 'Swapped Friday for something everyone loved last week.');
});

test('notes never put a recipe name mid-sentence', () => {
  const bbq = recipe('BBQ pork sloppy joes', 'Pork', 'American', ['pork', 'bun']);
  const thai = recipe('Thai green curry', 'Chicken', 'Thai', ['chicken thigh', 'green curry paste']);
  const pool = [...ALL, bbq, thai];
  const t = buildTaste(signals({ checkins: [...checkin(bbq, '2026-11-11', { sam: 'skipped', mia: 'skipped', leo: 'skipped' }), ...checkin(thai, '2026-11-10', { sam: 'loved', mia: 'loved', leo: 'loved' })] }), pool, FAMILY, NOW);
  const { changes } = updatePlan({ plan: week({ friday: bbq, saturday: pilaf }), days: ['friday', 'saturday'], candidates: pool, taste: t, food: none, maxWeeknightMinutes: null });
  assert.ok(changes.length >= 1);
  for (const c of changes) assert.doesNotMatch(c.reason, /bBQ|BBQ|thai|Thai|curry|pork/, c.reason);
});

// ── The first week ─────────────────────────────────────────────────────────

test('a family with no history still gets a varied first week', () => {
  // A catalog shaped like the real one: a few big categories, many cuisines.
  const sizes: Array<[string, number]> = [['Beef', 30], ['Seafood', 26], ['Chicken', 25], ['Vegetarian', 20], ['Pork', 17], ['Lamb', 11], ['Pasta', 4], ['Miscellaneous', 5]];
  const cuisines = ['British', 'Thai', 'Vietnamese', 'Spanish', 'Chinese', 'Italian', 'Turkish', 'French', 'American', 'Jamaican', 'Indian', 'Polish'];
  let n = 0;
  const catalog = sizes.flatMap(([category, count]) => Array.from({ length: count }, () => {
    n++;
    return recipe(`Recipe ${n}`, category, cuisines[(n * 7) % cuisines.length], [`main ${n % 40}`, `side ${n % 23}`, 'salt'], { total_minutes: 15 + (n * 13) % 100 });
  }));
  const fresh = buildTaste(NO_SIGNALS, catalog, [], NOW);
  const weeks = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const { plan, relaxed } = planWeek({ candidates: catalog, taste: fresh, food: none, slots: ['dinner'], maxWeeknightMinutes: 45, seed });
    const dinners = Object.values(plan).map(d => catalog.find(r => r.id === d.dinner?.id)!);
    assert.equal(dinners.filter(Boolean).length, 7, `seed ${seed}: every night has a dinner`);
    assert.equal(new Set(dinners.map(r => r.id)).size, 7, `seed ${seed}: no dinner repeats`);
    const perCategory = dinners.reduce((m, r) => m.set(r.category!, (m.get(r.category!) ?? 0) + 1), new Map<string, number>());
    assert.ok(perCategory.size >= 5, `seed ${seed}: at least five kinds of dinner, got ${[...perCategory.keys()].join(', ')}`);
    assert.ok(Math.max(...perCategory.values()) <= 2, `seed ${seed}: no kind of dinner more than twice`);
    assert.ok(new Set(dinners.map(r => r.area)).size >= 4, `seed ${seed}: at least four cuisines`);
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) assert.ok(catalog.find(r => r.id === plan[day].dinner!.id)!.total_minutes! <= 45, `seed ${seed}: ${day} is a weeknight dinner`);
    assert.equal(relaxed.size, 0, `seed ${seed}: no rule had to bend`);
    weeks.add(Object.values(plan).map(d => d.dinner!.id).join());
  }
  assert.ok(weeks.size > 150, 'different households get different first weeks');
});

// ── Notes and edits ────────────────────────────────────────────────────────

test('who and when read like a person would say them', () => {
  assert.equal(who(['everyone'], FAMILY), 'everyone');
  assert.equal(who(['Mia', 'Leo'], FAMILY), 'the kids');
  assert.equal(who(['Mia'], FAMILY), 'Mia');
  assert.equal(who(['Sam', 'Mia'], FAMILY), 'Sam and Mia');
  assert.equal(when('2026-11-18', NOW), 'tonight');
  assert.equal(when('2026-11-17', NOW), 'last night');
  assert.equal(when('2026-11-16', NOW), 'on Monday');
  assert.equal(when('2026-11-10', NOW), 'last week');
  assert.equal(when('2026-10-25', NOW), 'a few weeks ago');
});

test('edits by hand: picks, swaps and removals are recorded; moving a meal is not', () => {
  const before = week({ monday: tacos, tuesday: curry, wednesday: chili });
  const swapped = week({ monday: pasta, tuesday: curry, wednesday: chili });
  assert.deepEqual(planEdits(before, swapped), [{ recipeId: tacos.id, kind: 'swapped_out', day: 'monday' }, { recipeId: pasta.id, kind: 'picked', day: 'monday' }]);
  assert.deepEqual(planEdits(before, week({ monday: tacos, tuesday: curry })), [{ recipeId: chili.id, kind: 'removed', day: 'wednesday' }]);
  assert.deepEqual(planEdits(before, week({ monday: curry, tuesday: tacos, wednesday: chili })), []);
  assert.deepEqual(planEdits(before, week({ tuesday: curry, wednesday: chili, friday: tacos })), []);
  assert.deepEqual(planEdits(null, week({ monday: tacos })), [{ recipeId: tacos.id, kind: 'picked', day: 'monday' }]);
});

// ── Use what you have ──────────────────────────────────────────────────────

test('a new week favors meals that use what is on hand', () => {
  const withRice = buildTaste(NO_SIGNALS, ALL, FAMILY, NOW, [], ['rice']);
  assert.ok(scoreRecipe(pilaf, withRice).onHand > 0, 'the lamb pilaf uses rice');
  assert.deepEqual(scoreRecipe(pilaf, withRice).usesOnHand, ['rice']);
  assert.equal(scoreRecipe(tacos, withRice).onHand, 0);
  let planned = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: withRice, food: none, slots: ['dinner'], maxWeeknightMinutes: null, seed });
    if (Object.values(plan).some(d => d.dinner?.id === pilaf.id)) planned++;
  }
  assert.equal(planned, 20, 'planned every time');
});

test('what is on hand never overrides an allergy', () => {
  const t = buildTaste(NO_SIGNALS, ALL, FAMILY, NOW, [], ['peanut butter', 'noodles']);
  assert.ok(scoreRecipe(satay, t).onHand > 0);
  for (let seed = 1; seed <= 10; seed++) {
    const { plan } = planWeek({ candidates: ALL, taste: t, food: { allergies: ['peanut'], skip_ingredients: [] }, slots: ['dinner'], maxWeeknightMinutes: null, seed });
    assert.ok(!Object.values(plan).some(d => d.dinner?.id === satay.id), `seed ${seed}`);
  }
});

test('the update brings in one meal that uses what is on hand, and says so', () => {
  const t = buildTaste(NO_SIGNALS, ALL, FAMILY, NOW, [], ['rice']);
  const plan = week({ thursday: chili, friday: tacos, saturday: curry });
  const { changes, plan: next } = updatePlan({ plan, days: ['thursday', 'friday', 'saturday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null });
  assert.equal(changes.length, 1);
  assert.equal(Object.values(next).filter(d => d.dinner?.id === pilaf.id).length, 1);
  assert.match(changes[0].reason, /^Swapped (Thursday|Friday|Saturday) for something that uses your rice\.$/);
  // Already in the week: nothing more to do.
  assert.deepEqual(updatePlan({ plan: next, days: ['thursday', 'friday', 'saturday'], candidates: ALL, taste: t, food: none, maxWeeknightMinutes: null }).changes, []);
});

test('nothing on hand changes nothing', () => {
  const t = buildTaste(NO_SIGNALS, ALL, FAMILY, NOW, [], []);
  for (const r of ALL) assert.equal(scoreRecipe(r, t).onHand, 0);
});
