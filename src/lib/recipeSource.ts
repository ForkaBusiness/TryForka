import { supabase } from './supabase';
import type { Recipe, RecipeCard } from './catalog';
import type { BrowseQuery, RecipeSource } from './recipeGate';
import type { MergeIngredient } from './groceryMerge';

// Raw reads of the recipe catalog in Supabase. This is the only file that queries the
// recipes table or the per-user SQL filter, and only catalog.ts imports it: everything
// here goes to the screen through the gate (recipeGate.ts), never directly.
// tests/allergyPaths.test.ts checks both of those rules.

export const CARD_COLUMNS = 'id, name, display_name, subtitle, category, area, thumb_url, total_minutes, meal_role, allergens, diets, ingredient_names';
const RECIPE_COLUMNS = `${CARD_COLUMNS}, steps, ingredients, tags, source_url, youtube_url`;

export const BROWSE_FILTERS = ['All', 'Vegetarian', 'Vegan', 'Chicken', 'Beef', 'Seafood', 'Pasta', 'Breakfast'] as const;
export type BrowseFilter = typeof BROWSE_FILTERS[number];

const PASTA_NAMES = ['pasta', 'spaghetti', 'lasagn', 'penne', 'linguine', 'fettuccine', 'tagliatelle', 'macaroni', 'ravioli', 'gnocchi', 'rigatoni', 'carbonara', 'orzo'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder types differ between rpc() and from()
type Query = any;

function applyFilter(q: Query, filter: string): Query {
  switch (filter) {
    case 'Breakfast': return q.eq('meal_role', 'breakfast');
    case 'Vegetarian': return q.eq('meal_role', 'main').contains('diets', ['vegetarian']);
    case 'Vegan': return q.eq('meal_role', 'main').contains('diets', ['vegan']);
    case 'Chicken': case 'Beef': case 'Seafood': return q.eq('meal_role', 'main').eq('category', filter);
    case 'Pasta': return q.eq('meal_role', 'main').or(['category.eq.Pasta', ...PASTA_NAMES.map(p => `name.ilike.*${p}*`)].join(','));
    default: return q.in('meal_role', ['main', 'breakfast']);
  }
}

const cleanSearch = (s: string) => s.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim();

// The SQL first pass. family_safe_recipes() counts every person's allergies; a database
// that doesn't have it yet still has safe_recipes() (household allergies only). Either
// way the gate runs the full filter on what comes back, so the fallback is slower to
// narrow, not less safe.
let safeFunction: 'family_safe_recipes' | 'safe_recipes' = 'family_safe_recipes';
const missingFunction = (error: { code?: string; message?: string }) => error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');

async function safeRecipes(build: (q: Query) => Query, options?: { head: true; count: 'exact' }): Promise<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  // Read once: several requests can be in flight when the first of them finds the function missing.
  const called = safeFunction;
  let result = await build(supabase.rpc(called, {}, options));
  // A count-only request has no body to carry the error code, so "not found" is read from the status.
  if (result.error && called === 'family_safe_recipes' && (missingFunction(result.error) || result.status === 404)) {
    safeFunction = 'safe_recipes';
    result = await build(supabase.rpc(safeFunction, {}, options));
  }
  return result;
}

const rows = <T,>({ data, error }: { data: unknown; error: { message: string } | null }): T[] => {
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
};

export const supabaseRecipes: RecipeSource<RecipeCard, Recipe> = {
  async page({ filter, search, limit, offset }: BrowseQuery) {
    const term = cleanSearch(search);
    return rows<RecipeCard>(await safeRecipes(q => {
      let query = applyFilter(q.select(CARD_COLUMNS), filter);
      if (term) query = query.or(['display_name', 'name', 'area', 'category', 'subtitle'].map(c => `${c}.ilike.*${term}*`).join(','));
      return query.order('display_name', { ascending: true }).range(offset, offset + limit - 1);
    }));
  },
  async byRole(roles, limit) {
    return rows<RecipeCard>(await safeRecipes(q => q.select(CARD_COLUMNS).in('meal_role', [...roles]).limit(limit)));
  },
  async byIds(ids) {
    return rows<RecipeCard>(await supabase.from('recipes').select(CARD_COLUMNS).in('id', [...ids]));
  },
  async one(id) {
    const { data, error } = await supabase.from('recipes').select(RECIPE_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Recipe | null;
  },
  async sample(limit) {
    return rows<RecipeCard>(await supabase.from('recipes').select(CARD_COLUMNS).eq('meal_role', 'main').not('thumb_url', 'is', null).order('id').limit(limit));
  },
};

/** How many recipes the SQL filter leaves under a browse filter (for hiding empty filter chips). */
export async function countByFilter(filter: BrowseFilter): Promise<number> {
  const { count } = await safeRecipes(q => applyFilter(q, filter), { head: true, count: 'exact' });
  return count ?? 0;
}

export interface RecipeIngredients { id: number; name: string; display_name: string | null; ingredients: MergeIngredient[] }

/** The ingredient lists of planned recipes, for the grocery list. Not for display as recipes. */
export async function ingredientsOf(ids: readonly number[]): Promise<RecipeIngredients[]> {
  return rows<RecipeIngredients>(await supabase.from('recipes').select('id, name, display_name, ingredients').in('id', [...ids]));
}
