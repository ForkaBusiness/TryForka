import type { Recipe } from './catalog';
import type { PrepPlan } from './prepSchedule';
import type { Day, PrepStep } from './prepSession';

// The household's current prep session, on this device, so cooking mode can run it and
// a reload or a trip back to the plan doesn't lose it. A week old, it's gone.

/** Cooking mode's id for the prep session (recipes have positive ids). */
export const PREP_ID = -1;
const KEY = 'forka_prep_session';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface SavedPrep { at: number; day: Day; picks: number[]; titles: string[]; plan: PrepPlan; steps: PrepStep[]; skipped: string[] }

export function loadPrep(now = Date.now()): SavedPrep | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedPrep | null;
    return p && Array.isArray(p.steps) && p.steps.length && now - p.at < KEEP_MS ? p : null;
  } catch { return null; }
}
export function savePrep(p: SavedPrep): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* this visit only */ }
}
export function clearPrep(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
}

/** The session in the shape cooking mode reads: steps, no ingredients of its own. */
export function prepAsRecipe(p: SavedPrep): Recipe {
  return {
    id: PREP_ID, name: 'Meal prep', display_name: 'Meal prep', subtitle: p.titles.join(', '), category: null, area: null, thumb_url: null,
    total_minutes: Math.round(p.plan.totalMinutes), meal_role: null, allergens: [], diets: [], ingredient_names: [],
    steps: p.steps, ingredients: [], tags: [], source_url: null, youtube_url: null,
  };
}
