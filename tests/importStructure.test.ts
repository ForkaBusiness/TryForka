// Imported recipes: ingredient lines -> structured parts, pasted blocks -> lines, and a
// saved draft -> a catalog-shaped row that the allergy gate judges like any other recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredientLine, splitIngredientBlock, splitStepBlock } from '../supabase/functions/_shared/imports/ingredientLine.ts';
import { draftToRow, rowToDraft } from '../supabase/functions/_shared/imports/structure.ts';
import { canonicalUrl, emptyDraft, type ImportDraft } from '../supabase/functions/_shared/imports/draft.ts';
import { recipeGate, type RecipeSource } from '../src/lib/recipeGate.ts';
import { withFamilyAllergies } from '../src/lib/familyPrefs.ts';
import { combine } from '../src/lib/groceryMerge.ts';

const line = (raw: string) => {
  const p = parseIngredientLine(raw);
  return [p.quantity, p.quantity_max, p.unit, p.item, p.note];
};

test('ingredient lines: amount, unit, item and note', () => {
  assert.deepEqual(line('2 cups all-purpose flour, sifted'), [2, null, 'cup', 'all-purpose flour', 'sifted']);
  assert.deepEqual(line('1 1/2 tsp kosher salt'), [1.5, null, 'tsp', 'kosher salt', '']);
  assert.deepEqual(line('½ cup grated Parmesan'), [0.5, null, 'cup', 'grated Parmesan', '']);
  assert.deepEqual(line('2-3 cloves garlic, minced'), [2, 3, 'clove', 'garlic', 'minced']);
  assert.deepEqual(line('1 (14 oz) can diced tomatoes'), [1, null, 'can', 'diced tomatoes', '(14 oz)']);
  assert.deepEqual(line('200g/7oz unsalted butter, softened'), [200, null, 'g', 'unsalted butter', 'softened']);
  assert.deepEqual(line('1 lb boneless, skinless chicken thighs'), [1, null, 'lb', 'boneless, skinless chicken thighs', '']);
  assert.deepEqual(line('2 large eggs'), [2, null, '', 'large eggs', '']);
  assert.deepEqual(line('1 onion, finely chopped'), [1, null, '', 'onion', 'finely chopped']);
  assert.deepEqual(line('3 tbsp olive oil, divided'), [3, null, 'tbsp', 'olive oil', 'divided']);
  assert.deepEqual(line('Salt and pepper, to taste'), [null, null, '', 'Salt and pepper', 'to taste']);
  assert.deepEqual(line('Salt to taste'), [null, null, '', 'Salt', 'to taste']);
  assert.deepEqual(line('Fresh basil for garnish'), [null, null, '', 'Fresh basil', 'for garnish']);
  assert.deepEqual(line('a pinch of red pepper flakes'), [1, null, 'pinch', 'red pepper flakes', '']);
  assert.deepEqual(line('• 1/4 cup pine nuts (toasted)'), [0.25, null, 'cup', 'pine nuts', '(toasted)']);
  assert.deepEqual(line('▢ 500 ml whole milk'), [500, null, 'ml', 'whole milk', '']);
  assert.deepEqual(line('2 x 400g tins chickpeas, drained'), [2, null, 'can', 'chickpeas', 'drained (400g)']);
  assert.deepEqual(line('1 cup basil pesto - store-bought is fine'), [1, null, 'cup', 'basil pesto', 'store-bought is fine']);
});

test('ingredient lines: nothing is invented', () => {
  // No number written: no amount, the whole line is kept.
  assert.deepEqual(line('Flour'), [null, null, '', 'Flour', '']);
  assert.deepEqual(line('Juice of 1 lemon'), [null, null, '', 'Juice of 1 lemon', '']);
  assert.deepEqual(line(''), [null, null, '', '', '']);
});

