// Grocery merge tests, built from the cases that were wrong on the old list
// (docs/screens: "Coriander, for 7 meals, 1/2 cup", "Cherry Tomatoes 500 g + 6",
// "Blackberries" with nothing, "Basil, small pack").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountLines, combine, entryMultiplier, itemKey, listText, type MergeIngredient, type MergeRecipe } from '../src/lib/groceryMerge.ts';
import { parseMeasure } from '../supabase/functions/_shared/catalog/units.ts';
import { usIngredientName } from '../supabase/functions/_shared/catalog/names.ts';

function ing(name: string, measure: string): MergeIngredient {
  const m = parseMeasure(measure);
  return { name, name_us: usIngredientName(name, measure), measure_raw: measure, quantity: m.quantity, quantity_max: m.quantityMax, unit: m.unit };
}
const recipe = (id: number, title: string, ...ingredients: MergeIngredient[]): MergeRecipe => ({ id, title, ingredients });
const aisle = () => undefined;
const find = (items: ReturnType<typeof combine>, key: string) => items.find(i => i.key === key)!;

test('cilantro across 7 meals sums every amount instead of showing one recipe\'s', () => {
  const items = combine([
    recipe(1, 'Tacos', ing('Coriander', '1/2 cup')),
    recipe(2, 'Curry', ing('Coriander', 'Handful')),
    recipe(3, 'Dal', ing('Coriander', '2 tbs chopped')),
    recipe(4, 'Salsa', ing('Fresh Coriander', '1 bunch')),
    recipe(5, 'Rice', ing('Coriander Leaves', '1 tbsp')),
    recipe(6, 'Soup', ing('Coriander', '')),
    recipe(7, 'Bowl', ing('Coriander', '1/4 cup')),
  ], aisle);
  const cilantro = find(items, 'cilantro');
  assert.equal(new Set(cilantro.meals).size, 7);
  // 1/2 cup + 2 tbsp + 1 tbsp + 1/4 cup = 120 + 30 + 15 + 60 = 225 ml -> about 1 cup
  assert.deepEqual(amountLines(cilantro, 'us'), ['1 cup', '1 bunch']);
  assert.deepEqual(cilantro.notes, [{ text: 'Handful', recipe: 'Curry' }]);
});

test('cherry tomatoes: grams and a bare count stay on separate lines', () => {
  const items = combine([
    recipe(1, 'Pasta', ing('Cherry Tomatoes', '500g')),
    recipe(2, 'Salad', ing('Cherry Tomatoes', '6')),
    recipe(3, 'Bake', ing('Cherry Tomatoes', '250g')),
  ], aisle);
  assert.deepEqual(amountLines(find(items, 'cherry tomato'), 'us'), ['1 3/4 lb', '6 whole']);
  assert.deepEqual(amountLines(find(items, 'cherry tomato'), 'metric'), ['750 g', '6 whole']);
});

test('weights in different units add up', () => {
  const items = combine([
    recipe(1, 'A', ing('Potatoes', '900g')),
    recipe(2, 'B', ing('Potatoes', '1 lb')),
    recipe(3, 'C', ing('Potatoes', '0.5kg')),
  ], aisle);
  assert.deepEqual(amountLines(find(items, 'potato'), 'us'), ['4 lb']);
});

test('garlic cloves from different spellings combine (a bare count on "Garlic Clove" is cloves)', () => {
  const items = combine([
    recipe(1, 'A', ing('Garlic', '3 cloves')),
    recipe(2, 'B', ing('Garlic Clove', '2')),
    recipe(3, 'C', ing('Garlic', '1 clove peeled crushed')),
  ], aisle);
  const garlic = find(items, 'garlic');
  assert.deepEqual(amountLines(garlic, 'us'), ['6 cloves']);
});

test('no measure shows which recipe needs it; vague measures keep their words', () => {
  const items = combine([
    recipe(1, 'Pavlova', ing('Blackberries', '')),
    recipe(2, 'Pesto pasta', ing('Basil', 'small pack')),
  ], aisle);
  const blackberries = find(items, 'blackberry');
  assert.deepEqual(amountLines(blackberries, 'us'), []);
  assert.deepEqual(blackberries.notes, [{ text: '', recipe: 'Pavlova' }]);
  assert.deepEqual(find(items, 'basil').notes, [{ text: 'small pack', recipe: 'Pesto pasta' }]);
});

