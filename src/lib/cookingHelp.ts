import { supabase } from './supabase';
import type { FoodPrefs } from './recipeFilter';
import type { UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';
import { safeSwaps, safeVariations, tableSwaps, type HelpIngredient, type Swap, type Variation } from '../../supabase/functions/_shared/cooking/help.ts';

// Cooking help in cooking mode: swaps for a missing ingredient, and ways to make the recipe
// different. Common swaps come from the built-in table right here, instantly and without a
// network call; the rest are asked of the cooking-help Edge Function. Every answer is
// checked against the family's settings again before it is shown.

export type { Swap, Variation };

export type HelpAnswer<T> =
  | ({ status: 'ok' } & T)
  /** Today's cooking help is used up. */
  | { status: 'capped'; message: string }
  | { status: 'failed'; message: string };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function post<T>(body: unknown): Promise<HelpAnswer<{ data: T }>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { status: 'failed', message: 'Sign in again to continue.' };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/cooking-help`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 'failed', message: "Couldn't connect. Check your connection and try again." };
  }
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (res.ok) return { status: 'ok', data };
  const message = data.error ?? "Couldn't get help right now. Try again.";
  // A daily cap waits hours; "too many at once" waits seconds and is worth another try.
  // (Retry-After, or the cap's own wording where a browser hides the header.)
  if (res.status === 429 && (Number(res.headers.get('Retry-After') ?? 0) > 60 || /used today's/i.test(message))) return { status: 'capped', message };
  return { status: 'failed', message };
}

/** Swaps from the built-in table that the family can eat, or null (then the function is asked). */
export function localSwaps(ing: HelpIngredient, scale: number, units: UnitSystem, prefs: FoodPrefs): { missing: string; swaps: Swap[] } | null {
  const table = tableSwaps(ing, scale, units);
  if (!table) return null;
  const swaps = safeSwaps(table.swaps, prefs);
  return swaps.length ? { missing: table.missing, swaps } : null;
}

export async function askSwaps(opts: { recipeId: number; ingredient: number; servings: number; units: UnitSystem; prefs: FoodPrefs }): Promise<HelpAnswer<{ missing: string; swaps: Swap[] }>> {
  const r = await post<{ missing: string; swaps: Swap[] }>({ mode: 'substitute', recipe_id: opts.recipeId, ingredient: opts.ingredient, servings: opts.servings, units: opts.units });
  if (r.status !== 'ok') return r;
  return { status: 'ok', missing: r.data.missing, swaps: safeSwaps(r.data.swaps ?? [], opts.prefs) };
}

export async function askVariations(opts: { recipeId: number; servings: number; units: UnitSystem; prefs: FoodPrefs }): Promise<HelpAnswer<{ variations: Variation[]; onHand: string[] }>> {
  const r = await post<{ variations: Variation[]; onHand?: string[] }>({ mode: 'variations', recipe_id: opts.recipeId, servings: opts.servings, units: opts.units });
  if (r.status !== 'ok') return r;
  return { status: 'ok', variations: safeVariations(r.data.variations ?? [], opts.prefs), onHand: r.data.onHand ?? [] };
}
