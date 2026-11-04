import { supabase } from './supabase';
import type { RecipeIngredient, RecipeStep } from '../../supabase/functions/_shared/catalog/derive.ts';
import type { StepTimer } from '../../supabase/functions/_shared/catalog/steps.ts';
import type { Allergen, Diet } from '../../supabase/functions/_shared/catalog/allergens.ts';
import { buildIngredientIndex, type IngredientOption } from './ingredientSearch';
import { filterRecipes, recipeChecker, type FoodPrefs } from './recipeFilter';

// The recipe catalog in Supabase (synced from TheMealDB by the sync-recipes function).
// Lists always go through safe_recipes(), which applies the signed-in user's allergies,
// diet and skipped ingredients in SQL. Single recipes are read from the table directly so
// a saved recipe still opens (with its allergens flagged) after the user's settings change.
// safe_recipes() is the coarse first pass; screens then run lists through the recipe filter.

export type { RecipeIngredient, RecipeStep, StepTimer };
export type MealRole = 'breakfast' | 'main' | 'side' | 'dessert' | 'condiment' | 'drink';

export interface RecipeCard {
  id: number;
  name: string;
  display_name: string | null;
  subtitle: string | null;
  category: string | null;
  area: string | null;
  thumb_url: string | null;
  total_minutes: number | null;
  meal_role: MealRole | null;
  allergens: Allergen[];
  diets: Diet[];
  ingredient_names: string[];
}

export interface Recipe extends RecipeCard {
  steps: RecipeStep[];
  ingredients: RecipeIngredient[];
  tags: string[];
  source_url: string | null;
  youtube_url: string | null;
}

export const CARD_COLUMNS = 'id, name, display_name, subtitle, category, area, thumb_url, total_minutes, meal_role, allergens, diets, ingredient_names';
const RECIPE_COLUMNS = `${CARD_COLUMNS}, steps, ingredients, tags, source_url, youtube_url`;

export const recipeTitle = (r: Pick<RecipeCard, 'name' | 'display_name'>) => r.display_name || r.name;

/** TheMealDB serves /small (~250px), /medium (~500px) and /large previews of each photo. */
export function photo(url: string | null | undefined, size: 'small' | 'medium' | 'large' | 'full' = 'medium'): string {
  if (!url) return '';
  return size === 'full' ? url : `${url}/${size}`;
}

/** "Spanish, vegetarian" style meta text from cuisine and diet. */
export function recipeMeta(r: Pick<RecipeCard, 'area' | 'diets' | 'category'>): string {
  const diet = r.diets.includes('vegan') ? 'vegan' : r.diets.includes('vegetarian') ? 'vegetarian' : '';
  const area = r.area && r.area !== 'Unknown' ? r.area : '';
  return [area, diet].filter(Boolean).join(', ').replace(/^./, c => c.toUpperCase());
}

export const minutesLabel = (m: number | null | undefined) => (m ? (m >= 90 ? `About ${+(m / 60).toFixed(1)} hr` : `About ${m} min`) : '');

// ── Browse filters ─────────────────────────────────────────────────────────

export const BROWSE_FILTERS = ['All', 'Vegetarian', 'Vegan', 'Chicken', 'Beef', 'Seafood', 'Pasta', 'Breakfast'] as const;
export type BrowseFilter = typeof BROWSE_FILTERS[number];

