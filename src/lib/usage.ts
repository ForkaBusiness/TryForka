import { supabase } from './supabase';
import { checkLimit, FREE_AND_UNUSED, PLAN_LIMITS, savedRecipeCount, type LimitCheck, type LimitKind, type PlanTier, type Usage } from './limits';
import { addsSavedRecipe, gate } from './limitGate';
import { fetchCollectionRecipes } from './collections';
import { householdRecipeIds } from './catalog';

// The signed-in user's plan and usage, read from usage_summary() in the database, and the
// counting of uses. On a database that doesn't have these yet, everyone is on the free
// plan, saved recipes are counted here, and nothing else is counted.

const missingFunction = (error: { code?: string; message?: string }) => error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');

export async function fetchUsage(userId: string): Promise<Usage> {
  const { data, error } = await supabase.rpc('usage_summary');
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as Partial<Usage> | undefined;
    return { ...FREE_AND_UNUSED, ...row, plan: row?.plan === 'pro' ? 'pro' : 'free' };
  }
  if (!missingFunction(error)) throw new Error(error.message);
  const [{ data: favorites, error: favError }, memberships, own] = await Promise.all([
    supabase.from('favorites').select('recipe_id').eq('user_id', userId),
    fetchCollectionRecipes(),
    householdRecipeIds(userId),
  ]);
  if (favError) throw new Error(favError.message);
  return { ...FREE_AND_UNUSED, saved_recipes: savedRecipeCount((favorites ?? []).map(f => f.recipe_id as number), memberships, own) };
}

/**
 * The one check every limited feature asks before it adds something:
 * `const { allowed } = await checkUsage(userId, 'smart_imports')`. Only adding is ever
 * stopped (limitGate.ts): what a household has stays visible, usable and removable.
 */
export async function checkUsage(userId: string, kind: LimitKind, adding = 1): Promise<LimitCheck & { plan: PlanTier }> {
  const usage = await fetchUsage(userId);
  return { ...checkLimit(usage, kind, adding), plan: usage.plan };
}

/**
 * Whether one more recipe can be saved (hearted, put in a collection, written or imported).
 * A recipe that's already saved some other way doesn't count again. If usage can't be read,
 * saving goes ahead: a failed read never blocks the household.
 */
export async function canSaveRecipe(userId: string, recipeId: number | null): Promise<boolean> {
  let usage: Usage;
  try { usage = await fetchUsage(userId); } catch { return true; }
  if (usage.plan === 'pro' || usage.saved_recipes < PLAN_LIMITS.free.saved_recipes) return true;
  if (recipeId === null) return false;
  if (recipeId >= 1_000_000_000) return true; // the household's own recipe is already counted
  const [{ data: fav }, memberships] = await Promise.all([
    supabase.from('favorites').select('recipe_id').eq('user_id', userId).eq('recipe_id', recipeId).limit(1),
    fetchCollectionRecipes().catch(() => []),
  ]);
  const already = new Set<number>([...(fav ?? []).map(f => f.recipe_id as number), ...memberships.map(m => m.recipe_id)]);
  return gate(usage, 'saved_recipes', 'add', addsSavedRecipe(recipeId, already)).allowed;
}

/** Whether another smart import fits the plan. Unreadable usage never blocks (the server checks too). */
export async function canImport(userId: string): Promise<boolean> {
  try { return (await checkUsage(userId, 'smart_imports')).allowed; } catch { return true; }
}

/** Counts one smart import. Never blocks or fails the import. Saved recipes and saved lists are counted live. */
export function recordUsage(kind: 'smart_imports'): void {
  void supabase.rpc('record_usage', { p_kind: kind }).then(({ error }) => {
    if (error && !missingFunction(error)) console.error('[usage] not counted:', error.message);
  });
}