test('no mixed-unit strings anywhere: every line is one unit', () => {
  const items = combine([
    recipe(1, 'A', ing('Milk', '200ml'), ing('Flour', '200g'), ing('Butter', '2 tbsp')),
    recipe(2, 'B', ing('Milk', '1 cup'), ing('Flour', '1 cup'), ing('Butter', '50g')),
  ], aisle);
  for (const item of items) for (const line of amountLines(item, 'us')) assert.ok(!line.includes('+'), line);
  assert.deepEqual(amountLines(find(items, 'milk'), 'us'), ['1 3/4 cups']);
  assert.deepEqual(amountLines(find(items, 'flour'), 'us'), ['7 oz', '1 cup']);
});

test('staples are flagged, ice is skipped, keys are US singular names', () => {
  const items = combine([recipe(1, 'A', ing('Salt', 'pinch'), ing('Olive Oil', '2 tbsp'), ing('Water', '1 cup'), ing('Ice', 'handful'), ing('Aubergine', '2'))], aisle);
  assert.ok(find(items, 'salt').staple);
  assert.ok(find(items, 'olive oil').staple);
  assert.ok(find(items, 'water').staple);
  assert.equal(items.find(i => i.key === 'ice'), undefined);
  assert.equal(find(items, 'eggplant').name, 'Eggplant');
  assert.equal(itemKey('Cherry Tomatoes'), 'cherry tomato');
});

test('copied text leaves out ticked items and staples', () => {
  const items = combine([recipe(1, 'A', ing('Onion', '2'), ing('Salt', 'pinch'), ing('Carrots', '3'))], aisle);
  const text = listText(items, [{ key: 'custom:1', name: 'Paper towels' }], new Set(['carrot']), 'us');
  assert.match(text, /Onion, 2 whole/);
  assert.doesNotMatch(text, /Carrot|Salt/);
  assert.match(text, /Paper towels/);
});

test('prep words merge into the plain item; canned tomatoes stay separate', () => {
  const items = combine([
    recipe(1, 'A', ing('Chopped Onion', '1 cup'), ing('Chopped Tomatoes', '400g')),
    recipe(2, 'B', ing('Onion', '1'), ing('Tomatoes', '2')),
  ], aisle);
  const onion = find(items, 'onion');
  assert.equal(onion.name, 'Onion');
  assert.equal(new Set(onion.meals).size, 2);
  assert.ok(find(items, 'chopped tomato'));
  assert.ok(find(items, 'tomato'));
});

// ── Quantity math, unit conversion, and taking recipes off the list ────────

import { protectedByList, recipeItems, shoppedRecipeIds, withoutRecipes } from '../src/lib/groceryMerge.ts';

test('volumes in spoons, cups and millilitres add up to one amount', () => {
  const items = combine([
    recipe(1, 'A', ing('Soy Sauce', '2 tbsp')),
    recipe(2, 'B', ing('Soy Sauce', '1 tsp')),
    recipe(3, 'C', ing('Soy Sauce', '1/4 cup')),
    recipe(4, 'D', ing('Soy Sauce', '30ml')),
  ], aisle);
  // 30 + 5 + 60 + 30 = 125 ml
  assert.deepEqual(find(items, 'soy sauce').amounts, [{ family: 'volume', value: 125 }]);
  assert.deepEqual(amountLines(find(items, 'soy sauce'), 'us'), ['1/2 cup']);
  assert.deepEqual(amountLines(find(items, 'soy sauce'), 'metric'), ['125 ml']);
});

test('weights in grams, kilos, ounces and pounds add up to one amount', () => {
  const items = combine([
    recipe(1, 'A', ing('Minced Beef', '500g')),
    recipe(2, 'B', ing('Minced Beef', '0.25kg')),
    recipe(3, 'C', ing('Minced Beef', '8 oz')),
    recipe(4, 'D', ing('Minced Beef', '1 lb')),
  ], aisle);
  const beef = items.find(i => i.amounts.some(a => a.family === 'mass'))!;
  // 500 + 250 + 226.8 + 453.6 = 1430.4 g
  assert.ok(Math.abs(beef.amounts[0].value - 1430.4) < 0.01);
  assert.equal(beef.amounts.length, 1);
  assert.deepEqual(amountLines(beef, 'us'), ['3 1/4 lb']);
  assert.deepEqual(amountLines(beef, 'metric'), ['1.43 kg']);
});

