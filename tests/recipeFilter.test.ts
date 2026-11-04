// Unit tests for the recipe filter and plan repair (run with `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allergyFamilies, canonicalAllergy, checkRecipe, filterRecipes, isDislikeGroup, normalizeIngredient, pickReplacement, recipeChecker, REPLACEMENT_TRIES,
} from '../supabase/functions/_shared/catalog/recipeFilter.ts';
import { ingredientAllergens } from '../supabase/functions/_shared/catalog/allergens.ts';

const none = { allergies: [], skip_ingredients: [] };
const recipe = (ingredient_names: string[], extra = {}) => ({ name: 'Weeknight dinner', ingredient_names, allergens: [], diets: [], ...extra });

test('normalize: lowercase, trim, singular, no quantities', () => {
  assert.equal(normalizeIngredient('  Peanuts '), 'peanut');
  assert.equal(normalizeIngredient('2 cups Peanuts'), 'peanut');
  assert.equal(normalizeIngredient('1 1/2 tbsp of Soy Sauce'), 'soy sauce');
  assert.equal(normalizeIngredient('400g tomatoes'), 'tomato');
  assert.equal(normalizeIngredient('½ cup Cherries'), 'cherry');
  assert.equal(normalizeIngredient('Anchovies'), 'anchovy');
  assert.equal(normalizeIngredient('Olives'), 'olive');
  assert.equal(normalizeIngredient('Radishes'), 'radish');
  assert.equal(normalizeIngredient('Bay Leaves'), 'bay leaf');
  assert.equal(normalizeIngredient('Jalapeños'), 'jalapeno');
  assert.equal(normalizeIngredient("Goat's Cheese"), 'goat cheese');
  assert.equal(normalizeIngredient('Red chillies'), 'red chili');
  assert.equal(normalizeIngredient('Hummus'), 'hummus');
  assert.equal(normalizeIngredient('Asparagus'), 'asparagus');
  assert.equal(normalizeIngredient('Molasses'), 'molasses');
  assert.equal(normalizeIngredient('7up'), '7up');
});

test('allergy "peanuts" removes a recipe with "Peanut Butter"', () => {
  const v = checkRecipe(recipe(['peanut butter', 'noodles']), { allergies: ['peanuts'], skip_ingredients: [] });
  assert.equal(v.allowed, false);
  assert.deepEqual(v.blockedBy, ['Peanut']);
});

test('dislike "peanuts" removes a recipe with "Peanut Butter"', () => {
  assert.equal(checkRecipe(recipe(['Peanut Butter']), { allergies: [], skip_ingredients: ['peanuts'] }).allowed, false);
});

test('allergy "dairy" expands to butter, even if the allergens column missed it', () => {
  for (const name of ['butter', 'milk', 'double cream', 'cheddar cheese', 'greek yogurt', 'ghee', 'whey']) {
    assert.equal(checkRecipe(recipe([name]), { allergies: ['dairy'], skip_ingredients: [] }).allowed, false, name);
  }
  // Look-alikes stay.
  for (const name of ['peanut butter', 'coconut milk', 'butter beans']) {
    assert.equal(checkRecipe(recipe([name]), { allergies: ['dairy'], skip_ingredients: [] }).allowed, true, name);
  }
});

test('a recipe with zero conflicts passes', () => {
  const prefs = { allergies: ['dairy', 'peanut', 'gluten'], skip_ingredients: ['mushrooms'], avoid_ingredients: ['olives'], diet: 'none' };
  const v = checkRecipe(recipe(['chicken breast', 'rice', 'broccoli'], { diets: [] }), prefs);
  assert.deepEqual(v, { allowed: true, blockedBy: [], avoids: [] });
});

