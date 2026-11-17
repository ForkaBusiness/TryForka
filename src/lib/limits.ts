// Plans and limits: the one place that knows what each plan allows. Nothing in the app is
// blocked by these yet; features and the paywall will ask checkLimit() (or checkUsage() in
// usage.ts, which reads the numbers first). Pure, tested in tests/limits.test.ts.

export type PlanTier = 'free' | 'pro';
export type LimitKind = 'saved_recipes' | 'smart_imports' | 'shopping_lists';
export const LIMIT_KINDS: readonly LimitKind[] = ['saved_recipes', 'smart_imports', 'shopping_lists'];

export const PLAN_LIMITS: Record<PlanTier, Record<LimitKind, number>> = {
  free: { saved_recipes: 20, smart_imports: 20, shopping_lists: 2 },
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