test('a weight and a volume of the same thing are never added together', () => {
  const items = combine([
    recipe(1, 'A', ing('Sugar', '200g')),
    recipe(2, 'B', ing('Sugar', '1 cup')),
    recipe(3, 'C', ing('Sugar', '1/4 cup')),
  ], aisle);
  const sugar = find(items, 'sugar');
  // 200 g stays 200 g; 240 ml + 60 ml = 300 ml. Nothing guesses what a cup of sugar weighs.
  assert.deepEqual(sugar.amounts, [{ family: 'mass', value: 200 }, { family: 'volume', value: 300 }]);
  assert.deepEqual(amountLines(sugar, 'us'), ['7 oz', '1 1/4 cups']);
  assert.deepEqual(amountLines(sugar, 'metric'), ['200 g', '300 ml']);
});

test('things counted in different units stay on their own lines', () => {
  const items = combine([
    recipe(1, 'A', ing('Chopped Tomatoes', '2 cans')),
    recipe(2, 'B', ing('Chopped Tomatoes', '400g')),
    recipe(3, 'C', ing('Chopped Tomatoes', '1 can')),
    recipe(4, 'D', ing('Lemon', '2')),
    recipe(5, 'E', ing('Lemon', 'Juice of 1')),
    recipe(6, 'F', ing('Lemon', '1 slice')),
  ], aisle);
  assert.deepEqual(amountLines(find(items, 'chopped tomato'), 'metric'), ['3 cans', '400 g']);
  const lemon = find(items, 'lemon');
  assert.ok(amountLines(lemon, 'us').includes('1 slice'), 'a slice is not a whole lemon');
  assert.ok(!amountLines(lemon, 'us').some(l => /^4/.test(l)), 'the counts were not lumped into one number');
});

test('a range buys the upper amount, and a recipe planned twice counts twice', () => {
  const twice = recipe(1, 'Stir fry', ing('Ginger', '1-2 tbsp'), ing('Rice', '300g'));
  const items = combine([twice, twice], aisle);
  assert.deepEqual(find(items, 'ginger').amounts, [{ family: 'volume', value: 60 }]);
  assert.deepEqual(find(items, 'rice').amounts, [{ family: 'mass', value: 600 }]);
  assert.deepEqual(find(items, 'rice').meals, ['Stir fry', 'Stir fry']);
  assert.deepEqual(uniqueOf(find(items, 'rice').meals), ['Stir fry']);
});
const uniqueOf = (xs: string[]) => [...new Set(xs)];

test('every item keeps what each recipe adds, and the totals are their sum', () => {
  const items = combine([
    recipe(1, 'Tacos', ing('Onion', '2'), ing('Lime', '1')),
    recipe(2, 'Curry', ing('Onion', '1'), ing('Coconut Milk', '400ml')),
    recipe(3, 'Soup', ing('Onion', '1 large'), ing('Lime', 'Juice of 1')),
  ], aisle);
  const onion = find(items, 'onion');
  assert.deepEqual(onion.parts.map(p => [p.recipe, p.value]), [[1, 2], [2, 1], [3, 1]]);
  assert.deepEqual(onion.amounts, [{ family: 'count:', value: 4 }]);
  assert.deepEqual(onion.recipes, [1, 2, 3]);
});

test('taking a recipe off the list takes off its share and nothing else', () => {
  const items = combine([
    recipe(1, 'Tacos', ing('Onion', '2'), ing('Tortillas', '8'), ing('Beef', '500g')),
    recipe(2, 'Curry', ing('Onion', '1'), ing('Coconut Milk', '400ml'), ing('Beef', '1 lb')),
  ], aisle);
  const withoutTacos = withoutRecipes(items, new Set([1]));
  assert.deepEqual(amountLines(find(withoutTacos, 'onion'), 'us'), ['1 whole']);
  assert.deepEqual(find(withoutTacos, 'onion').meals, ['Curry']);
  assert.equal(withoutTacos.find(i => i.key === 'tortilla'), undefined, 'an item only that recipe needed is gone');
  assert.deepEqual(amountLines(find(withoutTacos, 'beef'), 'us'), ['1 lb']);
  assert.ok(find(withoutTacos, 'coconut milk'));
  // Putting it back is the full list again, exactly.
  assert.deepEqual(withoutRecipes(items, new Set()), items);
  assert.deepEqual(withoutRecipes(items, new Set([1, 2])), []);
  // The original list is untouched.
  assert.deepEqual(amountLines(find(items, 'onion'), 'us'), ['3 whole']);
});

