// Unit tests for the preference autocomplete search (run with `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allergyOptions, buildIngredientIndex, dislikeOptions, exactOption, MAX_SUGGESTIONS, searchIngredients } from '../src/lib/ingredientSearch.ts';

const index = buildIngredientIndex([
  { name: 'tomatoes', name_us: 'Tomatoes' },
  { name: 'tomato', name_us: 'Tomato' },
  { name: 'cherry tomatoes', name_us: 'Cherry tomatoes' },
  { name: 'peanut butter', name_us: 'Peanut Butter' },
  { name: 'peanuts', name_us: 'Peanuts' },
  { name: 'aubergine', name_us: 'Eggplant' },
  { name: 'pepper', name_us: 'Pepper' },
  { name: 'red pepper', name_us: 'Red pepper' },
  { name: 'peppermint', name_us: 'Peppermint' },
  { name: 'sweet pepper', name_us: 'Sweet pepper' },
]);
const labels = (q: string, opts = index) => searchIngredients(opts, q).map(o => o.label);

test('index: deduplicated and normalized', () => {
  assert.equal(index.filter(o => o.value === 'tomato').length, 1);
  assert.deepEqual(index.find(o => o.value === 'peanut butter')?.label, 'Peanut butter');
});

test('search: prefix first, then later words, then inside a word', () => {
  assert.deepEqual(labels('pepper'), ['Pepper', 'Peppermint', 'Red pepper', 'Sweet pepper']);
  assert.deepEqual(labels('toma'), ['Tomato', 'Cherry tomato']);
  assert.deepEqual(labels('ermin'), ['Peppermint']);
});

test('search: plurals and half-typed plurals find the singular', () => {
  assert.deepEqual(labels('tomatoes'), ['Tomato', 'Cherry tomato']);
  assert.deepEqual(labels('peanuts'), ['Peanut', 'Peanut butter']);
});

test('search: finds an ingredient under its other name', () => {
  assert.deepEqual(labels('aubergine'), ['Eggplant']);
  assert.deepEqual(labels('Eggpl'), ['Eggplant']);
});

test('search: empty, none, and chosen items', () => {
  assert.deepEqual(labels(''), []);
  assert.deepEqual(labels('zzz'), []);
  assert.deepEqual(searchIngredients(index, 'peanut', ['peanut']).map(o => o.value), ['peanut butter']);
});

test('search: at most 8 suggestions', () => {
  const many = buildIngredientIndex(Array.from({ length: 30 }, (_, i) => ({ name: `salt ${'x'.repeat(i)}`, name_us: `salt ${'x'.repeat(i)}` })));
  assert.equal(searchIngredients(many, 'salt').length, MAX_SUGGESTIONS);
});

test('allergy search: families come before ingredients, even from a later word', () => {
  const all = allergyOptions(index);
  assert.equal(searchIngredients(all, 'pean')[0].value, 'peanut');
  // Listed once, as the family.
  assert.equal(searchIngredients(all, 'pean').filter(o => o.value === 'peanut').length, 1);
  assert.equal(searchIngredients(all, 'pean')[0].family, true);
  assert.equal(searchIngredients(all, 'nut')[0].family, true);
  assert.equal(searchIngredients(all, 'milk')[0].value, 'dairy');
  assert.equal(searchIngredients(all, 'wheat')[0].value, 'gluten');
  assert.equal(searchIngredients(all, 'tree')[0].value, 'tree_nut');
});

test('dislike search: group words are real options, single-ingredient families are not', () => {
  const all = dislikeOptions(index);
  assert.equal(searchIngredients(all, 'dairy')[0].value, 'dairy');
  assert.equal(searchIngredients(all, 'gluten')[0].value, 'gluten');
  assert.equal(exactOption(all, 'dairy')?.family, true);
  assert.equal(exactOption(all, 'tree_nut')?.label, 'Tree nut');
  // "Peanut" stays the ingredient.
  assert.equal(searchIngredients(all, 'pean')[0].family, undefined);
});

test('exact option: resolves what was typed to the saved value', () => {
  assert.equal(exactOption(index, 'Tomatoes')?.value, 'tomato');
  assert.equal(exactOption(index, 'aubergines')?.value, 'eggplant');
  assert.equal(exactOption(index, 'toma'), undefined);
});

test('a finished word in catalog names is a suggestion, half a word is not', () => {
  const olives = buildIngredientIndex([{ name: 'black olives', name_us: 'Black olives' }, { name: 'olive oil', name_us: 'Olive oil' }]);
  assert.equal(exactOption(olives, 'olives')?.value, 'olive');
  assert.equal(exactOption(olives, 'oliv'), undefined);
  assert.equal(searchIngredients(olives, 'olives')[0].value, 'olive');
  assert.deepEqual(searchIngredients(olives, 'oliv').map(o => o.value), ['olive oil', 'black olive']);
  assert.equal(searchIngredients(olives, 'olive', ['olive'])[0].value, 'olive oil');
});
