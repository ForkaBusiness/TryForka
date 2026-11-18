import { supabase } from './supabase';
import { checkLimit, FREE_AND_UNUSED, savedRecipeCount, type LimitCheck, type LimitKind, type PlanTier, type Usage } from './limits';
import { fetchCollectionRecipes } from './collections';

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
  const [{ data: favorites, error: favError }, memberships] = await Promise.all([
    supabase.from('favorites').select('recipe_id').eq('user_id', userId),
    fetchCollectionRecipes(),
  ]);
  if (favError) throw new Error(favError.message);
  return { ...FREE_AND_UNUSED, saved_recipes: savedRecipeCount((favorites ?? []).map(f => f.recipe_id as number), memberships) };
}

/**
 * The one check every limited feature asks before it adds something:
 * `const { allowed } = await checkUsage(userId, 'smart_imports')`.
 * Nothing calls it to block anything yet.
 */
export async function checkUsage(userId: string, kind: LimitKind, adding = 1): Promise<LimitCheck & { plan: PlanTier }> {
  const usage = await fetchUsage(userId);
  return { ...checkLimit(usage, kind, adding), plan: usage.plan };
}

/** Counts one smart import. Never blocks or fails the import. Saved recipes and saved lists are counted live. */
export function recordUsage(kind: 'smart_imports'): void {
  void supabase.rpc('record_usage', { p_kind: kind }).then(({ error }) => {
    if (error && !missingFunction(error)) console.error('[usage] not counted:', error.message);
  });
}