test('grouped by recipe, each recipe shows its own amounts and what else the item is for', () => {
  const items = combine([
    recipe(1, 'Tacos', ing('Onion', '2'), ing('Tortillas', '8')),
    recipe(2, 'Curry', ing('Onion', '1'), ing('Coconut Milk', '400ml')),
  ], aisle);
  const tacos = recipeItems(items, 1);
  assert.deepEqual(tacos.map(i => i.key).sort(), ['onion', 'tortilla']);
  assert.deepEqual(amountLines(find(tacos, 'onion'), 'us'), ['2 whole']);
  assert.deepEqual(find(tacos, 'onion').meals, ['Tacos', 'Curry'], 'the row can still say it is for two meals');
  assert.equal(find(tacos, 'onion').key, find(items, 'onion').key, 'same key, so a tick in one view is a tick in the other');
  assert.deepEqual(amountLines(find(recipeItems(items, 2), 'onion'), 'us'), ['1 whole']);
  assert.deepEqual(recipeItems(items, 99), []);
});

test('a day stays protected when its recipe is taken off the list: ticks count from the whole list, and taken-off recipes count too', () => {
  const items = combine([
    recipe(1, 'Salmon', ing('Salmon', '500g')),
    recipe(2, 'Curry', ing('Onion', '1')),
    recipe(3, 'Tacos', ing('Tortillas', '8')),
  ], aisle);
  // Salmon was ticked, then its recipe taken off the list: still protected.
  assert.deepEqual([...protectedByList({ items, checked: ['salmon'], excluded: [1] })], [1]);
  // Taken off with nothing ticked (they have it already): protected as well.
  assert.deepEqual([...protectedByList({ items, checked: [], excluded: [3] })], [3]);
  assert.deepEqual([...protectedByList({ items, checked: [], excluded: [] })], []);
});

test('amounts with nothing to add up stay as written, next to the amounts that do', () => {
  const items = combine([
    recipe(1, 'A', ing('Parsley', '1 bunch')),
    recipe(2, 'B', ing('Parsley', 'to garnish')),
    recipe(3, 'C', ing('Parsley', '2 tbsp chopped')),
  ], aisle);
  const parsley = find(items, 'parsley');
  assert.deepEqual(amountLines(parsley, 'us'), ['1 bunch', '2 tbsp']);
  assert.deepEqual(parsley.notes, [{ text: 'to garnish', recipe: 'B' }]);
});

// ── Numbers with a word before the unit, or no unit we know ────────────────

import { countUnit } from '../src/lib/groceryMerge.ts';

test('a describing word before the unit does not turn it into whole items', () => {
  assert.equal(countUnit('2'), '');
  assert.equal(countUnit('1 large'), '');
  assert.equal(countUnit('3 chopped'), '');
  assert.equal(countUnit('5 chopped cloves'), 'clove');
  assert.equal(countUnit('4 thick slices'), 'slice');
  assert.equal(countUnit('2 small stalks'), 'stalk');
  assert.equal(countUnit('2 x 400g'), null);
  assert.equal(countUnit('2 fresh kaffir leaves'), null);
  assert.equal(countUnit('3 400g Cans'), null);
  assert.equal(countUnit('1 heaped tsp'), null);
});

test('real catalog cases: cans, kaffir leaves and chopped cloves are not added to whole ones', () => {
  const raw = (name: string, measure: string, quantity: number): MergeIngredient => ({ name, name_us: name, measure_raw: measure, quantity, quantity_max: null, unit: '' });
  const items = combine([
    recipe(1, 'Braised beef chilli', raw('Plum Tomatoes', '2 x 400g', 2)),
    recipe(2, 'Kefta', raw('Plum Tomatoes', '3', 3)),
    recipe(3, 'Green curry', raw('Lime', '2 fresh kaffir leaves', 2)),
    recipe(4, 'Pho', raw('Lime', '1', 1)),
    recipe(5, 'Katsu', raw('Garlic', '5 chopped cloves', 5)),
    recipe(6, 'Shakshouka', ing('Garlic', '4 cloves')),
  ], aisle);
  assert.deepEqual(amountLines(find(items, 'plum tomato'), 'us'), ['3 whole']);
  assert.deepEqual(find(items, 'plum tomato').notes, [{ text: '2 x 400g', recipe: 'Braised beef chilli' }]);
  assert.deepEqual(amountLines(find(items, 'lime'), 'us'), ['1 whole']);
  assert.deepEqual(find(items, 'lime').notes, [{ text: '2 fresh kaffir leaves', recipe: 'Green curry' }]);
  assert.deepEqual(amountLines(find(items, 'garlic'), 'us'), ['9 cloves']);
});

