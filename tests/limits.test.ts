// Plans and limits: the helper future features and the paywall will ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLimit, FREE_AND_UNUSED, LIMIT_KINDS, PLAN_LIMITS, savedRecipeCount } from '../src/lib/limits.ts';
import { readFileSync } from 'node:fs';

test('the free limits are 20 saved recipes, 20 smart imports and 2 saved shopping lists at a time', () => {
  assert.deepEqual(PLAN_LIMITS.free, { saved_recipes: 20, smart_imports: 20, shopping_lists: 2 });
  for (const kind of LIMIT_KINDS) assert.equal(PLAN_LIMITS.pro[kind], Infinity);
});

test('free: allowed up to the limit, not past it', () => {
  const usage = { ...FREE_AND_UNUSED, saved_recipes: 19, shopping_lists: 2 };
  assert.deepEqual(checkLimit(usage, 'saved_recipes'), { allowed: true, used: 19, limit: 20, remaining: 1 });
  assert.equal(checkLimit({ ...usage, saved_recipes: 20 }, 'saved_recipes').allowed, false);
  assert.deepEqual(checkLimit(usage, 'shopping_lists'), { allowed: false, used: 2, limit: 2, remaining: 0 });
  assert.equal(checkLimit(usage, 'smart_imports').allowed, true);
  assert.equal(checkLimit(usage, 'saved_recipes', 2).allowed, false, 'adding two at once counts both');
  assert.equal(checkLimit({ ...usage, saved_recipes: 25 }, 'saved_recipes').remaining, 0, 'over the limit (saved before limits existed) is 0 left, not negative');
});

test('pro: never limited', () => {
  const pro = { plan: 'pro' as const, saved_recipes: 5000, smart_imports: 5000, shopping_lists: 5000 };
  for (const kind of LIMIT_KINDS) {
    const result = checkLimit(pro, kind, 100);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, Infinity);
  }
});

test('an unknown plan or a missing count is treated safely as free and zero', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data from the database could be anything
  const odd = { plan: 'enterprise', saved_recipes: undefined } as any;
  assert.deepEqual(checkLimit(odd, 'saved_recipes'), { allowed: true, used: 0, limit: 20, remaining: 20 });
});

test('saved recipes are hearted or in a collection, each once; planned catalog recipes never count', () => {
  assert.equal(savedRecipeCount([1, 2, 3], [{ recipe_id: 3 }, { recipe_id: 4 }, { recipe_id: 4 }]), 4);
  assert.equal(savedRecipeCount([], []), 0);
  // The count takes no plan at all, in the app and in the database.
  const sql = readFileSync(new URL('../supabase/migrations/20261116000004_plans_and_limits.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  const summary = sql.slice(sql.indexOf('function public.usage_summary'));
  assert.doesNotMatch(summary, /week_plans|grocery_lists/, 'usage_summary must not read the week plan or the weekly list');
});

test('the weekly grocery list is never counted as a shopping list', () => {
  const groceries = readFileSync(new URL('../src/lib/groceries.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(groceries, /recordUsage/);
  const sql = readFileSync(new URL('../supabase/migrations/20261116000004_plans_and_limits.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /shopping_lists_count|shopping_list_week/, 'nothing stores a shopping-list count');
});

test("the household's own recipes count as saved recipes, each once", async () => {
  const { savedRecipeCount, checkLimit } = await import('../src/lib/limits.ts');
  assert.equal(savedRecipeCount([5, 1_000_000_001], [{ recipe_id: 1_000_000_001 }, { recipe_id: 9 }], [1_000_000_001, 1_000_000_002]), 4);
  const usage = { plan: 'free' as const, saved_recipes: savedRecipeCount([], [], Array.from({ length: 20 }, (_, i) => 1_000_000_000 + i)), smart_imports: 0, shopping_lists: 0 };
  assert.equal(checkLimit(usage, 'saved_recipes').allowed, false, 'twenty imported recipes reach the free limit (counted, not blocked yet)');
});

test('which import answers count as a smart import', async () => {
  const { countsAsImport } = await import('../supabase/functions/_shared/imports/pipeline.ts');
  assert.deepEqual(['ok', 'partial', 'no_recipe', 'failed', 'duplicate', 'capped'].map(countsAsImport), [true, true, false, false, false, false]);
});
