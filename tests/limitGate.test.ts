// Free limits, enforced: only adding past a limit is stopped; what a household has stays
// visible and usable, even over the limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addsSavedRecipe, gate, slotAllowed, SLOTS_FOR } from '../src/lib/limitGate.ts';
import { FREE_AND_UNUSED, PLAN_LIMITS, type Usage } from '../src/lib/limits.ts';
import { FREE_HELP_PER_DAY, FREE_LIMITS } from '../supabase/functions/_shared/billing/limits.ts';

const free = (u: Partial<Usage>): Usage => ({ ...FREE_AND_UNUSED, ...u });

test('limits: the free limits are 20 saved recipes, 20 smart imports, 2 saved lists, a few help answers a day', () => {
  assert.deepEqual(FREE_LIMITS, { saved_recipes: 20, smart_imports: 20, shopping_lists: 2 });
  assert.deepEqual(PLAN_LIMITS.free, { saved_recipes: 20, smart_imports: 20, shopping_lists: 2 });
  assert.equal(FREE_HELP_PER_DAY, 3);
});

test('limits: adding is allowed up to the limit and stopped at it, with the upgrade sheet', () => {
  assert.deepEqual(gate(free({ saved_recipes: 19 }), 'saved_recipes', 'add'), { allowed: true, upgrade: false });
  assert.deepEqual(gate(free({ saved_recipes: 20 }), 'saved_recipes', 'add'), { allowed: false, upgrade: true });
  assert.deepEqual(gate(free({ smart_imports: 20 }), 'smart_imports', 'add'), { allowed: false, upgrade: true });
  assert.deepEqual(gate(free({ shopping_lists: 1 }), 'shopping_lists', 'add'), { allowed: true, upgrade: false });
  assert.deepEqual(gate(free({ shopping_lists: 2 }), 'shopping_lists', 'add'), { allowed: false, upgrade: true });
});

test('limits: over the limit, everything already there stays usable; only adding more is stopped', () => {
  // A Pro plan that lapsed with 31 saved recipes and 40 imports.
  const lapsed = free({ saved_recipes: 31, smart_imports: 40, shopping_lists: 5 });
  for (const kind of ['saved_recipes', 'smart_imports', 'shopping_lists'] as const) {
    for (const action of ['view', 'use', 'remove'] as const) assert.deepEqual(gate(lapsed, kind, action), { allowed: true, upgrade: false }, `${kind} ${action}`);
    assert.equal(gate(lapsed, kind, 'add').allowed, false, `${kind} add`);
  }
  // Unsaving down below the limit makes room again.
  assert.equal(gate(free({ saved_recipes: 19 }), 'saved_recipes', 'add').allowed, true);
});

test('limits: Pro has no limits', () => {
  const pro: Usage = { plan: 'pro', saved_recipes: 500, smart_imports: 300, shopping_lists: 50 };
  for (const kind of ['saved_recipes', 'smart_imports', 'shopping_lists'] as const) assert.equal(gate(pro, kind, 'add').allowed, true);
});

test('limits: putting a saved recipe in another collection does not count again', () => {
  assert.equal(addsSavedRecipe(7, new Set([7, 8])), 0);
  assert.equal(addsSavedRecipe(9, new Set([7, 8])), 1);
  assert.equal(gate(free({ saved_recipes: 20 }), 'saved_recipes', 'add', addsSavedRecipe(7, new Set([7]))).allowed, true);
});

test('meals: Free plans dinners, Pro plans the whole week', () => {
  assert.deepEqual(SLOTS_FOR.free, ['dinner']);
  assert.equal(slotAllowed('free', 'dinner'), true);
  for (const s of ['breakfast', 'lunch', 'school_lunch', 'snack'] as const) {
    assert.equal(slotAllowed('free', s), false, s);
    assert.equal(slotAllowed('pro', s), true, s);
  }
});
