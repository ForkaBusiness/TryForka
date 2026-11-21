// Portions: shared meals, each person's plate sized toward their own goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyTargets,
  dayPortions,
  GOALS_FOR,
  LIMITS,
  MEAL_SHARE,
  servingsToCook,
  validateGoal,
  type PersonGoal,
  type PlannedMealNutrition,
} from '../src/lib/portions.ts';

const adult = (goal: PersonGoal['goal'], extra: Partial<PersonGoal> = {}): PersonGoal => ({
  id: `a-${goal}`,
  name: 'Sam',
  kind: 'adult',
  goal,
  ...extra,
});
const kid = (goal: PersonGoal['goal'], extra: Partial<PersonGoal> = {}): PersonGoal => ({
  id: `k-${goal}`,
  name: 'Mia',
  kind: 'kid',
  goal,
  ...extra,
});

/** Every string a person might read: calm, no em dashes, never the word AI, no emojis. */
function assertCalmCopy(message: string) {
  assert.ok(message.length > 0);
  assert.doesNotMatch(message, /—|–/, 'no em or en dashes');
  assert.doesNotMatch(message, /\bAI\b/);
  assert.doesNotMatch(message, /\p{Extended_Pictographic}/u, 'no emojis');
  assert.doesNotMatch(message, /!/, 'calm, no exclamation marks');
}

test('constants: goals per kind, limits and meal shares', () => {
  assert.deepEqual(GOALS_FOR.kid, ['none', 'more_protein', 'growing_kid']);
  for (const g of ['none', 'calories', 'protein', 'more_protein', 'lighter', 'growing_kid'] as const) {
    assert.ok(GOALS_FOR.adult.includes(g));
  }
  assert.deepEqual(LIMITS, {
    adultMinCalories: 1200,
    adultMaxCalories: 4000,
    minProtein: 20,
    maxProtein: 250,
    minPortion: 0.5,
    maxPortion: 2,
    portionStep: 0.25,
  });
  assert.deepEqual(MEAL_SHARE, { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 });
});

test('validation: a calorie target under 1,200 is never allowed, with a calm message naming the minimum', () => {
  const result = validateGoal(adult('calories', { calories: 1100 }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /1,200/);
    assertCalmCopy(result.message);
  }
  const atMin = validateGoal(adult('calories', { calories: 1200 }));
  assert.equal(atMin.ok, true);
  if (atMin.ok) assert.equal(atMin.goal.calories, 1200);
});

test('validation: above the calorie maximum, or a missing number, is rejected', () => {
  const high = validateGoal(adult('calories', { calories: 4500 }));
  assert.equal(high.ok, false);
  if (!high.ok) {
    assert.match(high.message, /4,000/);
    assertCalmCopy(high.message);
  }
  assert.equal(validateGoal(adult('calories', { calories: 4000 })).ok, true);
  for (const calories of [null, undefined, Number.NaN, Infinity]) {
    const r = validateGoal(adult('calories', { calories }));
    assert.equal(r.ok, false, `calories ${calories}`);
    if (!r.ok) assertCalmCopy(r.message);
  }
});

test('validation: protein bounds are 20 g to 250 g', () => {
  assert.equal(validateGoal(adult('protein', { protein: 19 })).ok, false);
  assert.equal(validateGoal(adult('protein', { protein: 20 })).ok, true);
  assert.equal(validateGoal(adult('protein', { protein: 250 })).ok, true);
  const high = validateGoal(adult('protein', { protein: 251 }));
  assert.equal(high.ok, false);
  if (!high.ok) {
    assert.match(high.message, /20 g and 250 g/);
    assertCalmCopy(high.message);
  }
  assert.equal(validateGoal(adult('protein', { protein: null })).ok, false);
});

test('validation: kids never get a number target, general goals are fine', () => {
  for (const goal of ['calories', 'protein'] as const) {
    const r = validateGoal(kid(goal, { calories: 1800, protein: 50 }));
    assert.equal(r.ok, false, goal);
    if (!r.ok) assertCalmCopy(r.message);
  }
  const lighterKid = validateGoal(kid('lighter'));
  assert.equal(lighterKid.ok, false);
  if (!lighterKid.ok) assertCalmCopy(lighterKid.message);

  for (const goal of ['none', 'more_protein', 'growing_kid'] as const) {
    assert.equal(validateGoal(kid(goal)).ok, true, goal);
  }
});

