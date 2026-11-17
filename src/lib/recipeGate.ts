// The gate: the one filter every recipe passes on its way to the screen. Browse, swap
// options, Suggestions and photo results, favorites, collections, the planner's pool and
// a recipe opened on its own all come through here, and each of them runs the recipe
// filter (recipeFilter.ts) with the family's settings: the household's diet, allergies
// and skipped ingredients, plus each person's allergies.
//
// Pure: it reads recipes through a RecipeSource it is handed. The app hands it Supabase
// (recipeSource.ts); tests/allergyPaths.test.ts hands it a catalog full of allergens and
// checks that nothing gets through.

import { filterRecipes, recipeChecker, type FilterableRecipe, type FoodPrefs } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';

export interface GateCard extends FilterableRecipe { id: number; meal_role?: string | null }

export interface BrowseQuery { filter: string; search: string; limit: number; offset: number }

/**
 * Raw reads from the catalog. `page` and `byRole` come from the per-user SQL filter, a
 * coarse first pass; `byIds` and `one` are not filtered at all. Nothing but the gate may
 * show what these return.
 */
export interface RecipeSource<C extends GateCard, R extends C = C> {
  page(query: BrowseQuery): Promise<C[]>;
  byRole(roles: readonly string[], limit: number): Promise<C[]>;
  byIds(ids: readonly number[]): Promise<C[]>;
  one(id: number): Promise<R | null>;
  sample(limit: number): Promise<C[]>;
}

export type Opened<R> = { recipe: R; blockedBy?: undefined } | { recipe?: undefined; blockedBy: string[] };

export function recipeGate<C extends GateCard, R extends C = C>(source: RecipeSource<C, R>) {
  const byIds = async (ids: readonly number[]): Promise<Map<number, C>> => {
    const unique = [...new Set(ids)].filter(Boolean);
    return new Map((unique.length ? await source.byIds(unique) : []).map(r => [r.id, r]));
  };
  return {
    /** A page of the catalog. `fetched` is how many rows the page held before the filter, for paging. */
    async browse(query: BrowseQuery, prefs: FoodPrefs): Promise<{ recipes: C[]; fetched: number }> {
      const rows = await source.page(query);
      return { recipes: filterRecipes(rows, prefs), fetched: rows.length };
    },
    /** Every recipe of these kinds the family may eat ("avoid if possible" last). */
    async pool(roles: readonly string[], prefs: FoodPrefs, limit = 1000): Promise<C[]> {
      return filterRecipes(await source.byRole(roles, limit), prefs);
    },
    /** These recipes, in the order asked for, without the ones the family can't eat. */
    async cards(ids: readonly number[], prefs: FoodPrefs): Promise<C[]> {
      const found = await byIds(ids);
      return filterRecipes([...new Set(ids)].flatMap(id => found.get(id) ?? []), prefs);
    },
    /** One recipe to open, or why it can't be shown. Null when it doesn't exist. */
    async open(id: number, prefs: FoodPrefs): Promise<Opened<R> | null> {
      const recipe = await source.one(id);
      if (!recipe) return null;
      const verdict = recipeChecker(prefs)(recipe);
      return verdict.allowed ? { recipe } : { blockedBy: verdict.blockedBy };
    },
    /** A few recipes for the welcome panel's example week. */
    async sample(limit: number, prefs: FoodPrefs): Promise<C[]> {
      return filterRecipes(await source.sample(limit), prefs);
    },
    /**
     * Recipes by id, NOT filtered. Only for code that decides what to do with a recipe the
     * family already holds and never shows it as is: checking a saved plan, reading the
     * family's history. Screens must not use this.
     */
    lookup: byIds,
  };
}
