// Cooking help: the built-in swap table (amounts for what the recipe needs) and the
// family's allergy filter on every suggestion, from the table or the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeSwaps, safeVariations, tableSwaps, tidyText, type Swap, type Variation } from '../supabase/functions/_shared/cooking/help.ts';

const ing = (name: string, quantity: number | null, unit = '') => ({ name, name_us: name, quantity, unit });
const uses = (r: ReturnType<typeof tableSwaps>) => r?.swaps.map(s => s.use) ?? [];
const NONE = { allergies: [], skip_ingredients: [] };

test('table: buttermilk, with amounts for what the recipe needs', () => {
  const r = tableSwaps(ing('Buttermilk', 1, 'cup'), 1, 'us');
  assert.equal(r?.missing, 'buttermilk');
  assert.equal(uses(r)[0], 'Use 1 cup milk plus 1 tbsp lemon juice');
  assert.match(r!.swaps[0].how, /5 minutes/);
  // Scaled up to the chosen servings (4 -> 6).
  assert.equal(uses(tableSwaps(ing('Buttermilk', 1, 'cup'), 1.5, 'us'))[0], 'Use 1 1/2 cups milk plus 1 1/2 tbsp lemon juice');
  assert.equal(uses(tableSwaps(ing('Buttermilk', 250, 'ml'), 1, 'metric'))[0], 'Use 250 ml milk plus 16 ml lemon juice');
  // No amount: a rule of thumb.
  assert.equal(uses(tableSwaps(ing('Buttermilk', null), 1, 'us'))[0], 'For each cup of buttermilk, use 1 cup milk plus 1 tbsp lemon juice');
  // Clean cup fractions stay in cups; other small amounts in spoons.
  assert.equal(uses(tableSwaps(ing('Buttermilk', 1, 'cup'), 1, 'us'))[2], 'Use 3/4 cup plain yogurt plus 1/4 cup milk');
});

test('table: eggs, butter, sour cream, wine', () => {
  assert.equal(uses(tableSwaps(ing('Eggs', 2), 1, 'us'))[0], 'Use 2 tbsp ground flaxseed plus 6 tbsp water');
  assert.equal(uses(tableSwaps(ing('Large eggs', 3), 1, 'us'))[2], 'Use 3/4 cup unsweetened applesauce');
  assert.equal(uses(tableSwaps(ing('Butter', 4, 'tbsp'), 1, 'us'))[0], 'Use 3 tbsp olive oil');
  assert.equal(uses(tableSwaps(ing('Unsalted butter', 1, 'stick'), 1, 'us'))[0], 'Use 6 tbsp olive oil');
  assert.equal(uses(tableSwaps(ing('Butter', 1, 'cup'), 1, 'us'))[0], 'Use 3/4 cup olive oil');
  assert.equal(tableSwaps(ing('Butter', 100, 'g'), 1, 'metric')?.missing, 'butter');
  assert.equal(uses(tableSwaps(ing('Sour cream', 0.5, 'cup'), 1, 'us'))[0], 'Use 1/2 cup plain Greek yogurt');
  assert.equal(uses(tableSwaps(ing('Dry white wine', 0.5, 'cup'), 1, 'us'))[0], 'Use 1/2 cup vegetable stock plus 1 1/2 tsp lemon juice');
  assert.equal(tableSwaps(ing('Red wine', 1, 'cup'), 1, 'us')?.missing, 'red wine');
  assert.match(uses(tableSwaps(ing('Red wine', 1, 'cup'), 1, 'us'))[0], /^Use 1 cup beef stock plus 1 tsp balsamic vinegar$/);
});

test('table: fresh herbs to dried, and back', () => {
  const r = tableSwaps(ing('Fresh parsley', 3, 'tbsp'), 1, 'us');
  assert.equal(r?.missing, 'fresh parsley');
  assert.equal(uses(r)[0], 'Use 1 tbsp dried parsley');
  assert.equal(uses(tableSwaps(ing('Thyme', 1, 'tbsp'), 2, 'us'))[0], 'Use 2 tsp dried thyme');
  assert.equal(uses(tableSwaps(ing('Rosemary', 2, 'sprig'), 1, 'us'))[0], 'For each tablespoon of fresh rosemary, use 1 tsp dried rosemary');
  assert.equal(uses(tableSwaps(ing('Dried oregano', 1, 'tsp'), 1, 'us'))[0], 'Use 1 tbsp chopped fresh oregano');
});

test('table: only what it covers (the model answers the rest)', () => {
  for (const name of ['Buttermilk biscuits', 'Sour cream and onion chips', 'Peanut butter', 'Butternut squash', 'Eggplant', 'Egg noodles', 'Egg yolks', 'Red wine vinegar', 'Ground coriander', 'Saffron', 'Cream'])
    assert.equal(tableSwaps(ing(name, 1, 'cup'), 1, 'us'), null, name);
  assert.equal(tableSwaps(ing('Buttermilk', 1, 'cup'), 1, 'us')?.missing, 'buttermilk', 'buttermilk is not butter');
});