test('pasted ingredients split into lines without headings', () => {
  const block = 'Ingredients:\n• 2 cups flour\n• 1 tsp salt\n\nFor the sauce:\n- 1 cup cream\n- 2 tbsp butter';
  assert.deepEqual(splitIngredientBlock(block), ['2 cups flour', '1 tsp salt', '1 cup cream', '2 tbsp butter']);
  assert.deepEqual(splitIngredientBlock('2 eggs • 1 cup milk • pinch of salt'), ['2 eggs', '1 cup milk', 'pinch of salt']);
});

test('pasted steps split into an ordered list', () => {
  assert.deepEqual(splitStepBlock('1. Preheat the oven to 400F.\n2. Mix the flour and salt.\n\n3. Bake for 20 minutes.'),
    ['Preheat the oven to 400F.', 'Mix the flour and salt.', 'Bake for 20 minutes.']);
  assert.deepEqual(splitStepBlock('1. Mix everything. 2. Pour into the pan. 3. Bake 30 min.'),
    ['Mix everything.', 'Pour into the pan.', 'Bake 30 min.']);
  assert.deepEqual(splitStepBlock('Step 1\nBoil water.\nStep 2\nAdd pasta.'), ['Boil water.', 'Add pasta.']);
});

function draft(lines: string[], steps: string[], title = 'Weeknight pasta'): ImportDraft {
  return { ...emptyDraft('website'), title, ingredients: lines.map(parseIngredientLine), steps, servings: 4,
    source: { kind: 'website', url: 'https://example.com/pasta', site_name: 'Example', platform: null, handle: null } };
}

test('saved drafts get the catalog allergen tags', () => {
  const pesto = draftToRow(draft(['1 lb spaghetti', '1 cup basil pesto', '1/4 cup pine nuts', 'Parmesan, to serve'], ['Cook the pasta.', 'Toss with pesto.']));
  assert.ok(pesto.allergens.includes('tree_nut'), 'pesto and pine nuts are tree nut');
  assert.ok(pesto.allergens.includes('gluten'), 'spaghetti is gluten');
  assert.ok(pesto.allergens.includes('dairy'), 'parmesan is dairy');
  assert.ok(pesto.ingredients.find(i => i.name === 'basil pesto')!.allergens.includes('tree_nut'));
  assert.ok(!pesto.diets.includes('vegan'));
  const salad = draftToRow(draft(['2 cups chickpeas', '1 cucumber', '2 tbsp olive oil'], ['Mix.'], 'Chickpea salad'));
  assert.deepEqual(salad.allergens, []);
  assert.ok(salad.diets.includes('vegan'));
  // A note can carry the allergen.
  const note = draftToRow(draft(['2 tbsp oil (or sesame oil)'], ['Heat.']));
  assert.ok(note.allergens.includes('sesame'));
  // Times and servings.
  const timed = draftToRow({ ...draft(['1 egg'], ['Boil.']), prep_minutes: 5, cook_minutes: 10 });
  assert.equal(timed.total_minutes, 15);
  assert.equal(timed.servings, 4);
});

test('imported recipes pass through the allergy gate like catalog recipes', async () => {
  const pesto = { id: 1_000_000_001, meal_role: null, ...draftToRow(draft(['1 lb spaghetti', '1 cup pesto'], ['Cook.'])) };
  const plain = { id: 1_000_000_002, meal_role: null, ...draftToRow(draft(['2 cups rice', '1 cup peas'], ['Cook.'], 'Rice and peas')) };
  const rows = [pesto, plain];
  const source: RecipeSource<typeof pesto> = {
    page: async () => rows, byRole: async () => rows, byIds: async ids => rows.filter(r => ids.includes(r.id)),
    one: async id => rows.find(r => r.id === id) ?? null, sample: async () => rows,
  };
  const gate = recipeGate(source);
  // The household has no allergies; one child is allergic to tree nuts.
  const prefs = withFamilyAllergies({ allergies: [] as string[], skip_ingredients: [] as string[] }, [{ allergies: ['tree_nut'] }]);
  assert.deepEqual((await gate.cards([pesto.id, plain.id], prefs)).map(r => r.id), [plain.id]);
  const opened = await gate.open(pesto.id, prefs);
  assert.deepEqual(opened?.blockedBy, ['Tree nut']);
  // Written as an ingredient allergy ("pine nuts") it still catches pesto.
  assert.equal((await gate.cards([pesto.id], { allergies: ['pine nuts'], skip_ingredients: [] })).length, 0);
  // Even a stored row whose allergen column was emptied is caught by its ingredient names.
  const tampered = { ...pesto, allergens: [] };
  rows.push({ ...tampered, id: 1_000_000_003 });
  assert.equal((await gate.cards([1_000_000_003], prefs)).length, 0);
});

