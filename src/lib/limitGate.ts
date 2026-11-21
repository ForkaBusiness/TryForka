import { checkLimit, type LimitKind, type PlanTier, type Usage } from './limits.ts';

// What a plan may do with what it has. Free never loses anything: over a limit (a lapsed
// Pro plan with 30 saved recipes, say), everything stays visible, usable and removable;
// only adding more beyond the limit is stopped, with the upgrade sheet. Pure, tested in
// tests/limitGate.test.ts.

export type LimitAction = 'add' | 'view' | 'use' | 'remove';

export interface GateAnswer { allowed: boolean; /** Show the upgrade sheet (only when adding past a limit). */ upgrade: boolean }

export function gate(usage: Usage, kind: LimitKind, action: LimitAction, adding = 1): GateAnswer {
  if (action !== 'add') return { allowed: true, upgrade: false };
  const ok = checkLimit(usage, kind, adding).allowed;
  return { allowed: ok, upgrade: !ok };
}

/** A recipe that's already saved can always be saved again in another way (another collection): it doesn't add to the count. */
export function addsSavedRecipe(recipeId: number, alreadySaved: ReadonlySet<number>): number {
  return alreadySaved.has(recipeId) ? 0 : 1;
}

// ── Which meals each plan plans ────────────────────────────────────────────

export type MealSlot = 'breakfast' | 'school_lunch' | 'lunch' | 'snack' | 'dinner';
/** Free plans dinners; Pro plans the whole week. */
export const SLOTS_FOR: Record<PlanTier, readonly MealSlot[]> = {
  free: ['dinner'],
  pro: ['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner'],
};
export const slotAllowed = (plan: PlanTier, slot: MealSlot) => SLOTS_FOR[plan].includes(slot);
