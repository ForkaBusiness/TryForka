import { supabase } from './supabase';
import { ingredientAisles, recipeIngredients } from './catalog';
import { planEntries, type SavedWeekPlan } from './plan';
import { AISLES, combine, entryMultiplier, sameShop, LIST_VERSION, type Aisle, type GroceryItem, type MergeIngredient } from './groceryMerge';

// The household's grocery list (one row per user in grocery_lists), built from the
// saved week plan. Editing the plan rebuilds the list and keeps ticks for items that
// are still on it. Items added by hand live in custom_items; recipes whose ingredients
// the household took off the list live in excluded_recipes.

export interface CustomItem { key: string; name: string }

export interface SavedGroceryList {
  items: GroceryItem[];
  checked: string[];
  custom: CustomItem[];
  /** Recipes of this week whose ingredients are off the list. */
  excluded: number[];
  /** created_at of the week this list was built for: a new week starts a fresh list. */
  planCreatedAt: string | null;
  /** updated_at of the plan this list was built from. */
  planUpdatedAt: string | null;
}

const sameInstant = (a: string | null, b: string | null) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();


/** True when the list was built from this version of the plan (and in the current item format). */
export function listMatchesPlan(list: SavedGroceryList | null, plan: SavedWeekPlan): boolean {
  if (!list) return false;
  const current = list.items.every(i => i.v === LIST_VERSION);
  return current && sameInstant(list.planUpdatedAt, plan.updatedAt);
}

// A database that doesn't have the excluded_recipes column yet: the choice is then kept
// on this device instead, so the feature still works.
let excludedColumn = true;
const localKey = (userId: string) => `forka_grocery_excluded:${userId}`;
const missingColumn = (error: { code?: string; message?: string }) =>
  error.code === '42703' || error.code === 'PGRST204' || /excluded_recipes/.test(error.message ?? '');
function localExcluded(userId: string): number[] {
  try { return (JSON.parse(localStorage.getItem(localKey(userId)) ?? '[]') as unknown[]).filter((n): n is number => typeof n === 'number'); } catch { return []; }
}

export async function fetchGroceryList(userId: string): Promise<SavedGroceryList | null> {
  const read = (columns: string) => supabase.from('grocery_lists').select(columns).eq('user_id', userId).maybeSingle();
  const BASE = 'items, checked, custom_items, plan_created_at, plan_updated_at';
  // Asked for at the start: another request may find the column missing while this one is in flight.
  const withColumn = excludedColumn;
  let { data, error } = await read(withColumn ? `${BASE}, excluded_recipes` : BASE);
  if (error && withColumn && missingColumn(error)) {
    excludedColumn = false;
    ({ data, error } = await read(BASE));
  }
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as { items: GroceryItem[] | null; checked: string[] | null; custom_items: CustomItem[] | null; plan_created_at: string | null; plan_updated_at: string | null; excluded_recipes?: number[] | null };
  return {
    items: row.items ?? [],
    checked: row.checked ?? [],
    custom: row.custom_items ?? [],
    excluded: excludedColumn ? row.excluded_recipes ?? [] : localExcluded(userId),
    planCreatedAt: row.plan_created_at,
    planUpdatedAt: row.plan_updated_at,
  };
}

export { entryMultiplier };

/** Combines the ingredients of every planned meal (a recipe planned twice counts twice; see entryMultiplier). */
export async function buildItems(saved: SavedWeekPlan): Promise<GroceryItem[]> {
  const entries = planEntries(saved.plan).filter(e => entryMultiplier(e.entry) > 0);
  const ids = [...new Set(entries.map(e => e.entry.id))];
  if (!ids.length) return [];
  const byId = new Map((await recipeIngredients(ids)).map(r => [r.id, r]));
  const recipes = entries.flatMap(({ entry }) => {
    const r = byId.get(entry.id);
    return r ? [{ id: entry.id, title: r.display_name || r.name, ingredients: r.ingredients, multiplier: entryMultiplier(entry) }] : [];
  });
  const aisles = await ingredientAisles(recipes.flatMap(r => r.ingredients.map(i => i.name)));
  return combine(recipes, name => {
    const a = aisles.get(name);
    return a && (AISLES as readonly string[]).includes(a) ? (a as Aisle) : undefined;
  });
}

/** Rebuilds the list for this plan and saves it, keeping ticks for items still on the list and recipes still off it. */
export async function rebuildGroceryList(userId: string, saved: SavedWeekPlan, previous: SavedGroceryList | null): Promise<SavedGroceryList> {
  const items = await buildItems(saved);
  const keys = new Set([...items.map(i => i.key), ...(previous?.custom ?? []).map(c => c.key)]);
  // A new week is a new shop: last week's ticks and recipes taken off the list don't carry
  // over, though items added by hand stay. Re-planning within the same week keeps ticks for
  // items still on the list.
  const sameWeek = sameShop(previous?.planCreatedAt ?? null, saved.createdAt);
  const checked = sameWeek ? (previous?.checked ?? []).filter(k => keys.has(k)) : [];
  const custom = previous?.custom ?? [];
  const planned = new Set(planEntries(saved.plan).map(e => e.entry.id));
  const excluded = sameWeek ? (previous?.excluded ?? []).filter(id => planned.has(id)) : [];
  const { error } = await supabase.from('grocery_lists').upsert({
    user_id: userId, items, checked, custom_items: custom,
    plan_created_at: saved.createdAt, plan_updated_at: saved.updatedAt, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  if ((previous?.excluded ?? []).length !== excluded.length) await saveExcluded(userId, excluded).catch(() => {});
  return { items, checked, custom, excluded, planCreatedAt: saved.createdAt, planUpdatedAt: saved.updatedAt };
}

/** Saves which recipes are off the list. */
export async function saveExcluded(userId: string, excluded: number[]): Promise<void> {
  if (excludedColumn) {
    const { error } = await supabase.from('grocery_lists').update({ excluded_recipes: excluded, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (!error) return;
    if (!missingColumn(error)) throw new Error(error.message);
    excludedColumn = false;
  }
  try { localStorage.setItem(localKey(userId), JSON.stringify(excluded)); } catch { /* stays for this visit only */ }
}

export async function saveChecked(userId: string, checked: string[]): Promise<void> {
  const { error } = await supabase.from('grocery_lists').update({ checked, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function saveCustomItems(userId: string, custom: CustomItem[], checked: string[]): Promise<void> {
  const { error } = await supabase.from('grocery_lists')
    .upsert({ user_id: userId, custom_items: custom, checked, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
