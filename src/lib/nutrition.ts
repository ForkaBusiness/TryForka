import { supabase } from './supabase';
import { callFunction } from './plan';
import { hasNoCalories, nutritionKey, type Facts, type MeasuredIngredient } from '../../supabase/functions/_shared/nutrition.ts';

// Nutrition facts for a recipe's ingredients. The cache table is read first; the Edge
// Function is only called when an ingredient hasn't been looked up yet (it asks USDA and
// fills the cache). The adding-up is in the shared nutrition module.

export { BASE_SERVINGS, recipeNutrition, rounded, servingsMultiplier, type Nutrients, type RecipeNutrition } from '../../supabase/functions/_shared/nutrition.ts';

const COLUMNS = 'key, matched, fdc_id, description, kcal, protein_g, carbs_g, fat_g, fiber_g, portions';

/** True when the database doesn't have the nutrition table yet. */
const missingTable = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message ?? '');

/**
 * Facts by ingredient key for one recipe. Null when nutrition isn't available on this
 * database yet (the section is then left out). Throws when it couldn't be loaded.
 */
export async function recipeFacts(recipeId: number, ingredients: readonly MeasuredIngredient[]): Promise<Map<string, Facts> | null> {
  const keys = [...new Set(ingredients.map(i => nutritionKey(i.name_us)).filter(key => key && !hasNoCalories(key)))];
  if (!keys.length) return new Map();
  const { data, error } = await supabase.from('ingredient_nutrition').select(COLUMNS).in('key', keys);
  if (error) {
    if (missingTable(error)) return null;
    throw new Error(error.message);
  }
  const facts = new Map(((data ?? []) as unknown as Facts[]).map(f => [f.key, f]));
  if (keys.every(key => facts.has(key))) return facts;
  // Some ingredients haven't been looked up yet: the function asks USDA and caches them.
  const looked = await callFunction<{ facts: Facts[] }>('nutrition', { recipe_id: recipeId });
  for (const f of looked.facts) facts.set(f.key, f);
  return facts;
}

// How many servings each recipe was last set to, on this device.
const SERVINGS_KEY = 'forka_servings';
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

function savedServings(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SERVINGS_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
export function servingsFor(recipeId: number, fallback: number): number {
  const n = savedServings()[recipeId];
  return Number.isInteger(n) && n >= MIN_SERVINGS && n <= MAX_SERVINGS ? n : fallback;
}
export function rememberServings(recipeId: number, servings: number): void {
  try { localStorage.setItem(SERVINGS_KEY, JSON.stringify({ ...savedServings(), [recipeId]: servings })); } catch { /* this visit only */ }
}
