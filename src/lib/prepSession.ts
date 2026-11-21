// A meal-prep session (Forka Pro): which planned meals can be prepped on a chosen day, and
// the scheduled session turned into cooking-mode steps with timers. Pure, tested in
// tests/prepSession.test.ts; the screen is src/screens/MealPrep.tsx.

import { prepStepTexts, type PrepPlan } from './prepSchedule.ts';

export type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export const WEEK: readonly Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

type Slot = 'breakfast' | 'school_lunch' | 'lunch' | 'snack' | 'dinner';
const SLOT_ORDER: readonly Slot[] = ['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner'];
/** Meals worth prepping ahead; snacks are quick enough on the day. */
const PREPPABLE: ReadonlySet<Slot> = new Set(['breakfast', 'school_lunch', 'lunch', 'dinner']);
/** The model plans at most this many recipes in one session. */
export const MAX_PREP_RECIPES = 6;
const DEFAULT_PICKS = 3;

interface Entry { id: number; title: string; leftoverOf?: unknown; cookTimes?: number; share?: number }
type Week = Record<Day, Partial<Record<Slot, Entry | null>>>;

export interface PrepCandidate {
  id: number; title: string; day: Day; slot: Slot;
  /** How much of the recipe to make: 2 for a double batch, a share for school lunches (as the grocery list buys). */
  scale: number;
}

/**
 * The meals that can be prepped on `prepDay`: that day and the rest of the week, once each
 * (the first time a recipe is planned), leftovers and snacks left out. In plan order.
 */
export function prepCandidates(plan: Week, prepDay: Day): PrepCandidate[] {
  const seen = new Set<number>();
  const out: PrepCandidate[] = [];
  for (const day of WEEK.slice(WEEK.indexOf(prepDay))) for (const slot of SLOT_ORDER) {
    const e = plan[day]?.[slot];
    if (!e || e.leftoverOf || !PREPPABLE.has(slot) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, title: e.title, day, slot, scale: (e.cookTimes ?? 1) * (e.share ?? 1) });
  }
  return out;
}

/** Servings to prep for a recipe that serves `base` as written: at least one. */
export const prepServings = (c: Pick<PrepCandidate, 'scale'>, base: number) => Math.max(1, Math.round(base * c.scale));

/** What's ticked to start with: the first few lunches and dinners, then breakfasts. */
export function defaultPicks(candidates: readonly PrepCandidate[]): number[] {
  const mains = candidates.filter(c => c.slot !== 'breakfast');
  return [...mains, ...candidates.filter(c => c.slot === 'breakfast')].slice(0, DEFAULT_PICKS).map(c => c.id);
}

export interface PrepStep { text_us: string; text_metric: string; timers: Array<{ seconds: number; maxSeconds: null; label: string }> }

/**
 * The session as cooking-mode steps. A hands-off task (oven, simmering) gets a timer for
 * the time it runs on its own, so the cook knows when to come back.
 */
export function prepSteps(plan: PrepPlan): PrepStep[] {
  const texts = prepStepTexts(plan);
  return plan.steps.map((s, i) => {
    const away = s.end - s.busyUntil;
    const timers = !s.task.handsOn && away > 0
      ? [{ seconds: away * 60, maxSeconds: null, label: `${shortTitle(s.task.title)} ${away} min` }]
      : [];
    return { text_us: texts[i], text_metric: texts[i], timers };
  });
}

/** "Roast the sweet potatoes at 200C" -> "Roast the sweet potatoes", kept short for a timer chip. */
function shortTitle(title: string): string {
  const words = title.replace(/[.,;:].*$/, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join(' ');
}

/** The cook's part of the session: until the last thing they have to do. */
export function kitchenMinutes(plan: PrepPlan): number {
  return plan.steps.reduce((m, s) => Math.max(m, s.busyUntil), 0);
}

/**
 * "About 55 minutes, 35 of them hands-on." When something keeps cooking on its own after
 * the cook's part is done (a braise, a stock), that's said separately rather than counted
 * as kitchen time.
 */
export function sessionSummary(plan: PrepPlan): string {
  const total = Math.round(plan.totalMinutes);
  const hands = Math.round(plan.handsOnMinutes);
  const kitchen = Math.round(kitchenMinutes(plan));
  const tail = total - kitchen;
  const shown = tail >= 30 ? kitchen : total;
  const length = shown >= 60 ? `About ${hoursText(shown)}` : `About ${shown} minutes`;
  const first = hands < shown ? `${length}, ${hands} of them hands-on.` : `${length}, all hands-on.`;
  if (tail < 30) return first;
  const last = plan.steps.reduce((a, b) => (b.end > a.end ? b : a));
  return `${first} After that, one thing keeps going on its own for about ${tail} minutes: ${lowerFirst(last.task.title)}.`;
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? 'an hour' : `${h} hours`;
  return m ? `${hours} and ${m} minutes` : hours;
}
