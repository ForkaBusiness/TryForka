import { lookupCards, planningPool, planningPoolWith, recipeIngredients, type RecipeCard } from './catalog';
import { slotOnDay } from './meals';
import type { Preferences } from './preferences';
import type { FamilyMember } from './family';
import { CHECK_INGREDIENTS } from './familyPrefs';
import { cookedSince, fetchSignals } from './signals';
import { fetchGroceryList, listMatchesPlan, rebuildGroceryList } from './groceries';
import { isStaple, itemKey, protectedByList, withoutRecipes } from './groceryMerge';
import { busyNightNote, fasterOptions, pickBusyNight } from './busyNight';
import { buildTaste, changeNote, openDays, planWeek, relaxedNotice, scoreRecipe, updatePlan, type Taste } from './planner';
import { DAYS, DAY_LONG, enforcePlan, entryFromCard, planEntries, planNotice, plannedSlots, schoolLunchShareFor, slotKey, todayKey, withSlot, type Day, type PlanReview, type SavedWeekPlan, type WeekPlan } from './plan';

// Where the planner meets the household's data: reads the recipes the family may eat and
// everything they've told us, then asks the planner (planner.ts) for a new week or for
// the daily update.

export interface Family {
  userId: string;
  /** The household settings with every person's allergies added. */
  prefs: Preferences;
  members: FamilyMember[];
  favorites: number[];
  /** Ingredients to use up this week: meals that use them are favored. */
  onHand: string[];
  /** Free plans dinners; Pro plans every meal the household switched on. */
  plan: 'free' | 'pro';
}

const NO_RECIPES = `No recipes match your settings. Check your allergies and skipped ingredients in Settings. ${CHECK_INGREDIENTS}`;

async function familyTaste(family: Family, pool: RecipeCard[]): Promise<Taste> {
  const signals = await fetchSignals(family.userId, family.favorites);
  const known = new Set(pool.map(r => r.id));
  const mentioned = [...signals.checkins, ...signals.events, ...signals.cooked, ...signals.ratings].map(s => s.recipeId).concat(signals.favorites);
  const missing = [...new Set(mentioned)].filter(id => !known.has(id));
  // Recipes the family has an opinion on but can no longer be shown still teach the profile.
  const extra = missing.length ? [...(await lookupCards(missing).catch(() => new Map<number, RecipeCard>())).values()] : [];
  return buildTaste(signals, [...pool, ...extra], family.members, new Date(), family.prefs.avoid_ingredients, family.onHand);
}

/** A new week from what the family eats, checked by the filter. Locked days stay as they are. */
export async function generateWeekPlan(family: Family, current: WeekPlan | null): Promise<PlanReview & { plan: WeekPlan }> {
  const slots = plannedSlots(family.prefs, family.plan, family.members);
  // Snacks and school lunches also come from the catalog's sides and sweets.
  const pool = slots.some(s => s === 'snack' || s === 'school_lunch') ? await planningPoolWith(family.prefs, ['side', 'dessert']) : await planningPool(family.prefs);
  if (!pool.some(r => r.meal_role === 'main')) throw new Error(NO_RECIPES);
  const taste = await familyTaste(family, pool);
  const lastWeek = new Set(current ? planEntries(current).filter(e => e.slot === 'lunch' || e.slot === 'dinner').map(e => e.entry.id) : []);
  const { plan, relaxed } = planWeek({
    candidates: pool, taste, food: family.prefs, slots, maxWeeknightMinutes: family.prefs.max_weeknight_minutes,
    lastWeek, keep: current, seed: Date.now() >>> 0, schoolLunchShare: schoolLunchShareFor(family.members),
  });
  const checked = await enforcePlan(plan, family.prefs);
  // School lunches are weekdays only: an empty weekend school lunch isn't a gap.
  const blocked = DAYS.flatMap(d => slots.filter(s => !checked.plan[d][s] && slotOnDay(s, d)).map(s => slotKey(d, s)));
  return {
    plan: checked.plan,
    notice: [relaxedNotice(relaxed, family.prefs.max_weeknight_minutes), planNotice(checked.replaced, blocked.length)].filter(Boolean).join(' ') || null,
    blocked,
  };
}

/** The grocery list for this plan, rebuilt first if it's out of date. Items of recipes taken off the list are still in it. */
const groceryListFor = (userId: string, saved: SavedWeekPlan) =>
  fetchGroceryList(userId).then(current => (listMatchesPlan(current, saved) ? current! : rebuildGroceryList(userId, saved, current)));

/**
 * The daily update, run after a check-in: re-ranks the dinners of the days that are still
 * open. Returns null when nothing should change. If the cooked log or the grocery list
 * can't be read, nothing changes either: without them we can't tell which days are settled.
 */
export async function updateAfterCheckin(family: Family, saved: SavedWeekPlan): Promise<{ plan: WeekPlan; note: string } | null> {
  const [pool, cooked, list] = await Promise.all([planningPool(family.prefs), cookedSince(family.userId, saved.createdAt), groceryListFor(family.userId, saved)]);
  const days = openDays(saved.plan, todayKey(), cooked, protectedByList(list));
  if (!days.length) return null;
  const taste = await familyTaste(family, pool);
  const { plan, changes } = updatePlan({ plan: saved.plan, days, candidates: pool, taste, food: family.prefs, maxWeeknightMinutes: family.prefs.max_weeknight_minutes });
  const note = changeNote(changes);
  return note ? { plan, note } : null;
}

/**
 * The busy-night swap: trades one day's dinner for something clearly faster that adds the
 * least to the shopping. Null when nothing faster fits. The new dinner is marked as the
 * household's own choice, so the daily update leaves it alone; a locked day stays locked.
 */
export async function busyNightSwap(family: Family, saved: SavedWeekPlan, day: Day): Promise<{ plan: WeekPlan; note: string } | null> {
  const current = saved.plan[day].dinner;
  if (!current) return null;
  const [pool, list] = await Promise.all([planningPool(family.prefs), groceryListFor(family.userId, saved)]);
  const card = pool.find(r => r.id === current.id) ?? (await lookupCards([current.id])).get(current.id);
  const taste = await familyTaste(family, pool);
  // Not what's in the week, and not what the household took out of it this week (a faster
  // dinner they undid is not offered a second time).
  const off = new Set([...planEntries(saved.plan).map(e => e.entry.id), ...taste.takenOut]);
  const options = fasterOptions(card ?? { id: current.id, total_minutes: null }, pool, off);
  if (!options.length) return null;
  const details = await recipeIngredients(options.map(r => r.id));
  const needs = new Map(details.filter(d => d.ingredients?.length).map(d => [d.id, d.ingredients.map(i => itemKey(i.name_us || i.name)).filter(key => key && !isStaple(key))]));
  const pick = pickBusyNight(
    // A recipe whose ingredients aren't known can't be called "nothing to buy": it's left out.
    options.filter(recipe => needs.has(recipe.id)).map(recipe => ({ recipe, needs: needs.get(recipe.id)!, taste: scoreRecipe(recipe, taste).total })),
    // What's on the list for the other meals: not what only the dinner being replaced needed,
    // and not what's been taken off.
    new Set(withoutRecipes(list.items, new Set([...list.excluded, current.id])).map(i => i.key)),
  );
  if (!pick) return null;
  const entry = { ...entryFromCard(pick.recipe), chosen: true, ...(current.locked ? { locked: true } : {}) };
  return { plan: withSlot(saved.plan, day, 'dinner', entry), note: busyNightNote(day === todayKey() ? 'tonight' : DAY_LONG[day], pick) };
}
