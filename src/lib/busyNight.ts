// The busy-night swap: one tap trades a planned dinner for something faster that uses
// what's already on the grocery list. Pure, tested in tests/busyNight.test.ts.

import type { PlannerRecipe } from './planner.ts';

/** How much faster a replacement has to be to count as "faster". */
export const FASTER_BY_MINUTES = 10;
/** When the planned dinner has no time on it, "fast" means this or less. */
export const QUICK_MINUTES = 30;
/** How many of the fastest candidates get their ingredients compared with the list. */
export const BUSY_SHORTLIST = 40;

/**
 * Candidates worth a closer look: clearly faster than the planned dinner and not already in
 * the week, fastest first. `candidates` must already have passed the hard filter.
 */
export function fasterOptions<T extends PlannerRecipe>(current: Pick<PlannerRecipe, 'id' | 'total_minutes'> | null, candidates: readonly T[], inPlan: ReadonlySet<number>): T[] {
  const limit = current?.total_minutes ? current.total_minutes - FASTER_BY_MINUTES : QUICK_MINUTES;
  return candidates
    .filter(r => r.meal_role === 'main' && r.id !== current?.id && !inPlan.has(r.id) && !!r.total_minutes && r.total_minutes <= limit)
    .sort((a, b) => a.total_minutes! - b.total_minutes! || a.id - b.id)
    .slice(0, BUSY_SHORTLIST);
}

export interface BusyOption<T extends PlannerRecipe = PlannerRecipe> {
  recipe: T;
  /** Grocery-list keys of what it needs, staples left out. */
  needs: readonly string[];
  /** The family's taste score for it; only breaks ties. */
  taste?: number;
}

export interface BusyPick<T extends PlannerRecipe = PlannerRecipe> { recipe: T; have: number; needs: number }

/**
 * The best of the faster options: first the one that adds the least to the shopping, then
 * the one that uses the most of what's on the list, then the quickest, then the best liked.
 */
export function pickBusyNight<T extends PlannerRecipe>(options: readonly BusyOption<T>[], onList: ReadonlySet<string>): BusyPick<T> | null {
  // Compared in order: the first rule that differs decides.
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  let best: { pick: BusyPick<T>; rank: number[] } | null = null;
  for (const o of options) {
    const needs = [...new Set(o.needs)];
    const have = needs.filter(k => onList.has(k)).length;
    const rank = [-(needs.length - have), have, -(o.recipe.total_minutes ?? 999), o.taste ?? 0];
    if (!best || better(rank, best.rank)) best = { pick: { recipe: o.recipe, have, needs: needs.length }, rank };
  }
  return best?.pick ?? null;
}

/** "Swapped tonight for a faster dinner: Chicken tacos. About 20 min, and 6 of its 8 ingredients are already on your list." */
export function busyNightNote(dayLabel: string, pick: BusyPick): string {
  const name = pick.recipe.display_name || pick.recipe.name;
  const minutes = pick.recipe.total_minutes ? `About ${pick.recipe.total_minutes} min` : 'Quicker';
  const list = !pick.needs ? ''
    : pick.have === pick.needs ? ', and everything it needs is already on your list'
    : pick.have ? `, and ${pick.have} of its ${pick.needs} ingredients are already on your list`
    : '';
  return `Swapped ${dayLabel} for a faster dinner: ${name}. ${minutes}${list}.`;
}