const PASTA_NAMES = ['pasta', 'spaghetti', 'lasagn', 'penne', 'linguine', 'fettuccine', 'tagliatelle', 'macaroni', 'ravioli', 'gnocchi', 'rigatoni', 'carbonara', 'orzo'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder types differ between rpc() and from()
type Query = any;

function applyFilter(q: Query, filter: BrowseFilter): Query {
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

export async function browseRecipes(opts: { filter: BrowseFilter; search?: string; limit?: number; offset?: number }): Promise<RecipeCard[]> {
  let q = applyFilter(supabase.rpc('safe_recipes').select(CARD_COLUMNS), opts.filter);
  const term = cleanSearch(opts.search ?? '');
  if (term) {
    q = q.or(['display_name', 'name', 'area', 'category', 'subtitle'].map(c => `${c}.ilike.*${term}*`).join(','));
  }
  const limit = opts.limit ?? 48;
  const offset = opts.offset ?? 0;
  const { data, error } = await q.order('display_name', { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as RecipeCard[];
}

/** Which browse filters have any recipes for this user (e.g. no Chicken for vegetarians). */
export async function availableFilters(): Promise<BrowseFilter[]> {
  const counts = await Promise.all(BROWSE_FILTERS.map(async f => {
    const { count } = await applyFilter(supabase.rpc('safe_recipes', {}, { head: true, count: 'exact' }), f);
    return [f, count ?? 0] as const;
  }));
  return counts.filter(([f, n]) => f === 'All' || n > 0).map(([f]) => f);
}

export async function getRecipe(id: number): Promise<Recipe | null> {
  const { data, error } = await supabase.from('recipes').select(RECIPE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Recipe | null;
}

/** Cards for these ids, in no particular order (not filtered: used for saved plans and favorites). */
export async function getCards(ids: number[]): Promise<Map<number, RecipeCard>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('recipes').select(CARD_COLUMNS).in('id', unique);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as RecipeCard[]).map(r => [r.id, r]));
}

/** Re-checks recipes an Edge Function returned, against the catalog itself. Keeps the order, "avoid" items last. */
export async function recheckRecipes(ids: number[], prefs: FoodPrefs): Promise<RecipeCard[]> {
  const cards = await getCards(ids);
  return filterRecipes(ids.flatMap(id => cards.get(id) ?? []), prefs);
}

/** Safe alternatives for a slot: same role, same category or cuisine first, "avoid" items last. */
export async function similarRecipes(base: RecipeCard | null, role: 'breakfast' | 'main', exclude: number[], prefs: FoodPrefs, count = 8): Promise<RecipeCard[]> {
  const { data, error } = await supabase.rpc('safe_recipes').select(CARD_COLUMNS).eq('meal_role', role).limit(400);
  if (error) throw new Error(error.message);
  const skip = new Set(exclude);
  const check = recipeChecker(prefs);
  const pool = filterRecipes((data ?? []) as RecipeCard[], prefs).filter(r => !skip.has(r.id));
  const score = (r: RecipeCard) => (base && r.category === base.category ? 2 : 0) + (base && r.area === base.area ? 1 : 0) + Math.random() - (check(r).avoids.length ? 10 : 0);
  return pool.sort((a, b) => score(b) - score(a)).slice(0, count);
}

/** Three dinner photos for the signed-out preview panel; the same ones all day. */
export async function previewRecipes(): Promise<RecipeCard[]> {
  const { data } = await supabase.from('recipes').select(CARD_COLUMNS).eq('meal_role', 'main').not('thumb_url', 'is', null).order('id').limit(120);
  const rows = (data ?? []) as RecipeCard[];
  if (rows.length < 3) return rows;
  const day = Math.floor(Date.now() / 86_400_000);
  return [0, 1, 2].map(i => rows[(day * 7 + i * 37) % rows.length]);
}

/** Grocery aisle per lowercased ingredient name. */
export async function ingredientAisles(names: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(names.map(n => n.toLowerCase()))];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase.from('ingredient_meta').select('name, aisle').in('name', unique.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) out.set(row.name as string, row.aisle as string);
  }
  return out;
}

let ingredients: Promise<IngredientOption[]> | null = null;

/** Every ingredient in the catalog, for the preference inputs. Built once per session. */
export function ingredientIndex(): Promise<IngredientOption[]> {
  ingredients ??= (async () => {
    const rows: Array<{ name: string; name_us: string }> = [];
    for (let from = 0, page = 1000; ; from += page) {
      const { data, error } = await supabase.from('ingredient_meta').select('name, name_us').order('name').range(from, from + page - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if ((data ?? []).length < page) return buildIngredientIndex(rows);
    }
  })().catch(err => { ingredients = null; throw err; });
  return ingredients;
}

/** TheMealDB's ingredient photo. */
export const ingredientPhoto = (name: string) => `https://www.themealdb.com/images/ingredients/${encodeURIComponent(name)}-small.png`;
