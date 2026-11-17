import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.103.3';
import { canonicalAllergy, type FoodPrefs } from './catalog/recipeFilter.ts';

// The family's food settings and the SQL first pass, for the Edge Functions. The same two
// steps as the app: family_safe_recipes() narrows the catalog, then the recipe filter
// (recipeFilter.ts) runs on what comes back with everyone's allergies in it.

/** The household's settings with each family member's allergies added. */
export async function familyFood(db: SupabaseClient): Promise<FoodPrefs> {
  const [{ data: prefs, error: prefsError }, { data: members, error: membersError }] = await Promise.all([
    db.from('user_preferences').select('diet, allergies, skip_ingredients, avoid_ingredients').maybeSingle(),
    db.from('family_members').select('allergies'),
  ]);
  // Settings that can't be read are not "no allergies": the caller must stop.
  if (prefsError) {
    console.error('[household] settings read failed:', prefsError);
    throw new Error('settings read failed');
  }
  // A database without the family table yet has no per-person allergies to add.
  if (membersError && membersError.code !== 'PGRST205' && membersError.code !== '42P01') {
    console.error('[household] family read failed:', membersError);
    throw new Error('family read failed');
  }
  const allergies = [
    ...((prefs?.allergies as string[]) ?? []),
    ...((members ?? []) as Array<{ allergies: string[] | null }>).flatMap(m => m.allergies ?? []),
  ].map(canonicalAllergy);
  return {
    diet: (prefs?.diet as string) ?? 'none',
    allergies: [...new Set(allergies)],
    skip_ingredients: (prefs?.skip_ingredients as string[]) ?? [],
    avoid_ingredients: (prefs?.avoid_ingredients as string[]) ?? [],
  };
}

// deno-lint-ignore no-explicit-any -- PostgREST builder types differ between rpc() and its filters
type Query = any;

/**
 * Runs a query on the per-user SQL filter. Uses family_safe_recipes(), and falls back to
 * safe_recipes() on a database that doesn't have it yet. Callers still run the recipe
 * filter on the rows: the SQL is the first pass, never the last word.
 */
export async function safeRecipes<T>(db: SupabaseClient, build: (q: Query) => Query): Promise<{ data: T[] | null; error: { code?: string; message: string } | null }> {
  let result = await build(db.rpc('family_safe_recipes'));
  if (result.error?.code === 'PGRST202') result = await build(db.rpc('safe_recipes'));
  return result;
}
