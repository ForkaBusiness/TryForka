// Plans and limits: the one place that knows what each plan allows.
//   saved_recipes   hearted or in a collection (imported, once imports exist). Never catalog
//                   recipes that are only in the week plan.
//   smart_imports   each import.
//   shopping_lists  saved lists held at the same time. The weekly list built from the plan
//                   never counts. Nothing in the app is
// blocked by these yet; features and the paywall will ask checkLimit() (or checkUsage() in
// usage.ts, which reads the numbers first). Pure, tested in tests/limits.test.ts.

import { FREE_LIMITS } from '../../supabase/functions/_shared/billing/limits.ts';

export type PlanTier = 'free' | 'pro';
export type LimitKind = 'saved_recipes' | 'smart_imports' | 'shopping_lists';
export const LIMIT_KINDS: readonly LimitKind[] = ['saved_recipes', 'smart_imports', 'shopping_lists'];

export const PLAN_LIMITS: Record<PlanTier, Record<LimitKind, number>> = {
  free: { ...FREE_LIMITS },
  pro: { saved_recipes: Infinity, smart_imports: Infinity, shopping_lists: Infinity },
};

export interface Usage { plan: PlanTier; saved_recipes: number; smart_imports: number; shopping_lists: number }

export const FREE_AND_UNUSED: Usage = { plan: 'free', saved_recipes: 0, smart_imports: 0, shopping_lists: 0 };

export interface LimitCheck {
  /** Whether `adding` more would stay within the plan. */
  allowed: boolean;
  used: number;
  /** Infinity on plans with no limit. */
  limit: number;
  /** How many more are left (Infinity with no limit, never below 0). */
  remaining: number;
}

/** Can this plan use `adding` more of `kind`? An unknown plan is treated as free. */
export function checkLimit(usage: Usage, kind: LimitKind, adding = 1): LimitCheck {
  const limit = (PLAN_LIMITS[usage.plan] ?? PLAN_LIMITS.free)[kind];
  const used = Math.max(0, usage[kind] ?? 0);
  return { allowed: used + adding <= limit, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Saved recipes, as the limit counts them: each recipe hearted, in a collection, or typed in
 * or imported by the household, once (usage_summary() counts the same set in SQL).
 * The week plan is not an input: catalog recipes that are only planned never count.
 */
export function savedRecipeCount(favorites: readonly number[], inCollections: ReadonlyArray<{ recipe_id: number }>, ownRecipes: readonly number[] = []): number {
  return new Set([...favorites, ...inCollections.map(m => m.recipe_id), ...ownRecipes]).size;
}