test('imported recipes merge into the grocery list', () => {
  const a = draftToRow(draft(['2 cups flour', '1 onion'], ['Mix.']));
  const b = draftToRow(draft(['1 cup flour', '2 onions, sliced'], ['Mix.']));
  const items = combine([{ id: 1, title: 'A', ingredients: a.ingredients }, { id: 2, title: 'B', ingredients: b.ingredients }], () => undefined);
  const flour = items.find(i => i.key === 'flour')!;
  assert.equal(flour.amounts.length, 1);
  assert.equal(flour.amounts[0].family, 'volume');
  assert.equal(flour.amounts[0].value, 720);
  const onion = items.find(i => i.key === 'onion')!;
  assert.equal(onion.amounts[0].value, 3);
});

test('a saved recipe opens again as the same draft', () => {
  const d = draft(['2 cups flour, sifted', 'Salt, to taste'], ['Mix at 200C.', 'Bake 20 minutes.']);
  const row = draftToRow(d);
  assert.equal(row.steps[0].text_us, 'Mix at 400°F.');
  assert.equal(row.steps[1].timers.length, 1);
  const back = rowToDraft(row);
  assert.deepEqual(back.steps, ['Mix at 200C.', 'Bake 20 minutes.']);
  assert.deepEqual(back.ingredients.map(i => [i.quantity, i.unit, i.item, i.note]), [[2, 'cup', 'flour', 'sifted'], [null, '', 'Salt', 'to taste']]);
  assert.equal(back.source.url, 'https://example.com/pasta');
});

test('source URLs have one spelling, for spotting duplicates', () => {
  const same = [
    'https://www.seriouseats.com/the-best-chili-recipe',
    'http://seriouseats.com/the-best-chili-recipe/',
    'https://www.seriouseats.com/the-best-chili-recipe?utm_source=pinterest&utm_medium=social#recipe',
    'https://m.seriouseats.com/the-best-chili-recipe?fbclid=abc',
  ];
  assert.deepEqual(new Set(same.map(canonicalUrl)).size, 1);
  assert.equal(canonicalUrl('https://example.com/r?id=5&utm_campaign=x'), 'https://example.com/r?id=5');
  assert.notEqual(canonicalUrl('https://example.com/r?id=5'), canonicalUrl('https://example.com/r?id=6'));
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  assert.equal(canonicalUrl('not a url'), null);
});

test('an ingredient written back as text parses to the same parts', async () => {
  const { ingredientText } = await import('../supabase/functions/_shared/imports/structure.ts');
  for (const raw of ['200 g unsalted butter, softened', '2-3 cloves garlic, minced', '1 1/2 cups whole milk', 'Salt, to taste', '1 can diced tomatoes (14 oz)', '2 large eggs', '1/4 cup pine nuts']) {
    const once = parseIngredientLine(raw);
    assert.deepEqual(parseIngredientLine(ingredientText(once)), once, raw);
  }
  assert.equal(ingredientText(parseIngredientLine('200 g butter')), '200 g butter');
});

test('pesto counts as dairy as well as tree nut, unless it says otherwise', async () => {
  const { ingredientAllergens } = await import('../supabase/functions/_shared/catalog/allergens.ts');
  assert.deepEqual(ingredientAllergens('basil pesto').sort(), ['dairy', 'tree_nut']);
  assert.ok(!ingredientAllergens('vegan pesto').includes('dairy'));
  const row = draftToRow(draft(['1 cup pesto', '12 oz spaghetti'], ['Toss.']));
  assert.ok(!row.diets.includes('vegan'));
  assert.ok(row.diets.includes('vegetarian'));
});
