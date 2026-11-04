import { supabase } from './supabase';
import { getCards, recheckRecipes, similarRecipes, type RecipeCard } from './catalog';
import type { FoodSettings, Preferences } from './preferences';
import { pickReplacement, recipeChecker, REPLACEMENT_TRIES } from './recipeFilter';

// The household's week plan (one row per user in week_plans) and the calls to the
// suggestions Edge Function that fill it. Days are weekdays, not dates: the plan is
// "this week" until a new one is made.

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export const SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type Day = typeof DAYS[number];
export type Slot = typeof SLOTS[number];

export const DAY_SHORT: Record<Day, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
export const DAY_LONG: Record<Day, string> = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };
export const SLOT_LABEL: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

export interface PlanEntry { id: number; title: string; image: string }
export type WeekPlan = Record<Day, Record<Slot, PlanEntry | null>>;

export interface SavedWeekPlan {
  plan: WeekPlan;
  /** When the week was planned. */
  createdAt: string;
  /** Last edit (swap, add); the grocery list is rebuilt when this changes. */
  updatedAt: string;
}

export function emptyPlan(): WeekPlan {
  return Object.fromEntries(DAYS.map(d => [d, { breakfast: null, lunch: null, dinner: null }])) as WeekPlan;
}

/** Fills in any days/slots missing from an older saved plan. */
function normalize(plan: Partial<WeekPlan> | null | undefined): WeekPlan {
  const out = emptyPlan();
  for (const d of DAYS) for (const s of SLOTS) out[d][s] = plan?.[d]?.[s] ?? null;
  return out;
}

export function todayKey(date = new Date()): Day {
  return DAYS[(date.getDay() + 6) % 7];
}

export const entryFromCard = (r: RecipeCard): PlanEntry => ({ id: r.id, title: r.display_name || r.name, image: r.thumb_url ?? '' });

export function planEntries(plan: WeekPlan): Array<{ day: Day; slot: Slot; entry: PlanEntry }> {
  return DAYS.flatMap(day => SLOTS.flatMap(slot => (plan[day][slot] ? [{ day, slot, entry: plan[day][slot]! }] : [])));
}

