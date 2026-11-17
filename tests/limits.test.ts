// Plans and limits: the helper future features and the paywall will ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLimit, FREE_AND_UNUSED, LIMIT_KINDS, PLAN_LIMITS } from '../src/lib/limits.ts';

test('the free limits are 20 saved recipes, 20 smart imports and 2 shopping lists', () => {
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