test('validation: stray numbers are dropped from goals that do not use them, and unknown goals are rejected', () => {
  const r = validateGoal(adult('lighter', { calories: 900, protein: 400 }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([r.goal.calories, r.goal.protein], [null, null]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data from the database could be anything
  const odd = validateGoal(adult('keto' as any));
  assert.equal(odd.ok, false);
  if (!odd.ok) assertCalmCopy(odd.message);
});

test('dailyTargets: one for each goal kind', () => {
  assert.deepEqual(dailyTargets(adult('none')), { kcal: null, protein: null });
  assert.deepEqual(dailyTargets(adult('calories', { calories: 2200 })), { kcal: 2200, protein: null });
  assert.deepEqual(dailyTargets(adult('protein', { protein: 120 })), { kcal: null, protein: 120 });
  assert.deepEqual(dailyTargets(adult('more_protein')), { kcal: 2000, protein: 78 });
  assert.deepEqual(dailyTargets(kid('more_protein')), { kcal: 1600, protein: 46 });
  assert.deepEqual(dailyTargets(adult('lighter')), { kcal: 1700, protein: 60 });
  assert.deepEqual(dailyTargets(kid('growing_kid')), { kcal: 1600, protein: 35 });
  assert.deepEqual(dailyTargets(kid('none')), { kcal: null, protein: null });
});

test('dailyTargets: lighter never goes under the adult minimum, and an invalid goal counts as no goal', () => {
  const lighter = dailyTargets(adult('lighter'));
  assert.ok((lighter.kcal as number) >= LIMITS.adultMinCalories);
  assert.deepEqual(dailyTargets(adult('calories', { calories: 1100 })), { kcal: null, protein: null });
  assert.deepEqual(dailyTargets(kid('calories', { calories: 2000 })), { kcal: null, protein: null });
});

const dinner600: PlannedMealNutrition = { slot: 'dinner', kcal: 600, protein: 30 };

test('dayPortions: 2000 kcal target with only a 600 kcal dinner planned gives portion 1.25', () => {
  const [p] = dayPortions([dinner600], [adult('calories', { calories: 2000 })]);
  // 0.35 x 2000 = 700 kcal for dinner; 700 / 600 = 1.17, nearest quarter is 1.25.
  assert.equal(p.portion, 1.25);
  assert.deepEqual(p.target, { kcal: 700, protein: null });
  assert.deepEqual(p.planned, { kcal: 750, protein: 37.5 });
  assert.equal(p.near, true);
});

test('dayPortions: portions stay between 0.5 and 2', () => {
  const big = dayPortions([{ slot: 'snack', kcal: 100, protein: 5 }], [adult('calories', { calories: 4000 })])[0];
  assert.equal(big.portion, 2, '400 kcal wanted from a 100 kcal snack is capped at 2');
  assert.equal(big.near, false, 'capped well short of the target is not near');

  const small = dayPortions([{ slot: 'dinner', kcal: 1500, protein: 60 }], [adult('calories', { calories: 1200 })])[0];
  assert.equal(small.portion, 0.5, '420 kcal from a 1500 kcal dinner is 0.28, kept at 0.5');
});

test('dayPortions: a child never gets less than a full portion, whatever the goal', () => {
  const heavy = { slot: 'dinner' as const, kcal: 1200, protein: 40 };
  const [growing, proteinKid, noGoal] = dayPortions([heavy], [kid('growing_kid'), { ...kid('more_protein'), id: 'k2' }, { ...kid('none'), id: 'k3' }]);
  // 0.35 x 1600 = 560 kcal; 560 / 1200 = 0.47 would be 0.5, but children stay at 1.
  assert.equal(growing.portion, 1);
  assert.equal(proteinKid.portion, 1);
  assert.equal(noGoal.portion, 1);
});

test('dayPortions: a protein goal only ever adds; only calorie goals make a plate smaller', () => {
  // The review's case: 550 kcal and 40 g protein per serving.
  const dinner = { slot: 'dinner' as const, kcal: 550, protein: 40 };
  const adult = (goal: 'more_protein' | 'lighter' | 'protein' | 'calories', extra = {}) => ({ id: goal, name: goal, kind: 'adult' as const, goal, ...extra });
  const [more, lighter, protein, cals] = dayPortions([dinner], [adult('more_protein'), adult('lighter'), adult('protein', { protein: 40 }), adult('calories', { calories: 1200 })]);
  assert.ok(more.portion >= 1, `more protein: ${more.portion}`);
  assert.ok(protein.portion >= 1, `a low protein target doesn't shrink the plate: ${protein.portion}`);
  assert.ok(more.portion >= lighter.portion, 'more protein never gets less than lighter');
  assert.equal(cals.portion, 0.75, 'a 1,200 kcal target: 420 / 550, rounded to 0.75');
});

test('dayPortions: a protein-only goal is sized by protein', () => {
  const [p] = dayPortions([dinner600], [adult('protein', { protein: 120 })]);
  // 0.35 x 120 = 42 g; 42 / 30 = 1.4, nearest quarter is 1.5.
  assert.equal(p.portion, 1.5);
  assert.deepEqual(p.target, { kcal: null, protein: 42 });
  assert.deepEqual(p.planned, { kcal: 900, protein: 45 });
  assert.equal(p.near, true);
});

test('dayPortions: no goal, or an invalid goal, means portion 1 and near', () => {
  const [none, invalid] = dayPortions(
    [dinner600],
    [adult('none'), { ...adult('calories', { calories: 800 }), id: 'bad' }],
  );
  for (const p of [none, invalid]) {
    assert.equal(p.portion, 1);
    assert.equal(p.near, true);
    assert.deepEqual(p.target, { kcal: null, protein: null });
    assert.deepEqual(p.planned, { kcal: 600, protein: 30 });
  }
});

test('dayPortions: with no planned meals, portion 1 and zero totals', () => {
  const [p] = dayPortions([], [adult('calories', { calories: 2500 })]);
  assert.equal(p.portion, 1);
  assert.deepEqual(p.planned, { kcal: 0, protein: 0 });
  assert.equal(p.near, true);
  assert.deepEqual(dayPortions([], []), []);
});

test('dayPortions: a mixed household on breakfast and dinner', () => {
  const meals: PlannedMealNutrition[] = [
    { slot: 'breakfast', kcal: 400, protein: 20 },
    { slot: 'dinner', kcal: 600, protein: 35 },
  ];
  // Together these stand for 0.6 of the day: 1000 kcal and 55 g protein per serving.
  const people: PersonGoal[] = [
    { id: 'dad', name: 'Dad', kind: 'adult', goal: 'calories', calories: 2500 },
    { id: 'mum', name: 'Mum', kind: 'adult', goal: 'protein', protein: 150 },
    { id: 'gran', name: 'Gran', kind: 'adult', goal: 'none' },
    { id: 'leo', name: 'Leo', kind: 'kid', goal: 'growing_kid' },
  ];
  const result = dayPortions(meals, people);
  assert.deepEqual(
    result.map((p) => [p.id, p.portion]),
    [
      ['dad', 1.5], // 1500 / 1000
      ['mum', 1.75], // 90 g / 55 g = 1.64
      ['gran', 1],
      ['leo', 1], // 960 / 1000 = 0.96
    ],
  );
  assert.deepEqual(result[0].target, { kcal: 1500, protein: null });
  assert.deepEqual(result[3].target, { kcal: 960, protein: 21 });
  assert.ok(result.every((p) => p.near));
  assert.equal(servingsToCook(result), 5.5); // 1.5 + 1.75 + 1 + 1 = 5.25
});

test('dayPortions: planned totals are portion times the per-serving sums', () => {
  const meals: PlannedMealNutrition[] = [
    { slot: 'breakfast', kcal: 300, protein: 12 },
    { slot: 'lunch', kcal: 500, protein: 25 },
    { slot: 'dinner', kcal: 700, protein: 40 },
  ];
  const people: PersonGoal[] = [
    adult('calories', { calories: 3000 }),
    adult('lighter'),
    adult('more_protein'),
    kid('growing_kid'),
    kid('none'),
  ];
  for (const p of dayPortions(meals, people)) {
    assert.equal(p.planned.kcal, Math.round(p.portion * 1500), p.id);
    assert.equal(p.planned.protein, Math.round(p.portion * 77 * 10) / 10, p.id);
    assert.ok(p.portion >= LIMITS.minPortion && p.portion <= LIMITS.maxPortion, p.id);
    assert.equal((p.portion / LIMITS.portionStep) % 1, 0, `${p.id} is a whole number of quarters`);
  }
});

test('dayPortions is pure: same input, same output, inputs untouched', () => {
  const meals: PlannedMealNutrition[] = [dinner600];
  const people = [adult('calories', { calories: 2000 })];
  const before = JSON.stringify([meals, people]);
  assert.deepEqual(dayPortions(meals, people), dayPortions(meals, people));
  assert.equal(JSON.stringify([meals, people]), before);
});

test('servingsToCook: the sum rounded up to the nearest half, at least 1', () => {
  assert.equal(servingsToCook([{ portion: 1.25 }, { portion: 1 }, { portion: 0.75 }]), 3);
  assert.equal(servingsToCook([{ portion: 1.25 }, { portion: 1 }]), 2.5);
  assert.equal(servingsToCook([{ portion: 1.25 }, { portion: 1.5 }]), 3);
  assert.equal(servingsToCook([{ portion: 0.5 }]), 1);
  assert.equal(servingsToCook([]), 1);
  assert.equal(servingsToCook([{ portion: 0.1 + 0.2 }, { portion: 0.7 }]), 1, 'float noise does not add a half serving');
});

// ── A household's day ──
import { householdDay, mealsFor, portionLabel } from '../src/lib/portions.ts';

test('a child with a school lunch eats it instead of the home lunch; nobody else has it', () => {
  const day = [
    { slot: 'breakfast' as const, kcal: 400, protein: 15 },
    { slot: 'school_lunch' as const, kcal: 450, protein: 18 },
    { slot: 'lunch' as const, kcal: 600, protein: 30 },
    { slot: 'dinner' as const, kcal: 700, protein: 40 },
  ];
  const kid = { id: 'k', name: 'Mia', kind: 'kid' as const, goal: 'none' as const, school_lunch: true };
  const adult = { id: 'a', name: 'Sam', kind: 'adult' as const, goal: 'none' as const };
  assert.deepEqual(mealsFor(kid, day).map(m => m.kcal), [400, 450, 700]);
  assert.deepEqual(mealsFor(adult, day).map(m => m.kcal), [400, 600, 700]);
  // A weekend: no school lunch planned, so the child has the home lunch.
  assert.deepEqual(mealsFor(kid, day.filter(m => m.slot !== 'school_lunch')).map(m => m.kcal), [400, 600, 700]);
});

test('householdDay: one shared dinner, each plate sized to its own goal, never under the safe floor', () => {
  const dinner = [{ slot: 'dinner' as const, kcal: 600, protein: 30 }];
  const out = householdDay(dinner, [
    { id: 'a', name: 'Sam', kind: 'adult', goal: 'calories', calories: 2600 },
    { id: 'b', name: 'Ana', kind: 'adult', goal: 'calories', calories: 1200 },
    { id: 'k', name: 'Mia', kind: 'kid', goal: 'growing_kid' },
    { id: 'x', name: 'Leo', kind: 'kid', goal: 'calories', calories: 900 }, // not allowed for a kid: treated as no goal
  ]);
  const by = Object.fromEntries(out.map(p => [p.name, p]));
  assert.equal(by.Sam.portion, 1.5);   // 2600 x 0.35 = 910 / 600 = 1.52
  assert.equal(by.Ana.portion, 0.75);  // 1200 x 0.35 = 420 / 600 = 0.7
  assert.ok(by.Mia.portion >= 1, 'a growing child never gets less than a full portion');
  assert.equal(by.Leo.portion, 1);
  assert.equal(by.Leo.target.kcal, null);
  for (const p of out) assert.ok(p.portion >= 0.5 && p.portion <= 2);
});

test('portion labels read naturally', () => {
  assert.equal(portionLabel(1), '1 portion');
  assert.equal(portionLabel(1.25), '1¼ portions');
  assert.equal(portionLabel(0.5), '½ portion');
  assert.equal(portionLabel(0.75), '¾ portion');
  assert.equal(portionLabel(2), '2 portions');
});
