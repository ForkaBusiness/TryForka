// Busy-night swap: something clearly faster that adds the least to the shopping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyNightNote, fasterOptions, pickBusyNight, QUICK_MINUTES } from '../src/lib/busyNight.ts';
import type { PlannerRecipe } from '../src/lib/planner.ts';

let nextId = 1;
const recipe = (name: string, minutes: number | null, extra: Partial<PlannerRecipe> = {}): PlannerRecipe =>
  ({ id: nextId++, name, category: 'Chicken', area: 'Thai', ingredient_names: [], total_minutes: minutes, meal_role: 'main', allergens: [], diets: [], ...extra });

const stew = recipe('Beef stew', 150);
const tacos = recipe('Chicken tacos', 25);
const stirFry = recipe('Veg stir fry', 20);
const omelette = recipe('Omelette', 10, { meal_role: 'breakfast' });
const roast = recipe('Roast chicken', 145);
const curry = recipe('Quick curry', 35);
const untimed = recipe('Mystery bake', null);
const ALL = [stew, tacos, stirFry, omelette, roast, curry, untimed];

test('faster options are clearly faster mains that are not already in the week, fastest first', () => {
  assert.deepEqual(fasterOptions(stew, ALL, new Set()).map(r => r.name), ['Veg stir fry', 'Chicken tacos']);
  assert.deepEqual(fasterOptions(stew, ALL, new Set([stirFry.id])).map(r => r.name), ['Chicken tacos']);
  assert.deepEqual(fasterOptions(curry, ALL, new Set()).map(r => r.name), ['Veg stir fry', 'Chicken tacos'], 'ten minutes faster or more');
  assert.deepEqual(fasterOptions(stirFry, ALL, new Set()), [], 'nothing is faster than the quickest dinner');
});

test('when quick dinners exist, only they are considered; otherwise anything clearly faster', () => {
  const options = fasterOptions(roast, ALL, new Set());
  assert.ok(options.every(r => r.total_minutes! <= QUICK_MINUTES), 'a 35 minute curry is not offered while 20 and 25 minute dinners exist');
  const slowOnly = [roast, stew, recipe('Slow braise', 90), curry];
  assert.deepEqual(fasterOptions(stew, slowOnly, new Set()).map(r => r.name), ['Quick curry', 'Slow braise'], 'nothing under 30 minutes: the faster ones still count');
});

test('a dinner with no time on it is traded for a quick one', () => {
  const options = fasterOptions(untimed, ALL, new Set());
  assert.ok(options.length > 0);
  assert.ok(options.every(r => r.total_minutes! <= QUICK_MINUTES));
});

test('the pick adds the least to the shopping, then uses the most of the list, then is the quickest', () => {
  const onList = new Set(['chicken thigh', 'tortilla', 'lime', 'rice', 'bell pepper']);
  const picked = pickBusyNight([
    { recipe: stirFry, needs: ['tofu', 'bok choy', 'rice'] },                    // 2 to buy
    { recipe: tacos, needs: ['chicken thigh', 'tortilla', 'lime', 'avocado'] },  // 1 to buy
    { recipe: curry, needs: ['chicken thigh', 'coconut milk'] },                 // 1 to buy, uses less
  ], onList);
  assert.deepEqual(picked, { recipe: tacos, have: 3, needs: 4 });

  const tie = pickBusyNight([{ recipe: tacos, needs: ['lime'] }, { recipe: stirFry, needs: ['rice'] }], onList);
  assert.equal(tie?.recipe, stirFry, 'same shopping, same use of the list: the quicker one');
  const liked = pickBusyNight([{ recipe: tacos, needs: ['lime'], taste: 0 }, { recipe: recipe('Lime chicken', 25), needs: ['lime'], taste: 3 }], onList);
  assert.equal(liked?.recipe.name, 'Lime chicken', 'all else equal: the one the family likes more');
  assert.equal(pickBusyNight([], onList), null);
});

test('an ingredient listed twice counts once', () => {
  assert.deepEqual(pickBusyNight([{ recipe: tacos, needs: ['lime', 'lime', 'salsa'] }], new Set(['lime'])), { recipe: tacos, have: 1, needs: 2 });
});

test('the note says what it is, how long it takes and what is already on the list', () => {
  assert.equal(busyNightNote('tonight', { recipe: tacos, have: 3, needs: 4 }), 'Swapped tonight for a faster dinner: Chicken tacos. About 25 min, and 3 of its 4 ingredients are already on your list.');
  assert.equal(busyNightNote('Thursday', { recipe: tacos, have: 4, needs: 4 }), 'Swapped Thursday for a faster dinner: Chicken tacos. About 25 min, and everything it needs is already on your list.');
  assert.equal(busyNightNote('tonight', { recipe: tacos, have: 0, needs: 4 }), 'Swapped tonight for a faster dinner: Chicken tacos. About 25 min.');
});
