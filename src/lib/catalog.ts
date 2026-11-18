import { supabase } from './supabase';
import type { RecipeIngredient, RecipeStep } from '../../supabase/functions/_shared/catalog/derive.ts';
import type { StepTimer } from '../../supabase/functions/_shared/catalog/steps.ts';
import type { Allergen, Diet } from '../../supabase/functions/_shared/catalog/allergens.ts';
import { buildIngredientIndex, type IngredientOption } from './ingredientSearch';
import { recipeChecker, type FoodPrefs } from './recipeFilter';
import { recipeGate, type Opened } from './recipeGate';
import { BROWSE_FILTERS, CARD_COLUMNS, countByFilter, ingredientsOf, supabaseRecipes, type BrowseFilter } from './recipeSource';
import type { SocialPlatform, SourceKind } from '../../supabase/functions/_shared/imports/draft.ts';

// The recipe catalog in Supabase (synced from TheMealDB by the sync-recipes function).
// Every function here that hands recipes to a screen goes through the gate
// (recipeGate.ts): the SQL filter narrows the list first, then the recipe filter runs on
// what comes back with the family's settings, each person's allergies included. That
// holds for lists, for Suggestions and photo results, and for a single recipe opened by
// id, which comes back as "blocked" instead of the recipe when the family can't eat it.

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
  // A household's own recipe (typed in or imported) also has these; catalog recipes don't.
  owner_id?: string | null;
  /** Servings as written. Catalog recipes have none and are taken to serve BASE_SERVINGS. */
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  notes?: string | null;
  source_name?: string | null;
  source_kind?: SourceKind | null;
  source_platform?: SocialPlatform | null;
  source_handle?: string | null;
  /** The steps as the household wrote them, one per line (for editing). */
  instructions_raw?: string | null;
}

export { BROWSE_FILTERS, CARD_COLUMNS, type BrowseFilter };

export const recipeTitle = (r: Pick<RecipeCard, 'name' | 'display_name'>) => r.display_name || r.name;

/**
 * TheMealDB serves /small (~250px), /medium (~500px) and /large previews of each photo.
 * Other photos (a household's own: a web image or a private storage reference, which the
 * Photo component turns into a signed URL) are used as they are.
 */
