// No path may hand the screen a recipe that contains a family member's allergen.
//
// Three layers, each tested here:
//   1. Every way the app gets recipes for the screen is a function of the gate
//      (src/lib/recipeGate.ts). The gate is run against a catalog full of allergens, with a
//      source that does no filtering of its own (as if the SQL filter had let everything
//      through), for every allergen, held by the household or by one person.
//   2. The planner (new week, daily update, repair of a saved plan) is run the same way.
//   3. The source code is read to prove the gate can't be bypassed: only one file queries
//      the recipes table, only the catalog imports it, and no screen or component imports
//      the unfiltered lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recipeGate, type BrowseQuery, type RecipeSource } from '../src/lib/recipeGate.ts';
import { allAllergies, allergyReminder, CHECK_INGREDIENTS, withFamilyAllergies } from '../src/lib/familyPrefs.ts';
import { buildTaste, emptyWeek, planWeek, repairPlan, updatePlan, type PlannerRecipe, type PlannerWeek, type Signals } from '../src/lib/planner.ts';
import { ALLERGENS, type Allergen } from '../supabase/functions/_shared/catalog/allergens.ts';
import { recipeChecker } from '../supabase/functions/_shared/catalog/recipeFilter.ts';

// ── A catalog where every allergen appears three ways ──────────────────────

const INGREDIENT: Record<Allergen, string> = {
  dairy: 'cheddar cheese', egg: 'egg', gluten: 'plain flour', peanut: 'peanut butter', tree_nut: 'walnut',
  soy: 'soy sauce', fish: 'salmon', shellfish: 'shrimp', sesame: 'sesame seeds',
};

let nextId = 1;
const recipe = (name: string, extra: Partial<PlannerRecipe> = {}): PlannerRecipe => ({
  id: nextId++, name, category: 'Chicken', area: 'Thai', ingredient_names: ['rice', 'carrot'], total_minutes: 30, meal_role: 'main', allergens: [], diets: [], ...extra,
});

const UNSAFE = new Map<Allergen, PlannerRecipe[]>(ALLERGENS.map(a => [a, [
  // Flagged in the allergens column and in the ingredients.
  recipe(`${a} flagged`, { allergens: [a], ingredient_names: ['rice', INGREDIENT[a]] }),
  // Only in the ingredients: the stored column is stale until the next catalog sync.
  recipe(`${a} unflagged`, { allergens: [], ingredient_names: ['rice', INGREDIENT[a]] }),
  // A breakfast, for the breakfast slots.
  recipe(`${a} breakfast`, { allergens: [a], ingredient_names: [INGREDIENT[a], 'banana'], meal_role: 'breakfast' }),
]]));
const SAFE_MAINS = Array.from({ length: 14 }, (_, i) => recipe(`Plain dinner ${i}`, { category: `Category ${i % 5}`, area: `Area ${i % 4}`, ingredient_names: ['rice', `vegetable ${i}`] }));
const SAFE_BREAKFASTS = [recipe('Fruit bowl', { meal_role: 'breakfast', ingredient_names: ['banana', 'apple'] })];
const CATALOG = [...[...UNSAFE.values()].flat(), ...SAFE_MAINS, ...SAFE_BREAKFASTS];
const byId = new Map(CATALOG.map(r => [r.id, r]));

test('the test catalog is what it claims: each unsafe recipe is caught by the filter, each safe one passes', () => {
  for (const [allergen, recipes] of UNSAFE) {
    const check = recipeChecker({ allergies: [allergen], skip_ingredients: [] });
    for (const r of recipes) assert.equal(check(r).allowed, false, r.name);
    for (const r of [...SAFE_MAINS, ...SAFE_BREAKFASTS]) assert.equal(check(r).allowed, true, r.name);
  }
});

/** A source that filters nothing, as if the SQL first pass had let everything through. */
const source: RecipeSource<PlannerRecipe> = {
  page: async ({ limit, offset }: BrowseQuery) => CATALOG.slice(offset, offset + limit),
  byRole: async (roles, limit) => CATALOG.filter(r => roles.includes(r.meal_role ?? '')).slice(0, limit),
  byIds: async ids => ids.flatMap(id => byId.get(id) ?? []),
  one: async id => byId.get(id) ?? null,
  sample: async limit => CATALOG.slice(0, limit),
};
const gate = recipeGate(source);

// ── Families: each allergen, held by the household or by one person ────────