test('the allergen map covers every family in the brief', () => {
  const covers: Record<string, string[]> = {
    dairy: ['milk', 'butter', 'cream', 'cheese', 'yogurt', 'ghee', 'whey'],
    peanut: ['peanut', 'peanut butter', 'peanut oil', 'groundnut'],
    tree_nut: ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
    egg: ['egg', 'egg yolk', 'mayonnaise'],
    soy: ['soy sauce', 'tofu', 'edamame', 'miso'],
    gluten: ['flour', 'bread', 'pasta', 'breadcrumbs', 'soy sauce'],
    shellfish: ['shrimp', 'prawns', 'crab', 'mussels'],
    fish: ['salmon', 'cod', 'anchovy'],
    sesame: ['tahini', 'sesame oil', 'sesame seeds'],
  };
  for (const [family, names] of Object.entries(covers)) {
    for (const n of names) assert.ok((ingredientAllergens(n) as string[]).includes(family), `${n} -> ${family}`);
  }
});

test('allergies: a stored allergens value always removes the recipe', () => {
  const r = recipe(['rice'], { allergens: ['shellfish'] });
  assert.equal(checkRecipe(r, { allergies: ['shellfish'], skip_ingredients: [] }).allowed, false);
});

test('allergies: free words and ingredients map to the family', () => {
  assert.deepEqual(allergyFamilies('Peanut Butter'), ['peanut']);
  assert.deepEqual(allergyFamilies('tree nuts'), ['tree_nut']);
  assert.deepEqual(allergyFamilies('nuts').sort(), ['peanut', 'tree_nut']);
  assert.deepEqual(allergyFamilies('seafood').sort(), ['fish', 'shellfish']);
  assert.deepEqual(allergyFamilies('milk'), ['dairy']);
  assert.equal(canonicalAllergy('Peanuts'), 'peanut');
  assert.equal(canonicalAllergy('Dairy'), 'dairy');
  assert.equal(canonicalAllergy('Mustard'), 'mustard');
  // An allergy to one nut hides recipes with the family.
  assert.equal(checkRecipe(recipe(['walnuts']), { allergies: ['almond'], skip_ingredients: [] }).allowed, false);
});

test('allergies: an ingredient with no family still removes recipes, broadly', () => {
  const prefs = { allergies: ['mustard'], skip_ingredients: [] };
  assert.equal(checkRecipe(recipe(['dijon mustard']), prefs).allowed, false);
  assert.equal(checkRecipe(recipe(['carrots']), prefs).allowed, true);
  assert.equal(checkRecipe(recipe(['cornstarch']), { allergies: ['corn'], skip_ingredients: [] }).allowed, false);
});

test('dislikes: whole words, so short words do not catch other ingredients', () => {
  const skip = (term: string, name: string) => checkRecipe(recipe([name]), { allergies: [], skip_ingredients: [term] }).allowed;
  assert.equal(skip('tea', 'sirloin steak'), true);
  assert.equal(skip('rum', 'breadcrumbs'), true);
  assert.equal(skip('egg', 'eggplant'), true);
  assert.equal(skip('peas', 'peanut oil'), true);
  assert.equal(skip('peas', 'chickpeas'), true);
  assert.equal(skip('ale', 'kale'), true);
  assert.equal(skip('egg', 'free-range eggs'), false);
  assert.equal(skip('cherries', 'glace cherry'), false);
  assert.equal(skip('anchovies', 'anchovy fillet'), false);
  assert.equal(skip('chilli', 'red chillies'), false);
});

test('dislikes: "olive" keeps olive oil, but "oil" and allergies still catch it', () => {
  assert.equal(checkRecipe(recipe(['olive oil']), { allergies: [], skip_ingredients: ['olives'] }).allowed, true);
  assert.equal(checkRecipe(recipe(['olive oil', 'black olives']), { allergies: [], skip_ingredients: ['olives'] }).allowed, false);
  assert.equal(checkRecipe(recipe(['olive oil']), { allergies: [], skip_ingredients: ['oil'] }).allowed, false);
  assert.equal(checkRecipe(recipe(['peanut oil']), { allergies: ['peanut'], skip_ingredients: [] }).allowed, false);
  assert.equal(checkRecipe(recipe(['olive oil']), { allergies: ['olive'], skip_ingredients: [] }).allowed, false);
});

