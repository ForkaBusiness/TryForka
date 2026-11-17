// Find recipes by ingredient: what counts as using an ingredient, and the ranking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecipes, usesIngredient } from '../src/lib/ingredientMatch.ts';

test('an ingredient matches by whole words, and a product named after it does not count', () => {
  assert.ok(usesIngredient('Chicken thighs', 'chicken'));
  assert.ok(usesIngredient('Basmati rice', 'rice'));
  assert.ok(usesIngredient('Eggs', 'egg'));
  assert.ok(usesIngredient('Red onions', 'onion'));
  assert.ok(!usesIngredient('Eggplant', 'egg'), 'egg is not eggplant');
  assert.ok(!usesIngredient('Chicken stock', 'chicken'), 'stock is not chicken');
  assert.ok(!usesIngredient('Rice vinegar', 'rice'));
  assert.ok(!usesIngredient('Garlic powder', 'garlic'));
  assert.ok(usesIngredient('Chicken stock', 'chicken stock'), 'unless that is what they have');
  assert.ok(usesIngredient('Coconut milk', 'coconut milk'));
  assert.ok(!usesIngredient('Green onions', 'onion'), 'green onions are another vegetable');
  assert.ok(!usesIngredient('Sweet potatoes', 'potato'));
  assert.ok(usesIngredient('Green onions', 'green onion'));
});

const recipes = [
  { id: 1, name: 'Chicken fried rice', ingredients: ['Chicken breast', 'Rice', 'Eggs', 'Soy sauce', 'Green onion', 'Vegetable oil', 'Salt'] },
  { id: 2, name: 'Chicken soup', ingredients: ['Chicken thighs', 'Carrots', 'Celery', 'Onion', 'Chicken stock', 'Salt', 'Water'] },
  { id: 3, name: 'Egg fried rice', ingredients: ['Rice', 'Eggs', 'Soy sauce', 'Peas'] },
  { id: 4, name: 'Rice pudding', ingredients: ['Rice', 'Milk', 'Sugar', 'Cinnamon'] },
  { id: 5, name: 'Beef stew', ingredients: ['Beef', 'Carrots', 'Potatoes', 'Beef stock'] },
];
const run = (haves: string[]) => matchRecipes(recipes, r => r.ingredients, haves);

test('ranked by how many of their ingredients a recipe uses, then by how little is left to buy', () => {
  const results = run(['chicken', 'rice', 'egg']);
  assert.deepEqual(results.map(r => [r.recipe.name, r.uses]), [
    ['Chicken fried rice', 3],
    ['Egg fried rice', 2],
    ['Rice pudding', 1],
    ['Chicken soup', 1],
  ]);
  assert.ok(!results.some(r => r.recipe.name === 'Beef stew'), 'a recipe that uses none of them is not a result');
});

test('each result says what it uses and what it still needs, without staples', () => {
  const [first] = run(['chicken', 'rice', 'egg']);
  assert.deepEqual(first.have, ['Chicken breast', 'Rice', 'Eggs']);
  assert.deepEqual(first.missing, ['Soy sauce', 'Green onion'], 'salt and oil are not "missing"');
  const soup = run(['chicken']).find(r => r.recipe.name === 'Chicken soup')!;
  assert.deepEqual(soup.have, ['Chicken thighs']);
  assert.ok(soup.missing.includes('Chicken stock'), 'the stock is still something to buy');
});

test('nothing typed, nothing found; typing the same thing twice counts once', () => {
  assert.deepEqual(run([]), []);
  assert.deepEqual(run(['  ']), []);
  assert.equal(run(['rice', 'Rice', 'rices'])[0].uses, 1);
});

test('a search over a full catalog is fast', () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `R${i}`, ingredients: [`thing ${i % 300}`, 'onion', 'garlic', `spice ${i % 40}`, 'rice', 'tomato', 'salt', 'olive oil'] }));
  matchRecipes(big, r => r.ingredients, ['onion']); // warm up
  const start = performance.now();
  for (let i = 0; i < 10; i++) matchRecipes(big, r => r.ingredients, ['onion', 'thing 5', 'tomato']);
  // About 40 ms on a laptop for four times the real catalog; generous so a busy test run doesn't fail it.
  assert.ok((performance.now() - start) / 10 < 250, 'well under the time it takes to type a letter');
});