interface Household { label: string; allergen: Allergen; prefs: { allergies: string[]; skip_ingredients: string[] } }
const household = { allergies: [] as string[], skip_ingredients: [] as string[] };
const FAMILIES: Household[] = ALLERGENS.flatMap(allergen => [
  { label: `${allergen} (household)`, allergen, prefs: { ...household, allergies: [allergen] } },
  { label: `${allergen} (one person)`, allergen, prefs: withFamilyAllergies(household, [{ allergies: [] }, { allergies: [allergen] }]) },
  { label: `${allergen} (a person, by ingredient name)`, allergen, prefs: withFamilyAllergies(household, [{ allergies: [INGREDIENT[allergen]] }]) },
]);

const assertSafe = (label: string, path: string, recipes: readonly PlannerRecipe[], allergen: Allergen) => {
  const unsafe = new Set(UNSAFE.get(allergen)!.map(r => r.id));
  for (const r of recipes) assert.ok(!unsafe.has(r.id), `${path} returned "${r.name}" for a family with ${label}`);
};

test("a person's allergies are added to the household's, and never dropped", () => {
  assert.deepEqual(allAllergies(['egg'], [{ allergies: ['peanut'] }, { allergies: ['Peanuts', 'tree nuts'] }]), ['egg', 'peanut', 'tree_nut']);
  const merged = withFamilyAllergies({ allergies: ['egg'], skip_ingredients: ['olive'], diet: 'none' }, [{ allergies: ['peanut'] }]);
  assert.deepEqual(merged, { allergies: ['egg', 'peanut'], skip_ingredients: ['olive'], diet: 'none' });
  const same = { allergies: ['egg'], skip_ingredients: [] };
  assert.equal(withFamilyAllergies(same, [{ allergies: [] }]), same, 'nobody with allergies: the household settings as they are');
});

test('gate: browse never returns an allergen, on any page', async () => {
  for (const f of FAMILIES) {
    for (let offset = 0; offset < CATALOG.length; offset += 7) {
      const page = await gate.browse({ filter: 'All', search: '', limit: 7, offset }, f.prefs);
      assertSafe(f.label, 'browse', page.recipes, f.allergen);
      assert.equal(page.fetched, Math.min(7, CATALOG.length - offset), 'paging counts rows before the filter');
    }
  }
});

test('gate: the pool for the planner and for swap options never contains an allergen', async () => {
  for (const f of FAMILIES) {
    assertSafe(f.label, 'pool(main, breakfast)', await gate.pool(['main', 'breakfast'], f.prefs), f.allergen);
    assertSafe(f.label, 'pool(main)', await gate.pool(['main'], f.prefs), f.allergen);
    assertSafe(f.label, 'pool(breakfast)', await gate.pool(['breakfast'], f.prefs), f.allergen);
  }
});

test('gate: saved recipes and results sent back by Suggestions or photo search are checked again', async () => {
  // The Edge Function "returns" every recipe in the catalog, allergens included.
  const everything = CATALOG.map(r => r.id);
  for (const f of FAMILIES) {
    const shown = await gate.cards(everything, f.prefs);
    assertSafe(f.label, 'cards', shown, f.allergen);
    assert.ok(shown.length > 0, 'the safe ones are still shown');
  }
  assert.deepEqual((await gate.cards([SAFE_MAINS[2].id, SAFE_MAINS[0].id, SAFE_MAINS[2].id, 999999], household)).map(r => r.id), [SAFE_MAINS[2].id, SAFE_MAINS[0].id], 'order kept, duplicates and unknown ids dropped');
});

test('gate: a recipe with an allergen cannot be opened, and says why', async () => {
  for (const f of FAMILIES) {
    for (const r of UNSAFE.get(f.allergen)!) {
      const opened = await gate.open(r.id, f.prefs);
      assert.equal(opened?.recipe, undefined, `${r.name} opened for a family with ${f.label}`);
      assert.ok(opened?.blockedBy?.length, 'the reason is given');
    }
    assert.equal((await gate.open(SAFE_MAINS[0].id, f.prefs))?.recipe, SAFE_MAINS[0]);
  }
  assert.equal(await gate.open(999999, household), null);
});

test('gate: the example week on the welcome panel is filtered too', async () => {
  for (const f of FAMILIES) assertSafe(f.label, 'sample', await gate.sample(CATALOG.length, f.prefs), f.allergen);
});

// ── The planner ────────────────────────────────────────────────────────────

const NOW = new Date('2026-11-18T19:30:00');
const planIds = (plan: PlannerWeek) => Object.values(plan).flatMap(d => Object.values(d)).flatMap(m => (m ? [m.id] : []));

