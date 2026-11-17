// Nutrition: matching an ingredient to a USDA food, weighing a recipe's amounts, and the
// per-serving math. The onion and olive oil fixtures are real FoodData Central responses
// (trimmed to the fields the code reads), fetched 2026-11-16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_SERVINGS, factsFromFdc, gramsOf, hasNoCalories, nutritionKey, per100g, pickFood, portionsOf, recipeNutrition, rounded, servingsMultiplier,
  type Facts, type FdcFoodDetail, type FdcSearchFood, type MeasuredIngredient,
} from '../supabase/functions/_shared/nutrition.ts';
import { parseMeasure } from '../supabase/functions/_shared/catalog/units.ts';

const n = (kcal: number | null, protein: number, fat: number, carbs: number, fiber?: number) => [
  ...(kcal === null ? [] : [{ nutrientId: 1008, value: kcal }]),
  { nutrientId: 1003, value: protein }, { nutrientId: 1004, value: fat }, { nutrientId: 1005, value: carbs },
  ...(fiber === undefined ? [] : [{ nutrientId: 1079, value: fiber }]),
];

// GET /fdc/v1/foods/search?query=onion&dataType=Foundation,SR Legacy
const ONION_SEARCH: FdcSearchFood[] = [
  { fdcId: 170000, dataType: 'SR Legacy', description: 'Onions, raw', foodCategory: 'Vegetables and Vegetable Products', foodNutrients: n(40, 1.1, 0.1, 9.34, 1.7) },
  { fdcId: 169844, dataType: 'SR Legacy', description: "DENNY'S, onion rings", foodCategory: 'Restaurant Foods', foodNutrients: n(413, 5.4, 26.9, 37.9, 2.7) },
  { fdcId: 170002, dataType: 'SR Legacy', description: 'Onions, dehydrated flakes', foodCategory: 'Vegetables and Vegetable Products', foodNutrients: n(349, 8.95, 0.46, 83.28, 9.2) },
  { fdcId: 790577, dataType: 'Foundation', description: 'Onions, red, raw', foodCategory: 'Vegetables and Vegetable Products', foodNutrients: n(null, 0.94, 0.1, 9.93, 2.2) },
  { fdcId: 170008, dataType: 'SR Legacy', description: 'Onions, sweet, raw', foodCategory: 'Vegetables and Vegetable Products', foodNutrients: n(32, 0.8, 0.08, 7.55, 0.9) },
];
// GET /fdc/v1/food/170000
const ONION_DETAIL: FdcFoodDetail = {
  foodPortions: [
    { gramWeight: 160, sequenceNumber: 1, amount: 1, modifier: 'cup, chopped', measureUnit: { name: 'undetermined' } },
    { gramWeight: 14, sequenceNumber: 7, amount: 1, modifier: 'slice, medium (1/8" thick)', measureUnit: { name: 'undetermined' } },
    { gramWeight: 110, sequenceNumber: 6, amount: 1, modifier: 'medium (2-1/2" dia)', measureUnit: { name: 'undetermined' } },
    { gramWeight: 150, sequenceNumber: 4, amount: 1, modifier: 'large', measureUnit: { name: 'undetermined' } },
    { gramWeight: 60, sequenceNumber: 10, amount: 10, modifier: 'rings', measureUnit: { name: 'undetermined' } },
    { gramWeight: 10, sequenceNumber: 3, amount: 1, modifier: 'tbsp chopped', measureUnit: { name: 'undetermined' } },
    { gramWeight: 115, sequenceNumber: 2, amount: 1, modifier: 'cup, sliced', measureUnit: { name: 'undetermined' } },
    { gramWeight: 9, sequenceNumber: 9, amount: 1, modifier: 'slice, thin', measureUnit: { name: 'undetermined' } },
    { gramWeight: 70, sequenceNumber: 8, amount: 1, modifier: 'small', measureUnit: { name: 'undetermined' } },
  ],
};
// GET /fdc/v1/foods/search?query=olive oil&dataType=Foundation,SR Legacy
const OLIVE_OIL_SEARCH: FdcSearchFood[] = [
  { fdcId: 167737, dataType: 'SR Legacy', description: 'Oil, corn, peanut, and olive', foodNutrients: n(884, 0, 100, 0) },
  { fdcId: 1750351, dataType: 'Foundation', description: 'Oil, olive, extra light', foodNutrients: n(null, 0, 100, 0) },
  { fdcId: 748608, dataType: 'Foundation', description: 'Oil, olive, extra virgin', foodNutrients: n(null, 0, 100, 0) },
  { fdcId: 171413, dataType: 'SR Legacy', description: 'Oil, olive, salad or cooking', foodNutrients: n(884, 0, 100, 0) },
];