test('allergy filter: a dairy allergy leaves only dairy-free swaps for buttermilk', () => {
  const r = tableSwaps(ing('Buttermilk', 1, 'cup'), 1, 'us')!;
  const safe = safeSwaps(r.swaps, { allergies: ['dairy'], skip_ingredients: [] }).map(s => s.use);
  assert.deepEqual(safe, ['Use 1 cup oat milk plus 1 tbsp lemon juice', 'Use 1 cup soy milk plus 1 tbsp lemon juice']);
  // Dairy and soy and gluten (oats): nothing is safe, and nothing is shown.
  assert.deepEqual(safeSwaps(r.swaps, { allergies: ['dairy', 'soy', 'gluten'], skip_ingredients: [] }), []);
});

test("allergy filter: one family member's allergy counts, custom allergies and never-ingredients too", () => {
  const eggs = tableSwaps(ing('Eggs', 2), 1, 'us')!.swaps;
  // A family member allergic to chickpeas (legume, custom term) loses the aquafaba swap.
  assert.ok(!safeSwaps(eggs, { allergies: ['chickpea'], skip_ingredients: [] }).some(s => /aquafaba/.test(s.use)));
  assert.equal(safeSwaps(eggs, { allergies: ['chickpea'], skip_ingredients: [] }).length, 3);
  // "Never banana" removes the banana swap.
  assert.ok(!safeSwaps(eggs, { allergies: [], skip_ingredients: ['banana'] }).some(s => /banana/.test(s.use)));
  // A lemon allergy removes every swap that uses lemon.
  const buttermilk = tableSwaps(ing('Buttermilk', 1, 'cup'), 1, 'us')!.swaps;
  assert.ok(safeSwaps(buttermilk, { allergies: ['lemon'], skip_ingredients: [] }).every(s => !/lemon/i.test(s.use)));
  // Vegan household: no milk or yogurt swaps.
  assert.ok(safeSwaps(buttermilk, { diet: 'vegan', allergies: [], skip_ingredients: [] }).every(s => !/\b(milk|yogurt)\b/.test(s.use) || /(oat|soy) milk/.test(s.use)));
});

test('allergy filter: model answers mentioning an allergen anywhere are dropped', () => {
  const fromModel: Swap[] = [
    { use: 'Use 1 cup almond milk', how: 'Works in sauces.', uses: ['almond milk'] },
    { use: 'Use 1 cup oat milk', how: 'Or almond milk if you have it.', uses: ['oat milk'] },
    { use: 'Use 1 cup coconut milk', how: 'Stir in at the end.', uses: ['coconut milk'] },
    { use: 'Use 2 tbsp tahini', how: 'Thin with water.', uses: ['tahini'] },
    { use: 'Use 1 tbsp fish sauce', how: 'Adds depth.', uses: [] },
  ];
  const safe = safeSwaps(fromModel, { allergies: ['tree_nut', 'sesame', 'fish'], skip_ingredients: [] }).map(s => s.use);
  assert.deepEqual(safe, ['Use 1 cup coconut milk']);
  assert.equal(safeSwaps(fromModel, NONE).length, 5);
  // Diets read the words too: meat the model didn't list is still caught.
  const vegetarian = { diet: 'vegetarian', allergies: [], skip_ingredients: [] };
  assert.deepEqual(safeSwaps([{ use: 'Use 1 cup chicken stock', how: 'Same amount.', uses: ['stock'] }, { use: 'Use 1 cup vegetable stock', how: 'Same amount.', uses: ['stock'] }], vegetarian).map(s => s.use), ['Use 1 cup vegetable stock']);
});

test('allergy filter: variations', () => {
  const variations: Variation[] = [
    { title: 'Spinach and feta', summary: 'Greens and salty cheese.', changes: ['Stir in 2 cups spinach.', 'Crumble feta over the top.'], adds: ['spinach', 'feta'], removes: [] },
    { title: 'Smoky paprika', summary: 'A smoky, warm version.', changes: ['Add 2 tsp smoked paprika with the flour.'], adds: ['smoked paprika'], removes: [] },
    { title: 'Peanut crunch', summary: 'A crunchy topping.', changes: ['Scatter chopped peanuts over.'], adds: ['peanuts'], removes: [] },
    { title: 'With bacon', summary: 'Crisp bacon on top.', changes: ['Fry 4 slices of bacon.'], adds: ['bacon'], removes: [] },
  ];
  const titles = (prefs: Parameters<typeof safeVariations>[1]) => safeVariations(variations, prefs).map(v => v.title);
  assert.deepEqual(titles({ allergies: ['dairy', 'peanut'], skip_ingredients: [] }), ['Smoky paprika', 'With bacon']);
  assert.deepEqual(titles({ diet: 'vegetarian', allergies: [], skip_ingredients: [] }), ['Spinach and feta', 'Smoky paprika', 'Peanut crunch']);
  assert.deepEqual(titles({ allergies: [], skip_ingredients: ['pork'] }), ['Spinach and feta', 'Smoky paprika', 'Peanut crunch']);
  const sneaky: Variation = { title: 'Smoky', summary: 'Smoky.', changes: ['Fry 4 slices bacon.'], adds: ['paprika'], removes: [] };
  assert.deepEqual(safeVariations([sneaky], { diet: 'vegetarian', allergies: [], skip_ingredients: [] }), []);
});

test('model text: no em dashes or emoji', () => {
  assert.equal(tidyText('Use yogurt — it works 🙂'), 'Use yogurt, it works');
  assert.equal(tidyText('Bake 25–30 minutes'), 'Bake 25-30 minutes');
});