/** A family that loved every unsafe recipe, to push as hard as taste can push. */
const lovesUnsafe = (allergen: Allergen): Signals => ({
  checkins: UNSAFE.get(allergen)!.flatMap(r => ['2026-10-20', '2026-11-03'].map(date => ({ recipeId: r.id, memberId: null, response: 'loved' as const, date }))),
  favorites: UNSAFE.get(allergen)!.map(r => r.id),
  ratings: UNSAFE.get(allergen)!.map(r => ({ recipeId: r.id, rating: 5 })),
  events: [], cooked: [],
});

test('planner: a new week never contains an allergen, however much the family loved it', () => {
  for (const f of FAMILIES) {
    const taste = buildTaste(lovesUnsafe(f.allergen), CATALOG, [], NOW);
    for (const seed of [1, 2, 3]) {
      const { plan } = planWeek({ candidates: CATALOG, taste, food: f.prefs, slots: ['breakfast', 'lunch', 'dinner'], maxWeeknightMinutes: null, seed });
      assertSafe(f.label, 'planWeek', planIds(plan).map(id => byId.get(id)!), f.allergen);
      assert.equal(planIds(plan).length, 21);
    }
  }
});

test('planner: the daily update never swaps an allergen in', () => {
  for (const f of FAMILIES) {
    const taste = buildTaste(lovesUnsafe(f.allergen), CATALOG, [], NOW);
    const plan = emptyWeek();
    (['thursday', 'friday', 'saturday', 'sunday'] as const).forEach((day, i) => { plan[day].dinner = { id: SAFE_MAINS[i].id, title: SAFE_MAINS[i].name, image: '' }; });
    const { plan: next } = updatePlan({ plan, days: ['thursday', 'friday', 'saturday', 'sunday'], candidates: CATALOG, taste, food: f.prefs, maxWeeknightMinutes: null });
    assertSafe(f.label, 'updatePlan', planIds(next).map(id => byId.get(id)!), f.allergen);
  }
});

test('planner: a saved plan with an allergen in it is repaired before it is shown, locked or not', () => {
  for (const f of FAMILIES) {
    const [flagged, unflagged, breakfast] = UNSAFE.get(f.allergen)!;
    const plan = emptyWeek();
    plan.monday.dinner = { id: flagged.id, title: flagged.name, image: '', locked: true };
    plan.tuesday.dinner = { id: unflagged.id, title: unflagged.name, image: '', chosen: true };
    plan.tuesday.breakfast = { id: breakfast.id, title: breakfast.name, image: '' };
    plan.wednesday.dinner = { id: SAFE_MAINS[0].id, title: SAFE_MAINS[0].name, image: '' };
    // The replacement options are unfiltered here too: repair must check them itself.
    const repaired = repairPlan(plan, byId, { mains: CATALOG.filter(r => r.meal_role === 'main'), breakfasts: CATALOG.filter(r => r.meal_role === 'breakfast') }, f.prefs);
    assert.equal(repaired.changed, true);
    assert.equal(repaired.replaced, 3);
    assertSafe(f.label, 'repairPlan', planIds(repaired.plan).map(id => byId.get(id)!), f.allergen);
    assert.equal(repaired.plan.wednesday.dinner?.id, SAFE_MAINS[0].id, 'safe meals are left alone');
  }
  const gone = emptyWeek();
  gone.monday.dinner = { id: 999999, title: 'Removed from the catalog', image: '' };
  const repaired = repairPlan(gone, byId, { mains: [], breakfasts: [] }, household);
  assert.equal(repaired.plan.monday.dinner, null, 'a recipe that cannot be checked is not shown');
  assert.deepEqual(repaired.blocked, ['monday:dinner']);
});

// ── The gate can't be bypassed ─────────────────────────────────────────────

const ROOT = join(import.meta.dirname, '..', 'src');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const FILES = sourceFiles(ROOT).map(path => ({ path: path.slice(ROOT.length + 1), text: readFileSync(path, 'utf8') }));
const without = (files: typeof FILES, ...allowed: string[]) => files.filter(f => !allowed.includes(f.path));

