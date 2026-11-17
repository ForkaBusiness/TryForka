import { lookupCards, planningPool, type RecipeCard } from './catalog';
import type { Preferences } from './preferences';
import type { FamilyMember } from './family';
import { cookedSince, fetchSignals } from './signals';
import { fetchGroceryList, listMatchesPlan, rebuildGroceryList } from './groceries';
import { shoppedRecipeIds } from './groceryMerge';
import { buildTaste, changeNote, openDays, planWeek, relaxedNotice, updatePlan, type Taste } from './planner';
import { DAYS, enforcePlan, planEntries, planNotice, plannedSlots, slotKey, todayKey, type PlanReview, type SavedWeekPlan, type WeekPlan } from './plan';

// Where the planner meets the household's data: reads the recipes the family may eat and
// everything they've told us, then asks the planner (planner.ts) for a new week or for
// the daily update.

export interface Family {
  userId: string;
  /** The household settings with every person's allergies added. */
  prefs: Preferences;
  members: FamilyMember[];
  favorites: number[];
}

const NO_RECIPES = 'No recipes match your settings. Check your allergies and skipped ingredients in Settings.';

async function familyTaste(family: Family, pool: RecipeCard[]): Promise<Taste> {
  const signals = await fetchSignals(family.userId, family.favorites);
  const known = new Set(pool.map(r => r.id));
  const mentioned = [...signals.checkins, ...signals.events, ...signals.cooked, ...signals.ratings].map(s => s.recipeId).concat(signals.favorites);
  const missing = [...new Set(mentioned)].filter(id => !known.has(id));
  // Recipes the family has an opinion on but can no longer be shown still teach the profile.
  const extra = missing.length ? [...(await lookupCards(missing).catch(() => new Map<number, RecipeCard>())).values()] : [];
  return buildTaste(signals, [...pool, ...extra], family.members, new Date(), family.prefs.avoid_ingredients);
}

/** A new week from what the family eats, checked by the filter. Locked days stay as they are. */
export async function generateWeekPlan(family: Family, current: WeekPlan | null): Promise<PlanReview & { plan: WeekPlan }> {
  const pool = await planningPool(family.prefs);
  if (!pool.some(r => r.meal_role === 'main')) throw new Error(NO_RECIPES);
  const taste = await familyTaste(family, pool);
  const slots = plannedSlots(family.prefs);
  const lastWeek = new Set(current ? planEntries(current).filter(e => e.slot !== 'breakfast').map(e => e.entry.id) : []);
  const { plan, relaxed } = planWeek({
    candidates: pool, taste, food: family.prefs, slots, maxWeeknightMinutes: family.prefs.max_weeknight_minutes,
    lastWeek, keep: current, seed: Date.now() >>> 0,
  });
  const checked = await enforcePlan(plan, family.prefs);
  const blocked = DAYS.flatMap(d => slots.filter(s => !checked.plan[d][s]).map(s => slotKey(d, s)));
  return {
    plan: checked.plan,
    notice: [relaxedNotice(relaxed, family.prefs.max_weeknight_minutes), planNotice(checked.replaced, blocked.length)].filter(Boolean).join(' ') || null,
    blocked,
  };
}

/**
 * The daily update, run after a check-in: re-ranks the dinners of the days that are still
 * open. Returns null when nothing should change. If the cooked log or the grocery list
 * can't be read, nothing changes either: without them we can't tell which days are settled.
 */
export async function updateAfterCheckin(family: Family, saved: SavedWeekPlan): Promise<{ plan: WeekPlan; note: string } | null> {
  const [pool, cooked, list] = await Promise.all([
    planningPool(family.prefs),
    cookedSince(family.userId, saved.createdAt),
    fetchGroceryList(family.userId).then(current => (listMatchesPlan(current, saved) ? current! : rebuildGroceryList(family.userId, saved, current))),
  ]);
  const days = openDays(saved.plan, todayKey(), cooked, shoppedRecipeIds(list.items, list.checked));
  if (!days.length) return null;
  const taste = await familyTaste(family, pool);
  const { plan, changes } = updatePlan({ plan: saved.plan, days, candidates: pool, taste, food: family.prefs, maxWeeknightMinutes: family.prefs.max_weeknight_minutes });
  const note = changeNote(changes);
  return note ? { plan, note } : null;
}