test('dislikes: group words mean the whole family', () => {
  const skip = (term: string, names: string[]) => checkRecipe(recipe(names), { allergies: [], skip_ingredients: [term] }).allowed;
  assert.equal(skip('dairy', ['butter']), false);
  assert.equal(skip('seafood', ['salmon']), false);
  assert.equal(skip('seafood', ['mussels']), false);
  assert.equal(skip('shellfish', ['prawns']), false);
  assert.equal(skip('gluten', ['bread']), false);
  assert.equal(skip('nuts', ['walnuts']), false);
  assert.equal(skip('fish', ['salmon']), false);
  // Saved as the family key from the autocomplete.
  assert.equal(skip('tree_nut', ['walnuts']), false);
  assert.ok(isDislikeGroup('tree_nut'));
  // Not a group: disliking eggs doesn't hide mayonnaise.
  assert.equal(skip('eggs', ['mayonnaise']), true);
  assert.equal(isDislikeGroup('egg'), false);
});

test('dislikes: also matched against the recipe name', () => {
  const r = recipe(['rice'], { name: 'Mushroom risotto' });
  assert.equal(checkRecipe(r, { allergies: [], skip_ingredients: ['mushrooms'] }).allowed, false);
});

const dislikes = (term: string, name: string) => !checkRecipe(recipe([name]), { allergies: [], skip_ingredients: [term] }).allowed;

test('meat groups: pork covers cured and processed pork', () => {
  for (const name of ['pork chops', 'ground pork', 'bacon', 'streaky bacon', 'smoked ham', 'parma ham', 'prosciutto', 'pancetta', 'chorizo',
    'sour pork sausage', 'sausages', 'italian fennel sausages', 'kielbasa', 'gammon', 'lardons']) {
    assert.equal(dislikes('pork', name), true, name);
  }
  for (const name of ['turkey ham', 'turkey bacon', 'vegan sausage', 'chicken thighs', 'hamburger buns', 'champagne']) {
    assert.equal(dislikes('pork', name), false, name);
  }
});

test('meat groups: beef covers steak, ground beef and brisket', () => {
  for (const name of ['beef', 'sirloin steak', 'flank steak', 'fillet of steak', 'ground beef', 'minced beef', 'beef brisket', 'brisket', 'corned beef', 'beef stock', 'oxtail', 'chuck roast']) {
    assert.equal(dislikes('beef', name), true, name);
  }
  for (const name of ['beef tomatoes', 'pork shoulder steaks', 'tuna steak', 'salmon steaks', 'lamb steaks', 'chicken breast']) {
    assert.equal(dislikes('beef', name), false, name);
  }
});

test('meat groups: chicken covers every cut', () => {
  for (const name of ['chicken', 'chicken thighs', 'chicken breasts', 'chicken wings', 'chicken drumsticks', 'chicken stock']) {
    assert.equal(dislikes('chicken', name), true, name);
  }
  assert.equal(dislikes('chicken', 'chickpeas'), false);
  assert.equal(dislikes('chicken', 'ground turkey'), false);
});

test('meat groups: lamb covers mutton, not lamb\'s lettuce', () => {
  for (const name of ['lamb', 'lamb leg', 'lamb shanks', 'ground lamb', 'lamb mince', 'mutton']) {
    assert.equal(dislikes('lamb', name), true, name);
  }
  assert.equal(dislikes('lamb', "lamb's lettuce"), false);
  assert.equal(dislikes('lamb', 'lambs lettuce'), false);
});

test('meat groups: plurals, avoid-if-possible and the recipe name all work', () => {
  assert.equal(dislikes('Pork', 'Bacon'), true);
  assert.equal(checkRecipe(recipe(['rice'], { name: 'Bacon and egg pie' }), { allergies: [], skip_ingredients: ['pork'] }).allowed, false);
  const soft = checkRecipe(recipe(['bacon']), { allergies: [], skip_ingredients: [], avoid_ingredients: ['pork'] });
  assert.deepEqual(soft, { allowed: true, blockedBy: [], avoids: ['pork'] });
  // Picking a single cut stays specific.
  assert.equal(dislikes('bacon', 'ham'), false);
  assert.equal(dislikes('steak', 'ground beef'), false);
});