export function photo(url: string | null | undefined, size: 'small' | 'medium' | 'large' | 'full' = 'medium'): string {
  if (!url) return '';
  if (size === 'full' || !/^https:\/\/www\.themealdb\.com\/images\/media\//.test(url)) return url;
  return `${url}/${size}`;
}

/** Household recipes are numbered from here (see 20261119000000_recipe_imports.sql). */
export const HOUSEHOLD_ID_START = 1_000_000_000;
/** True for a recipe the household typed in or imported (not from the catalog). */
export const isHouseholdRecipe = (r: { id: number }) => r.id >= HOUSEHOLD_ID_START;

/** "Spanish, vegetarian" style meta text from cuisine and diet. */
export function recipeMeta(r: Pick<RecipeCard, 'area' | 'diets' | 'category'>): string {
  const diet = r.diets.includes('vegan') ? 'vegan' : r.diets.includes('vegetarian') ? 'vegetarian' : '';
  const area = r.area && r.area !== 'Unknown' ? r.area : '';
  return [area, diet].filter(Boolean).join(', ').replace(/^./, c => c.toUpperCase());
}

export const minutesLabel = (m: number | null | undefined) => (m ? (m >= 90 ? `About ${+(m / 60).toFixed(1)} hr` : `About ${m} min`) : '');

// ── Recipes for the screen: all through the gate ───────────────────────────

const gate = recipeGate<RecipeCard, Recipe>(supabaseRecipes);

/** A page of the catalog the family may eat. `fetched` is the page's size before the filter: page on by that. */
export function browseRecipes(opts: { filter: BrowseFilter; search?: string; limit?: number; offset?: number }, prefs: FoodPrefs): Promise<{ recipes: RecipeCard[]; fetched: number }> {
  return gate.browse({ filter: opts.filter, search: opts.search ?? '', limit: opts.limit ?? 48, offset: opts.offset ?? 0 }, prefs);
}

/** Which browse filters have any recipes for this user (e.g. no Chicken for vegetarians). */
export async function availableFilters(): Promise<BrowseFilter[]> {
  const counts = await Promise.all(BROWSE_FILTERS.map(async f => [f, await countByFilter(f)] as const));
  return counts.filter(([f, n]) => f === 'All' || n > 0).map(([f]) => f);
}

/** One recipe to open, or why the family can't have it. Null when it doesn't exist. */
export const getRecipe = (id: number, prefs: FoodPrefs): Promise<Opened<Recipe> | null> => gate.open(id, prefs);

/** These recipes in the order given, without the ones the family can't eat. For favorites, collections, and results from the Edge Functions. */
export const safeCards = (ids: readonly number[], prefs: FoodPrefs): Promise<RecipeCard[]> => gate.cards(ids, prefs);

/** The same, by id. A recipe the family can't eat is simply not in the map. */
export async function safeCardMap(ids: readonly number[], prefs: FoodPrefs): Promise<Map<number, RecipeCard>> {
  return new Map((await gate.cards(ids, prefs)).map(r => [r.id, r]));
}

/** Every main and breakfast the family may eat: what the planner chooses from. */
export const planningPool = (prefs: FoodPrefs): Promise<RecipeCard[]> => gate.pool(['main', 'breakfast'], prefs);

/** Safe alternatives for a slot: same role, same category or cuisine first, "avoid" items last. */
export async function similarRecipes(base: RecipeCard | null, role: 'breakfast' | 'main', exclude: number[], prefs: FoodPrefs, count = 8): Promise<RecipeCard[]> {
  const skip = new Set(exclude);
  const check = recipeChecker(prefs);
  const pool = (await gate.pool([role], prefs)).filter(r => !skip.has(r.id));
  const score = (r: RecipeCard) => (base && r.category === base.category ? 2 : 0) + (base && r.area === base.area ? 1 : 0) + Math.random() - (check(r).avoids.length ? 10 : 0);
  return pool.sort((a, b) => score(b) - score(a)).slice(0, count);
}

const NO_SETTINGS: FoodPrefs = { allergies: [], skip_ingredients: [] };

/** Three dinner photos for the welcome panel's example week; the same ones all day. */
export async function previewRecipes(prefs: FoodPrefs = NO_SETTINGS): Promise<RecipeCard[]> {
  const rows = await gate.sample(120, prefs).catch(() => [] as RecipeCard[]);
  if (rows.length < 3) return rows;
  const day = Math.floor(Date.now() / 86_400_000);
  return [0, 1, 2].map(i => rows[(day * 7 + i * 37) % rows.length]);
}

export interface SearchableRecipe { id: number; recipe: RecipeCard; ingredients: string[] }
const searchPools = new Map<string, Promise<SearchableRecipe[]>>();

/**
 * Every main and breakfast the family may eat, with its ingredient names, for searching
 * by what's in the kitchen. Loaded once per session (per set of settings) and searched in
 * memory after that.
 */
export function searchablePool(prefs: FoodPrefs): Promise<SearchableRecipe[]> {
  const key = JSON.stringify([prefs.diet ?? 'none', [...prefs.allergies].sort(), [...prefs.skip_ingredients].sort(), [...(prefs.avoid_ingredients ?? [])].sort()]);
  let pool = searchPools.get(key);
  if (!pool) {
    pool = (async () => {
      const cards = await gate.pool(['main', 'breakfast'], prefs);
      const names = new Map<number, string[]>();
      for (let i = 0; i < cards.length; i += 150) {
        for (const r of await ingredientsOf(cards.slice(i, i + 150).map(c => c.id))) names.set(r.id, (r.ingredients ?? []).map(ing => ing.name_us || ing.name));
      }
      return cards.flatMap(recipe => (names.has(recipe.id) ? [{ id: recipe.id, recipe, ingredients: names.get(recipe.id)! }] : []));
    })().catch(err => { searchPools.delete(key); throw err; });
    searchPools.set(key, pool);
  }
  return pool;
}

// ── Not for the screen ─────────────────────────────────────────────────────

/**
 * Recipes by id, NOT filtered. For code that judges recipes the family already holds
 * (checking a saved plan, reading the family's history) and never shows them as they are.
 * Screens and components must not import this; tests/allergyPaths.test.ts enforces it.
 */
export const lookupCards = (ids: readonly number[]): Promise<Map<number, RecipeCard>> => gate.lookup(ids);

// ── The household's own recipes: writes and id lookups (shown through the gate) ──

export { householdRecipeIds, householdRecipeFrom, insertHouseholdRecipe, updateHouseholdRecipe, deleteHouseholdRecipe, householdRecipeForEdit, householdRecipeTitles } from './recipeSource';

/** The ingredient lists of planned recipes, for building the grocery list. */
export const recipeIngredients = ingredientsOf;

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
