import { supabase } from './supabase';
import { ingredientAisles, recipeIngredients } from './catalog';
import { planEntries, type SavedWeekPlan } from './plan';
import { AISLES, combine, LIST_VERSION, type Aisle, type GroceryItem, type MergeIngredient } from './groceryMerge';

// The household's grocery list (one row per user in grocery_lists), built from the
// saved week plan. Editing the plan rebuilds the list and keeps ticks for items that
// are still on it. Items added by hand live in custom_items.

export interface CustomItem { key: string; name: string }

export interface SavedGroceryList {
  items: GroceryItem[];
  checked: string[];
  custom: CustomItem[];
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

export async function fetchGroceryList(userId: string): Promise<SavedGroceryList | null> {
  const { data, error } = await supabase.from('grocery_lists')
    .select('items, checked, custom_items, plan_updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    items: (data.items as GroceryItem[]) ?? [],
    checked: (data.checked as string[]) ?? [],
    custom: (data.custom_items as CustomItem[]) ?? [],
    planUpdatedAt: data.plan_updated_at as string | null,
  };
}

/** Combines the ingredients of every planned meal (a recipe planned twice counts twice). */
export async function buildItems(saved: SavedWeekPlan): Promise<GroceryItem[]> {
  const entries = planEntries(saved.plan);
  const ids = [...new Set(entries.map(e => e.entry.id))];
  if (!ids.length) return [];
  const byId = new Map((await recipeIngredients(ids)).map(r => [r.id, r]));
  const recipes = entries.flatMap(({ entry }) => {
    const r = byId.get(entry.id);
    return r ? [{ id: entry.id, title: r.display_name || r.name, ingredients: r.ingredients }] : [];
  });
  const aisles = await ingredientAisles(recipes.flatMap(r => r.ingredients.map(i => i.name)));
  return combine(recipes, name => {
    const a = aisles.get(name);
    return a && (AISLES as readonly string[]).includes(a) ? (a as Aisle) : undefined;
  });
}

/** Rebuilds the list for this plan and saves it, keeping ticks for items still on the list. */
export async function rebuildGroceryList(userId: string, saved: SavedWeekPlan, previous: SavedGroceryList | null): Promise<SavedGroceryList> {
  const items = await buildItems(saved);
  const keys = new Set([...items.map(i => i.key), ...(previous?.custom ?? []).map(c => c.key)]);
  const checked = (previous?.checked ?? []).filter(k => keys.has(k));
  const custom = previous?.custom ?? [];
  const { error } = await supabase.from('grocery_lists').upsert({
    user_id: userId, items, checked, custom_items: custom,
    plan_created_at: saved.createdAt, plan_updated_at: saved.updatedAt, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return { items, checked, custom, planUpdatedAt: saved.updatedAt };
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