test('phrase exceptions: "cherry" is not "cherry tomato"', () => {
  assert.equal(dislikes('cherry', 'cherry tomatoes'), false);
  assert.equal(dislikes('cherries', 'Cherry Tomatoes'), false);
  assert.equal(dislikes('cherry', 'glace cherry'), true);
  assert.equal(dislikes('cherry', 'dried cherries'), true);
  assert.equal(checkRecipe(recipe(['cherry tomatoes']), { allergies: [], skip_ingredients: ['cherry tomato'] }).allowed, false);
  assert.equal(checkRecipe(recipe(['cherry tomatoes', 'dried cherries']), { allergies: [], skip_ingredients: ['cherry'] }).allowed, false);
  assert.equal(checkRecipe(recipe(['salt'], { name: 'Cherry tomato salad' }), { allergies: [], skip_ingredients: ['cherry'] }).allowed, true);
  // An allergy is never softened by a phrase exception.
  assert.equal(checkRecipe(recipe(['cherry tomatoes']), { allergies: ['cherry'], skip_ingredients: [] }).allowed, false);
});

test('"avoid if possible" keeps the recipe but ranks it last', () => {
  const prefs = { allergies: [], skip_ingredients: [], avoid_ingredients: ['olives'] };
  const withOlives = { ...recipe(['olives']), id: 1 };
  const plain = { ...recipe(['rice']), id: 2 };
  assert.deepEqual(checkRecipe(withOlives, prefs), { allowed: true, blockedBy: [], avoids: ['olives'] });
  assert.deepEqual(filterRecipes([withOlives, plain], prefs).map(r => r.id), [2, 1]);
});

test('"never show" wins over "avoid if possible" for the same ingredient', () => {
  const prefs = { allergies: [], skip_ingredients: ['olives'], avoid_ingredients: ['olive'] };
  assert.equal(checkRecipe(recipe(['olives']), prefs).allowed, false);
});

test('diet is enforced', () => {
  const prefs = { allergies: [], skip_ingredients: [], diet: 'vegetarian' };
  assert.equal(checkRecipe(recipe(['beef'], { diets: ['pescatarian'] }), prefs).allowed, false);
  assert.equal(checkRecipe(recipe(['beans'], { diets: ['vegetarian'] }), prefs).allowed, true);
});

test('filterRecipes removes every failing recipe', () => {
  const prefs = { allergies: ['peanut'], skip_ingredients: ['mushroom'] };
  const out = filterRecipes([
    { ...recipe(['peanut oil']), id: 1 }, { ...recipe(['mushrooms']), id: 2 }, { ...recipe(['rice']), id: 3 },
  ], prefs);
  assert.deepEqual(out.map(r => r.id), [3]);
});

test('a card with no ingredient list still honors the allergens column', () => {
  const r = { name: 'Satay', allergens: ['peanut'], diets: [] };
  assert.equal(checkRecipe(r, { allergies: ['peanut'], skip_ingredients: [] }).allowed, false);
  assert.equal(checkRecipe({ name: 'Rice' }, none).allowed, true);
});

test('replacement: the first passing, unused candidate', () => {
  const check = recipeChecker({ allergies: ['peanut'], skip_ingredients: [] });
  const pool = [{ ...recipe(['peanuts']), id: 1 }, { ...recipe(['rice']), id: 2 }, { ...recipe(['beans']), id: 3 }];
  assert.equal(pickReplacement(pool, check, new Set())?.id, 2);
  assert.equal(pickReplacement(pool, check, new Set([2]))?.id, 3);
  assert.equal(pickReplacement(pool, check, new Set([2, 3])), null);
});

test('replacement: gives up after the retry limit, so a slot can stay empty', () => {
  const check = recipeChecker({ allergies: ['peanut'], skip_ingredients: [] });
  const bad = Array.from({ length: REPLACEMENT_TRIES }, (_, i) => ({ ...recipe(['peanuts']), id: i + 1 }));
  assert.equal(pickReplacement(bad, check, new Set()), null);
  assert.equal(pickReplacement([...bad, { ...recipe(['rice']), id: 999 }], check, new Set()), null);
  assert.equal(pickReplacement([...bad.slice(1), { ...recipe(['rice']), id: 999 }], check, new Set())?.id, 999);
});