export async function fetchWeekPlan(userId: string): Promise<SavedWeekPlan | null> {
  const { data, error } = await supabase.from('week_plans').select('plan, created_at, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { plan: normalize(data.plan as WeekPlan), createdAt: data.created_at as string, updatedAt: (data.updated_at ?? data.created_at) as string };
}

/** Saves the plan. `fresh` marks a newly planned week (resets "planned on"). */
export async function saveWeekPlan(userId: string, plan: WeekPlan, previous: SavedWeekPlan | null, fresh: boolean): Promise<SavedWeekPlan> {
  const now = new Date().toISOString();
  const createdAt = fresh || !previous ? now : previous.createdAt;
  const { error } = await supabase.from('week_plans')
    .upsert({ user_id: userId, plan, created_at: createdAt, updated_at: now }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return { plan, createdAt, updatedAt: now };
}

export function withSlot(plan: WeekPlan, day: Day, slot: Slot, entry: PlanEntry | null): WeekPlan {
  return { ...plan, [day]: { ...plan[day], [slot]: entry } };
}

/**
 * Where "+" puts a recipe: the first empty slot of its kind from today through Sunday,
 * then from Monday. Breakfasts go to breakfast; everything else to dinner, then lunch
 * if lunches are planned. Null when the week is full.
 */
export function nextOpenSlot(plan: WeekPlan, isBreakfast: boolean, planLunch: boolean): { day: Day; slot: Slot } | null {
  const start = DAYS.indexOf(todayKey());
  const order = [...DAYS.slice(start), ...DAYS.slice(0, start)];
  const slots: Slot[] = isBreakfast ? ['breakfast'] : planLunch ? ['dinner', 'lunch'] : ['dinner'];
  for (const slot of slots) for (const day of order) if (!plan[day][slot]) return { day, slot };
  return null;
}

/** Where a recipe already sits in the plan, if anywhere. */
export function findInPlan(plan: WeekPlan, id: number): { day: Day; slot: Slot } | null {
  for (const { day, slot, entry } of planEntries(plan)) if (entry.id === id) return { day, slot };
  return null;
}

// ── Keeping a plan safe ────────────────────────────────────────────────────

export const slotKey = (day: Day, slot: Slot) => `${day}:${slot}`;

export interface PlanReview {
  /** What changed, in plain words. */
  notice: string | null;
  /** slotKey()s left empty because no recipe fits. */
  blocked: string[];
  /** Set when a settings change caused this: the meals and settings from just before. */
  undo?: { plan: WeekPlan; food: FoodSettings };
}

export function planNotice(replaced: number, blocked: number): string | null {
  const meals = (n: number) => (n === 1 ? '1 meal' : `${n} meals`);
  const notes: string[] = [];
  if (replaced) notes.push(`We replaced ${meals(replaced)} that didn't fit your allergies or preferences.`);
  if (blocked) notes.push(`We couldn't find a recipe that fits your settings for ${meals(blocked)}, so ${blocked === 1 ? 'it stays' : 'they stay'} empty.`);
  return notes.join(' ') || null;
}

/**
 * Runs every recipe in a plan through the filter. One that fails is replaced from the
 * catalog with the same kind of meal; with no safe replacement the slot goes empty.
 * Used on new plans and on saved plans, which were only checked against the settings of
 * the day they were made.
 */
export async function enforcePlan(plan: WeekPlan, prefs: Preferences): Promise<{ plan: WeekPlan; changed: boolean; replaced: number; blocked: string[] }> {
  const entries = planEntries(plan);
  const cards = await getCards(entries.map(e => e.entry.id));
  const check = recipeChecker(prefs);
  const failed = entries.filter(({ entry }) => {
    const card = cards.get(entry.id);
    return !card || !check(card).allowed;
  });
  if (!failed.length) return { plan, changed: false, replaced: 0, blocked: [] };

  const used = new Set(entries.map(e => e.entry.id));
  const options = (role: 'breakfast' | 'main') => (failed.some(f => (f.slot === 'breakfast') === (role === 'breakfast'))
    ? similarRecipes(null, role, [], prefs, REPLACEMENT_TRIES * 2) : Promise.resolve([]));
  const [mains, breakfasts] = await Promise.all([options('main'), options('breakfast')]);

  let next = plan;
  let replaced = 0;
  const blocked: string[] = [];
  for (const { day, slot } of failed) {
    // Same rule as the week planner: a breakfast may repeat, a main may not.
    const pick = slot === 'breakfast'
      ? pickReplacement(breakfasts, check, used) ?? pickReplacement(breakfasts, check, new Set())
      : pickReplacement(mains, check, used);
    if (pick) { used.add(pick.id); replaced++; } else blocked.push(slotKey(day, slot));
    next = withSlot(next, day, slot, pick ? entryFromCard(pick) : null);
  }
  return { plan: next, changed: true, replaced, blocked };
}

const plannedSlots = (prefs: Preferences): Slot[] => {
  const slots = SLOTS.filter(s => (s === 'breakfast' ? prefs.plan_breakfast : s === 'lunch' ? prefs.plan_lunch : prefs.plan_dinner));
  return slots.length ? slots : ['dinner'];
};

// ── Suggestions Edge Function ──────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in again to continue.');
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't connect. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status}). Try again.`);
  return data as T;
}

export interface SuggestionPick { recipe: RecipeCard; reason: string }

export async function getSuggestions(prompt: string, prefs: Preferences, opts: { slot?: Slot; exclude?: number[] } = {}): Promise<{ picks: SuggestionPick[]; note: string | null }> {
  const { picks, note } = await callFunction<{ picks: SuggestionPick[]; note?: string | null }>('ai-suggestions', { mode: 'suggestions', prompt, ...opts });
  const reasons = new Map(picks.map(p => [p.recipe.id, p.reason]));
  const safe = await recheckRecipes(picks.map(p => p.recipe.id), prefs);
  return { picks: safe.map(recipe => ({ recipe, reason: reasons.get(recipe.id) ?? '' })), note: note ?? null };
}

/** A new week, checked by the filter, plus a plain note when the household's settings left too few recipes. */
export async function generateWeekPlan(prefs: Preferences): Promise<PlanReview & { plan: WeekPlan }> {
  const { plan, notice } = await callFunction<{ plan: WeekPlan; notice?: string | null }>('ai-suggestions', { mode: 'week' });
  const checked = await enforcePlan(normalize(plan), prefs);
  const blocked = DAYS.flatMap(d => plannedSlots(prefs).filter(s => !checked.plan[d][s]).map(s => slotKey(d, s)));
  return {
    plan: checked.plan,
    notice: [notice, planNotice(checked.replaced, blocked.length)].filter(Boolean).join(' ') || null,
    blocked,
  };
}
