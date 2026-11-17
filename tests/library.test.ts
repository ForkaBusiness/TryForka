// The library: favorites and collections as one list, with search and filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inLibraryView, libraryEntries } from '../src/lib/library.ts';

const entries = libraryEntries([3, 1], [
  { collection_id: 'weeknight', recipe_id: 1 },
  { collection_id: 'weeknight', recipe_id: 2 },
  { collection_id: 'kids', recipe_id: 2 },
  { collection_id: 'kids', recipe_id: 2 },
]);
const recipes: Record<number, { title: string; area: string | null; category: string | null; total_minutes: number | null }> = {
  1: { title: 'Thai green curry', area: 'Thai', category: 'Chicken', total_minutes: 35 },
  2: { title: 'Mac and cheese', area: 'American', category: 'Pasta', total_minutes: 25 },
  3: { title: 'Crème brûlée', area: 'French', category: 'Dessert', total_minutes: null },
};
const view = (filter: string, search = '') => entries.filter(e => inLibraryView(e, recipes[e.id], filter, search)).map(e => e.id);

test('each saved recipe appears once, favorites first, with every collection it is in', () => {
  assert.deepEqual(entries, [
    { id: 3, favorite: true, collections: [] },
    { id: 1, favorite: true, collections: ['weeknight'] },
    { id: 2, favorite: false, collections: ['weeknight', 'kids'] },
  ]);
});

test('filters: all, favorites, quick, and a collection', () => {
  assert.deepEqual(view('all'), [3, 1, 2]);
  assert.deepEqual(view('favorites'), [3, 1]);
  assert.deepEqual(view('quick'), [2], 'a recipe with no time is not counted as quick');
  assert.deepEqual(view('weeknight'), [1, 2]);
  assert.deepEqual(view('kids'), [2]);
  assert.deepEqual(view('empty-collection'), []);
});

test('search finds every word, by name, cuisine or category, ignoring accents and case', () => {
  assert.deepEqual(view('all', 'thai'), [1]);
  assert.deepEqual(view('all', 'CHEESE mac'), [2]);
  assert.deepEqual(view('all', 'creme'), [3]);
  assert.deepEqual(view('all', 'pasta'), [2]);
  assert.deepEqual(view('all', 'gre cur'), [1], 'words can be started, not finished');
  assert.deepEqual(view('favorites', 'cheese'), [], 'search and filter together');
  assert.deepEqual(view('all', '   '), [3, 1, 2]);
});
