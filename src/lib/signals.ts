import { supabase } from './supabase';
import type { CheckinResponse, Signals } from './planner';
import type { Day } from './plan';

// What the family has told us, read for the planner: after-dinner check-ins, plan events
// (picks, swaps, removals), the cooked log, ratings and favorites. Each source is read on
// its own, and one that fails counts as empty: missing evidence makes the plan less
// personal, never less safe (allergies don't come from here).

/** A local calendar day as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const HISTORY_DAYS = 180;

export async function fetchSignals(userId: string, favorites: readonly number[]): Promise<Signals> {
  const since = daysAgo(HISTORY_DAYS);
  const rows = async <T,>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    try { const { data, error } = await query; return error ? [] : ((data ?? []) as T[]); } catch { return []; }
  };
  const [checkins, events, cooked, ratings] = await Promise.all([
    rows<{ recipe_id: number; member_id: string | null; response: CheckinResponse; eaten_on: string }>(
      supabase.from('meal_checkins').select('recipe_id, member_id, response, eaten_on').eq('user_id', userId).gte('eaten_on', localDate(since)).limit(2000)),
    rows<{ recipe_id: number; kind: Signals['events'][number]['kind']; created_at: string }>(
      supabase.from('plan_events').select('recipe_id, kind, created_at').eq('user_id', userId).gte('created_at', since.toISOString()).limit(2000)),
    rows<{ recipe_id: number; cooked_at: string }>(
      supabase.from('cooked_recipes').select('recipe_id, cooked_at').eq('user_id', userId).gte('cooked_at', since.toISOString()).limit(2000)),
    rows<{ recipe_id: number; rating: number }>(
      supabase.from('recipe_ratings').select('recipe_id, rating').eq('user_id', userId).limit(2000)),
  ]);
  return {
    checkins: checkins.map(c => ({ recipeId: c.recipe_id, memberId: c.member_id, response: c.response, date: c.eaten_on })),
    favorites: [...favorites],
    events: events.map(e => ({ recipeId: e.recipe_id, kind: e.kind, at: e.created_at })),
    cooked: cooked.map(c => ({ recipeId: c.recipe_id, at: c.cooked_at })),
    ratings: ratings.map(r => ({ recipeId: r.recipe_id, rating: r.rating })),
  };
}

export interface CheckinAnswer { memberId: string | null; response: CheckinResponse }

/** The dinners already answered on these days, as "date|recipeId". */
export async function answeredDinners(userId: string, dates: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.from('meal_checkins').select('recipe_id, eaten_on').eq('user_id', userId).in('eaten_on', dates);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map(r => `${r.eaten_on}|${r.recipe_id}`));
}

/** Saves one dinner's answers, replacing any earlier answers for the same dinner. */
export async function saveCheckin(userId: string, recipeId: number, date: string, answers: CheckinAnswer[]): Promise<void> {
  const { data: earlier, error: readError } = await supabase.from('meal_checkins').select('id').eq('user_id', userId).eq('recipe_id', recipeId).eq('eaten_on', date);
  if (readError) throw new Error(readError.message);
  // The new answers go in first: if that fails, the earlier ones are still there.
  if (answers.length) {
    const { error } = await supabase.from('meal_checkins')
      .insert(answers.map(a => ({ user_id: userId, recipe_id: recipeId, member_id: a.memberId, response: a.response, eaten_on: date })));
    if (error) throw new Error(error.message);
  }
  const old = (earlier ?? []).map(r => r.id as string);
  if (old.length) {
    const { error } = await supabase.from('meal_checkins').delete().eq('user_id', userId).in('id', old);
    if (error) throw new Error(error.message);
  }
}

export interface PlanEvent { recipeId: number; kind: Signals['events'][number]['kind']; day?: Day }

/** Records what the household did to its plan. Never blocks or fails the edit itself. */
export function logPlanEvents(userId: string, events: PlanEvent[]): void {
  if (!events.length) return;
  void supabase.from('plan_events').insert(events.map(e => ({ user_id: userId, recipe_id: e.recipeId, kind: e.kind, day: e.day ?? null })))
    .then(({ error }) => { if (error) console.error('[plan] event not recorded:', error.message); });
}

/** Recipes marked cooked since this moment (the plan's days that are already done). */
export async function cookedSince(userId: string, iso: string): Promise<Set<number>> {
  const { data, error } = await supabase.from('cooked_recipes').select('recipe_id').eq('user_id', userId).gte('cooked_at', iso);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map(r => r.recipe_id as number));
}
