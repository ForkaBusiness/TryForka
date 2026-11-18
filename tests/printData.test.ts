// The printed and PDF recipe: scaled amounts in the family's units, and the right credit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfName, printData } from '../src/lib/printData.ts';
import { draftToRow } from '../supabase/functions/_shared/imports/structure.ts';
import { parseIngredientLine } from '../supabase/functions/_shared/imports/ingredientLine.ts';
import { emptyDraft } from '../supabase/functions/_shared/imports/draft.ts';

const row = (over = {}) => ({ ...draftToRow({ ...emptyDraft('website'), title: 'Lentil soup', servings: 4, prep_minutes: 10, cook_minutes: 35,
  ingredients: ['1 cup red lentils', '200 g carrots', 'Salt, to taste'].map(parseIngredientLine), steps: ['Simmer at 180C for 30 minutes.'], notes: 'Freezes well.',
  source: { kind: 'website', url: 'https://soupblog.example/lentil-soup', site_name: 'Soup Blog', platform: null, handle: null } }), owner_id: 'u1', ...over });

test('print data: facts, scaled amounts, units and the source credit', () => {
  const d = printData(row(), 8, 'us');
  assert.equal(d.title, 'Lentil soup');
  assert.deepEqual(d.facts, ['Serves 8', 'Prep 10 min', 'Cook 35 min']);
  assert.deepEqual(d.ingredients, [{ amount: '2 cups', name: 'Red lentils' }, { amount: '14 oz', name: 'Carrots' }, { amount: '', name: 'Salt, to taste' }]);
  assert.deepEqual(d.steps, ['Simmer at 350°F for 30 minutes.']);
  assert.equal(d.notes, 'Freezes well.');
  assert.equal(d.credit, 'From Soup Blog');
  assert.equal(d.creditUrl, 'https://soupblog.example/lentil-soup');
  assert.equal(printData(row(), 4, 'metric').ingredients[1].amount, '200 g');
});

test('print data: social credit, catalog credit, and no source', () => {
  assert.equal(printData(row({ source_kind: 'social', source_platform: 'tiktok', source_handle: 'cookwithmaya' }), 4, 'us').credit, 'From @cookwithmaya on TikTok');
  const catalog = printData(row({ owner_id: null, servings: null, notes: 'x', source_url: null }), 4, 'us');
  assert.equal(catalog.credit, 'Recipe from TheMealDB');
  assert.equal(catalog.notes, null);
  assert.equal(printData(row({ source_url: null, source_name: null, source_kind: 'manual' }), 4, 'us').credit, 'A family recipe, saved in Forka');
  assert.equal(pdfName("Nana's Banana Bread!"), 'nana-s-banana-bread.pdf');
});