import { sameShop } from '../src/lib/groceryMerge.ts';

test('re-planning in the same week keeps the shop; a new week starts fresh', () => {
  // Plans made Monday and Thursday of the same week (local time): same shop, ticks stay.
  assert.ok(sameShop('2026-11-16T15:00:00', '2026-11-19T20:00:00'));
  assert.ok(sameShop('2026-11-16T15:00:00', '2026-11-22T21:00:00'), 'through Sunday');
  // The next Monday: a new shop.
  assert.ok(!sameShop('2026-11-19T20:00:00', '2026-11-23T08:00:00'));
  assert.ok(sameShop(null, '2026-11-23T08:00:00'), 'a list from before plans were recorded');
});

test('every meal on one list: breakfast, a school lunch for 2 children, a snack and dinner merge correctly', () => {
  const times = entryMultiplier;
  const week = [
    { ...recipe(1, 'Scrambled eggs', ing('Eggs', '4'), ing('Milk', '1/4 cup'), ing('Butter', '1 tbsp')), multiplier: times({}) },
    { ...recipe(2, 'Egg muffins', ing('Eggs', '8'), ing('Cheddar Cheese', '1 cup'), ing('Spinach', '2 cups')), multiplier: times({ share: 0.5 }) },
    { ...recipe(3, 'Apple slices', ing('Apples', '2'), ing('Peanut Butter', '4 tbsp')), multiplier: times({}) },
    { ...recipe(4, 'Spinach frittata', ing('Eggs', '6'), ing('Spinach', '4 cups'), ing('Milk', '1/2 cup'), ing('Salt', 'to taste')), multiplier: times({}) },
  ];
  const items = combine(week, aisle);
  const eggs = find(items, 'egg');
  // 4 + 8 x 0.5 + 6 = 14 eggs, one line, with every meal that uses them.
  assert.deepEqual(amountLines(eggs, 'us'), ['14 whole']);
  assert.deepEqual(new Set(eggs.meals), new Set(['Scrambled eggs', 'Egg muffins', 'Spinach frittata']));
  // Spinach: 2 cups x 0.5 + 4 cups = 5 cups. Milk: 1/4 + 1/2 = 3/4 cup.
  assert.deepEqual(amountLines(find(items, 'spinach'), 'us'), ['5 cups']);
  assert.deepEqual(amountLines(find(items, 'milk'), 'us'), ['3/4 cup']);
  // Cheese only in the half-batch school lunch: half the amount.
  assert.deepEqual(amountLines(find(items, 'cheddar cheese'), 'us'), ['1/2 cup']);
  // An amount nobody can add up is still listed, with its meal.
  assert.ok(find(items, 'salt').notes.some(n => n.recipe === 'Spinach frittata'));
});

test('cook once, eat twice: a double batch buys twice, its leftovers buy nothing', () => {
  const times = entryMultiplier;
  const chili = (multiplier: number) => ({ ...recipe(9, 'Bean chili', ing('Kidney Beans', '2 cans'), ing('Onion', '1'), ing('Cumin', '1 tsp')), multiplier });
  const items = combine([chili(times({ cookTimes: 2 })), chili(times({ leftoverOf: { day: 'monday', slot: 'dinner', id: 9 } }))], aisle);
  assert.deepEqual(amountLines(find(items, 'kidney bean'), 'us'), ['4 cans']);
  assert.deepEqual(amountLines(find(items, 'onion'), 'us'), ['2 whole']);
  assert.equal(find(items, 'onion').meals.length, 1, 'the leftover meal adds no line of its own');
  // Nothing at all to buy for a meal with multiplier 0.
  assert.equal(combine([chili(0)], aisle).length, 0);
});