const ing = (name_us: string, measure: string): MeasuredIngredient => {
  const m = parseMeasure(measure);
  return { name_us, quantity: m.quantity, quantity_max: m.quantityMax, unit: m.unit };
};
const facts = (key: string, per: [number, number, number, number, number], portions: Record<string, number> = {}): Facts =>
  ({ key, matched: true, fdc_id: 1, description: key, kcal: per[0], protein_g: per[1], carbs_g: per[2], fat_g: per[3], fiber_g: per[4], portions });
const close = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`);

// ── Matching ───────────────────────────────────────────────────────────────

test('an ingredient matches the plain food, not a product or a restaurant dish that contains it', () => {
  assert.equal(pickFood('Onion', ONION_SEARCH)?.description, 'Onions, raw');
  assert.equal(pickFood('onions', ONION_SEARCH)?.fdcId, 170000);
  assert.equal(pickFood('Red onion', ONION_SEARCH)?.description, 'Onions, red, raw');
  assert.equal(pickFood('Olive oil', OLIVE_OIL_SEARCH)?.description, 'Oil, olive, salad or cooking', 'not the corn, peanut and olive blend that USDA ranks first');
});

test('no match is better than a wrong one', () => {
  assert.equal(pickFood('Shallot', ONION_SEARCH), null, 'none of the results is a shallot');
  assert.equal(pickFood('Gochujang', []), null);
  assert.equal(pickFood('', ONION_SEARCH), null);
  const dishOnly = [{ fdcId: 1, description: 'Soup, onion, canned, condensed, prepared with water', foodNutrients: n(23, 1.5, 0.7, 3.3) }];
  assert.equal(pickFood('Onion', dishOnly), null, 'a dish that contains the ingredient is not the ingredient');
});

test('the five numbers per 100 g, with energy worked out when USDA leaves it blank', () => {
  assert.deepEqual(per100g(ONION_SEARCH[0]), { kcal: 40, protein: 1.1, carbs: 9.34, fat: 0.1, fiber: 1.7 });
  // Foundation "Onions, red, raw" lists no energy: 4 x 0.94 + 4 x 9.93 + 9 x 0.1
  close(per100g(ONION_SEARCH[3])!.kcal, 44.38);
  assert.equal(per100g({ fdcId: 2, description: 'Nothing known', foodNutrients: [] }), null);
});

test('household portions become grams per unit, first listed wins', () => {
  assert.deepEqual(portionsOf(ONION_DETAIL), { cup: 160, tbsp: 10, large: 150, each: 110, slice: 14, small: 70 });
  assert.deepEqual(portionsOf({ foodPortions: [{ gramWeight: 28, amount: 2, modifier: 'tbsp' }, { gramWeight: 50, amount: 1, modifier: 'large' }] }), { tbsp: 14, large: 50, each: 50 }, 'no medium listed: the size that is');
  assert.deepEqual(portionsOf({ foodPortions: [{ gramWeight: 244, amount: 1, measureUnit: { name: 'cup' }, modifier: '' }] }), { cup: 244 });
  assert.deepEqual(portionsOf(null), {});
});

test('a cache row keeps what was found, or says nothing was', () => {
  const row = factsFromFdc('onion', pickFood('onion', ONION_SEARCH), ONION_DETAIL);
  assert.deepEqual({ matched: row.matched, fdc_id: row.fdc_id, kcal: row.kcal, each: row.portions.each }, { matched: true, fdc_id: 170000, kcal: 40, each: 110 });
  const none = factsFromFdc('gochujang', null);
  assert.equal(none.matched, false);
  assert.equal(none.kcal, null);
});

// ── Weighing ───────────────────────────────────────────────────────────────

const onion = factsFromFdc('onion', ONION_SEARCH[0], ONION_DETAIL);

test('weights convert directly; volumes and counts use the food\'s own portions', () => {
  close(gramsOf(ing('Onion', '200g'), {})!, 200);
  close(gramsOf(ing('Onion', '1 lb'), {})!, 453.6);
  close(gramsOf(ing('Onion', '1 cup'), onion.portions)!, 160);
  close(gramsOf(ing('Onion', '2 tbsp'), onion.portions)!, 20, 'two tablespoons by the cup weight: 160 g / 240 ml x 30 ml');
  close(gramsOf(ing('Onion', '2'), onion.portions)!, 220, 'two medium onions');
  close(gramsOf(ing('Onion', '3 slices'), onion.portions)!, 42);
  close(gramsOf(ing('Onion', '1-2'), onion.portions)!, 165, 'a range counts as its middle');
});

test('an amount that cannot be weighed is null, never a guess', () => {
  assert.equal(gramsOf(ing('Olive oil', '2 tbsp'), {}), null, 'no weight per spoon known');
  assert.equal(gramsOf(ing('Chopped tomatoes', '1 can'), { cup: 240 }), null, 'a can has no fixed size');
  assert.equal(gramsOf(ing('Parsley', '1 bunch'), { cup: 60 }), null);
  assert.equal(gramsOf(ing('Onion', '2'), { cup: 160 }), null, 'a count with no weight per piece');
  assert.equal(gramsOf(ing('Parsley', 'to garnish'), { cup: 60 }), null);
  assert.equal(gramsOf(ing('Chili flakes', 'pinch'), {}), null, 'no number at all');
  assert.equal(gramsOf(ing('Chili flakes', '1 pinch'), {}), 0, 'a pinch weighs nothing worth counting');
});

// ── Recipe math ────────────────────────────────────────────────────────────

const PANTRY = new Map<string, Facts>([
  ['onion', onion],
  ['olive oil', facts('olive oil', [884, 0, 0, 100, 0], { tbsp: 13.5, cup: 216 })],
  ['chicken breast', facts('chicken breast', [120, 22.5, 0, 2.6, 0])],
  ['rice', facts('rice', [365, 7.1, 80, 0.7, 1.3], { cup: 185 })],
  ['gochujang', { ...factsFromFdc('gochujang', null) }],
  ['chopped tomato', facts('chopped tomato', [32, 1.6, 7, 0.3, 1.9], { cup: 240 })],
]);
const lookup = (key: string) => PANTRY.get(key);

const DINNER = [
  ing('Chicken breast', '500g'),   // 600 kcal, 112.5 P, 0 C, 13 F
  ing('Rice', '300g'),             // 1095 kcal, 21.3 P, 240 C, 2.1 F, 3.9 fiber
  ing('Onion', '2'),               // 220 g: 88 kcal, 2.42 P, 20.548 C, 0.22 F, 3.74 fiber
  ing('Olive oil', '2 tbsp'),      // 30 ml -> 27 g: 238.68 kcal, 27 F
  ing('Salt', 'pinch'),
  ing('Water', '2 cups'),
];

test('a recipe is added up from its weighed ingredients and divided by four servings', () => {
  const r = recipeNutrition(DINNER, lookup);
  assert.equal(BASE_SERVINGS, 4);
  close(r.total.kcal, 600 + 1095 + 88 + 238.68);
  close(r.total.protein, 112.5 + 21.3 + 2.42);
  close(r.total.carbs, 240 + 20.548);
  close(r.total.fat, 13 + 2.1 + 0.22 + 27);
  close(r.total.fiber, 3.9 + 3.74);
  close(r.perServing.kcal, (600 + 1095 + 88 + 238.68) / 4);
  close(r.perServing.protein, (112.5 + 21.3 + 2.42) / 4);
  assert.deepEqual([r.counted, r.ingredients], [6, 6], 'salt and water count as weighed: they add nothing');
  assert.deepEqual([r.unmatched, r.unweighed, r.noAmount], [[], [], []]);
  assert.deepEqual(rounded(r.perServing), { kcal: 510, protein: 34, carbs: 65, fat: 11, fiber: 2 });
});

test('changing the servings rescales the whole recipe; one serving stays one serving', () => {
  const four = recipeNutrition(DINNER, lookup, 4);
  const six = recipeNutrition(DINNER, lookup, 6);
  const two = recipeNutrition(DINNER, lookup, 2);
  for (const key of ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const) {
    close(six.total[key], four.total[key] * 1.5, key);
    close(two.total[key], four.total[key] / 2, key);
    close(six.perServing[key], four.perServing[key], key);
  }
  assert.equal(servingsMultiplier(6), 1.5, 'the same factor the ingredient amounts are scaled by');
  assert.equal(servingsMultiplier(4), 1);
  assert.equal(servingsMultiplier(2), 0.5);
  assert.equal(six.servings, 6);
});

test('what cannot be matched or weighed is reported, and left out of the numbers', () => {
  const r = recipeNutrition([
    ing('Chicken breast', '400g'),
    ing('Gochujang', '2 tbsp'),        // USDA has no match
    ing('Mirin', '1 tbsp'),            // never looked up
    ing('Chopped tomatoes', '1 can'),  // matched, but a can can't be weighed
    ing('Parsley', 'to garnish'),      // no amount
  ], lookup);
  assert.deepEqual(r.unmatched, ['Gochujang', 'Mirin']);
  assert.deepEqual(r.unweighed, ['Chopped tomatoes']);
  assert.deepEqual(r.noAmount, ['Parsley']);
  assert.deepEqual([r.counted, r.ingredients], [1, 5]);
  close(r.total.kcal, 480, 'only the chicken is in the numbers');
});

test('an empty recipe is zero, not an error', () => {
  const r = recipeNutrition([], lookup);
  assert.deepEqual(r.perServing, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  assert.equal(r.counted, 0);
});

test('keys are the normalized US name, and water and salt need no lookup', () => {
  assert.equal(nutritionKey('Red Onions'), 'red onion');
  assert.equal(nutritionKey('Chopped tomatoes'), 'chopped tomato');
  assert.ok(hasNoCalories('water') && hasNoCalories('salt') && hasNoCalories('sea salt'));
  assert.ok(!hasNoCalories('olive oil') && !hasNoCalories('sugar'), 'oil and sugar are staples in a kitchen, not in the numbers');
});

// ── Matching cases from review (descriptions as USDA writes them) ──────────

import { searchTermFor } from '../supabase/functions/_shared/nutrition.ts';
const food = (fdcId: number, description: string, kcal = 100, carbs = 10): FdcSearchFood => ({ fdcId, description, dataType: 'SR Legacy', foodNutrients: n(kcal, 5, 5, carbs) });

test('a hyphenated word is not the ingredient: sugar-apples are not sugar', () => {
  const results = [food(1, 'Sugar-apples, (sweetsop), raw', 94), food(2, 'Toaster pastries, brown-sugar-cinnamon', 412), food(3, 'Sugars, granulated', 387)];
  assert.equal(pickFood(searchTermFor('sugar'), results)?.fdcId, 3);
  assert.equal(pickFood('sugar', [results[0], results[1]]), null, 'neither is sugar');
  assert.equal(pickFood(searchTermFor('brown sugar'), [results[1], food(4, 'Sugars, brown', 380)])?.fdcId, 4);
});

test('an egg is a whole egg, not an egg white', () => {
  const results = [food(1, 'Egg, white, raw, fresh', 52), food(2, 'Egg, yolk, raw, fresh', 322), food(3, 'Egg, whole, raw, fresh', 143)];
  assert.equal(pickFood(searchTermFor('egg'), results)?.fdcId, 3);
  assert.equal(pickFood('egg', results)?.fdcId, 3, 'even without the search term');
});

test('common ingredients search for the plain food by USDA\'s own words', () => {
  assert.equal(pickFood(searchTermFor('milk'), [food(1, 'Milk, sheep, fluid'), food(2, 'Milk, buttermilk, fluid, whole'), food(3, 'Milk, whole, 3.25% milkfat, with added vitamin D')])?.fdcId, 3);
  assert.equal(pickFood(searchTermFor('rice'), [food(1, 'Wild rice, raw'), food(2, 'Rice, white, long-grain, regular, raw, enriched')])?.fdcId, 2);
  assert.equal(pickFood(searchTermFor('tomato'), [food(1, 'Tomatoes, green, raw'), food(2, 'Tomatoes, red, ripe, raw, year round average')])?.fdcId, 2);
  assert.equal(pickFood(searchTermFor('chicken breast'), [food(1, 'Chicken, broilers or fryers, breast, meat and skin, raw'), food(2, 'Chicken, broilers or fryers, breast, meat only, raw')])?.fdcId, 2);
  assert.equal(pickFood(searchTermFor('unsalted butter'), [food(1, 'Butter, salted'), food(2, 'Butter, without salt')])?.fdcId, 2);
  assert.equal(pickFood(searchTermFor('chicken stock'), [food(1, 'Soup, stock, chicken, home-prepared')])?.fdcId, 1);
  assert.equal(searchTermFor('basmati rice'), searchTermFor('rice'));
  assert.equal(searchTermFor('dragon fruit'), 'dragon fruit', 'anything else is searched as named');
});

test('a slightly negative value from USDA is read as zero', () => {
  assert.equal(per100g({ fdcId: 1, description: 'Chicken, breast', foodNutrients: n(120, 22.5, 2.6, -0.428) })!.carbs, 0);
});

test('a splash is not a trace: it can\'t be weighed', () => {
  assert.equal(gramsOf(ing('Olive oil', '1 splash'), { tbsp: 13.5 }), null);
});