test('only recipeSource.ts reads the recipes table or the SQL recipe filter', () => {
  for (const f of without(FILES, 'lib/recipeSource.ts')) {
    assert.doesNotMatch(f.text, /from\(\s*['"`]recipes['"`]\s*\)/, `${f.path} queries the recipes table directly`);
    assert.doesNotMatch(f.text, /rpc\(\s*['"`](family_)?safe_recipes['"`]/, `${f.path} calls the SQL recipe filter directly`);
  }
  assert.match(FILES.find(f => f.path === 'lib/recipeSource.ts')!.text, /family_safe_recipes/);
});

test('only catalog.ts imports the raw source, and it wraps it in the gate', () => {
  for (const f of without(FILES, 'lib/catalog.ts')) {
    assert.doesNotMatch(f.text, /from\s+['"][^'"]*recipeSource['"]/, `${f.path} imports the raw recipe source`);
  }
  const catalog = FILES.find(f => f.path === 'lib/catalog.ts')!.text;
  assert.match(catalog, /recipeGate<RecipeCard, Recipe>\(supabaseRecipes\)/);
  assert.equal((catalog.match(/supabaseRecipes/g) ?? []).length, 2, 'the raw source is used once: to build the gate');
});

test('no screen or component uses the unfiltered lookup or builds its own gate', () => {
  const ui = FILES.filter(f => /^(screens|components|app)\//.test(f.path) || f.path === 'App.tsx');
  assert.ok(ui.length > 20);
  for (const f of ui) {
    assert.doesNotMatch(f.text, /\blookupCards\b/, `${f.path} uses the unfiltered lookup`);
    assert.doesNotMatch(f.text, /from\s+['"][^'"]*recipeGate['"]/, `${f.path} imports the gate directly instead of the catalog`);
  }
  const users = FILES.filter(f => /\blookupCards\b/.test(f.text)).map(f => f.path).sort();
  assert.deepEqual(users, ['lib/catalog.ts', 'lib/learning.ts', 'lib/plan.ts'], 'the unfiltered lookup is only used to check plans and read history');
});

test('every catalog function that hands recipes to a screen takes the family settings', () => {
  const catalog = FILES.find(f => f.path === 'lib/catalog.ts')!.text;
  for (const name of ['browseRecipes', 'getRecipe', 'safeCards', 'safeCardMap', 'planningPool', 'similarRecipes', 'previewRecipes', 'searchablePool']) {
    const declaration = catalog.match(new RegExp(`export (?:async )?(?:function|const) ${name}\\b[^\\n]*`))?.[0] ?? '';
    assert.match(declaration, /prefs: FoodPrefs/, `${name} must take the family's settings`);
  }
});

test('the saved plan has no way around the check', () => {
  const app = FILES.find(f => f.path === 'App.tsx')!.text;
  // Undo of an update re-checks the meals it puts back against today's settings.
  assert.match(app, /await enforcePlan\(undo\.plan, shownPrefs\)/, 'Undo must check the plan it restores');
  // A settings change retires an Undo that only holds meals.
  assert.match(app, /r\.undo && !r\.undo\.settings \? \{ \.\.\.r, undo: undefined \}/, 'a settings change must retire a meals-only Undo');
  // A check that fails does not mark the plan as checked.
  const effect = app.slice(app.indexOf('enforcePlan(current.plan, shownPrefs)'), app.indexOf('const undoPlanReview'));
  assert.doesNotMatch(effect, /finally/, 'a failed check must not end with the plan shown');
  assert.match(effect, /\.catch\(err => \{[^}]*setCheckAttempt/s, 'a failed check is retried');
  // The home screen draws a plan entry only when its recipe came back from the gate.
  const home = FILES.find(f => f.path === 'screens/MealPlan.tsx')!.text;
  assert.match(home, /const plan = shownPlan\(weekPlan\?\.plan \?\? emptyPlan\(\), cards\)/);
  assert.match(home, /out\[d\]\[s\] = entry && cards\.has\(entry\.id\) \? entry : null/);
});

// ── The reminder ───────────────────────────────────────────────────────────

test('wherever allergy filtering is shown, the user is told to check the ingredients', () => {
  assert.equal(allergyReminder(['peanut', 'tree_nut', 'mustard']), `Recipes with peanut, tree nut and mustard are hidden. ${CHECK_INGREDIENTS}`);
  assert.equal(allergyReminder(['egg']), `Recipes with egg are hidden. ${CHECK_INGREDIENTS}`);
  assert.equal(allergyReminder([]), null);
  const shows = (path: string) => /CHECK_INGREDIENTS|AllergyReminder|HiddenRecipe/.test(FILES.find(f => f.path === path)!.text);
  for (const path of [
    'components/PrefControls.tsx',    // the allergy picker: onboarding, Settings, each person
    'screens/BrowseRecipes.tsx', 'screens/SuggestionsPanel.tsx', 'screens/PhotoSearch.tsx', 'screens/Favorites.tsx',
    'screens/RecipeDetail.tsx', 'screens/CookingMode.tsx',
    'lib/plan.ts',                    // the note when a planned meal is replaced
  ]) assert.ok(shows(path), `${path} shows allergy filtering without the reminder`);
});
