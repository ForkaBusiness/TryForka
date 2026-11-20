// "Cook once, eat twice": a dinner that reheats well is cooked as a double batch and the
// second half fills a lunch or dinner a day or two later. Pure and deterministic, no
// imports, so it runs the same in the app and in `node --test`.
//
// Works on any week plan shaped like src/lib/plan.ts (`Record<Day, Record<Slot, entry | null>>`).
// A slot key may be missing on older plans; a missing key is treated as an empty slot.
//
// What it writes into the plan:
//   - the dinner cooked for later gets `cookTimes: 2`
//   - the slot that eats it gets a copy of that entry plus `leftoverOf: { day, slot, id }`

export type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'school_lunch';

/** Monday to Sunday. */
export const WEEK_DAYS: readonly Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** The order meals are read in within a day (grocery list, plan walks). */
export const SLOT_ORDER: readonly Slot[] = ['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner'];

/** Where a leftover meal was cooked. */
export interface LeftoverOf { day: Day; slot: Slot; id: number }

export interface PlanEntryLike {
  id: number;
  title: string;
  image: string;
  locked?: boolean;
  chosen?: boolean;
  /** 2 when this meal is cooked as a double batch for a later leftover. */
  cookTimes?: number;
  /** Set on a meal that is the leftover of another one. */
  leftoverOf?: LeftoverOf;
}
export type DayPlanLike = { [S in Slot]?: PlanEntryLike | null };
export type WeekPlanLike = Record<Day, DayPlanLike>;

export interface LeftoverRecipe { id: number; name: string; category?: string | null; total_minutes?: number | null }

/** An entry cooked for later: the plan entry gets `cookTimes: 2`; the eating slot gets `leftoverOf: { day, slot, id }`. */
export interface LeftoverLink { from: { day: Day; slot: Slot }; to: { day: Day; slot: Slot }; id: number }

export interface LeftoverOptions {
  recipes: ReadonlyMap<number, LeftoverRecipe>;
  /** Slots the family plans (only these can receive leftovers). */
  slots: readonly Slot[];
  /** Days that must not change (protected days and anything already eaten). */
  fixedDays?: ReadonlySet<Day>;
  /** At most this many cook-once-eat-twice pairs per week. Default 2. */
  maxPairs?: number;
}

// ── Which dishes keep ──────────────────────────────────────────────────────

// Dishes that are made to sit: these keep even with an ingredient that usually doesn't
// (steak pie, egg curry).
const STRONG_KEEPERS = new Set([
  'stew', 'stews', 'stewed', 'curry', 'curries', 'soup', 'soups', 'casserole', 'casseroles',
  'braise', 'braised', 'braises', 'lasagna', 'lasagne', 'lasagnas', 'lasagnes', 'pie', 'pies',
  'dal', 'dhal', 'daal', 'dahl', 'ragu', 'ragout', 'bolognese', 'tagine', 'tajine', 'chowder',
  'goulash', 'gumbo', 'jambalaya', 'korma', 'masala', 'vindaloo', 'rogan', 'biryani', 'moussaka',
  'enchilada', 'enchiladas', 'stroganoff', 'bourguignon', 'bourguignonne', 'cassoulet', 'hotpot',
  'ratatouille', 'minestrone', 'meatballs', 'cacciatore', 'chasseur', 'coq', 'bisque', 'pottage',
]);
// Cooking methods that usually keep, unless the dish is a fillet, a steak or eggs.
const WEAK_KEEPERS = new Set(['roast', 'roasts', 'roasted', 'bake', 'bakes', 'traybake', 'traybakes', 'pulled']);
// Chili only counts as the dish itself ("bean chili", "chili con carne"), not as a seasoning ("chilli prawns").
const CHILI = new Set(['chili', 'chilli', 'chile', 'chilis', 'chillies']);

// The dish is this format: never a leftover, whatever else the name says.
const NEVER = new Set([
  'salad', 'salads', 'slaw', 'coleslaw', 'sandwich', 'sandwiches', 'burger', 'burgers', 'sushi',
  'sashimi', 'toast', 'toastie', 'toasties', 'pancake', 'pancakes', 'waffle', 'waffles', 'crepe',
  'crepes', 'stirfry', 'tempura', 'poke', 'ceviche', 'carpaccio', 'tartare',
  'fried', 'fry', 'fries', 'crispy', 'battered', 'katsu', 'schnitzel', 'fritter', 'fritters',
]);
// Ingredients that turn dry or rubbery reheated, unless they sit in a stew, curry, pie...
const DOES_NOT_REHEAT = new Set([
  'steak', 'steaks', 'fillet', 'fillets', 'filet', 'filets', 'egg', 'eggs', 'omelette', 'omelet',
  'omelettes', 'scrambled', 'poached',
]);

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
}

/**
 * Dishes that reheat well (stews, curries, chili, soups, casseroles, bakes, braises, lasagna,
 * pasta bakes, pies, roasts, dal, ragu, bolognese, tagine, chowder...). Not: salads,
 * stir-fries, fried or crispy dishes, fish fillets, steak, sushi, pancakes, eggs, toast,
 * burgers, sandwiches. Decided from whole words of the name and category, so "pie" never
 * matches "piece".
 */
export function keepsWell(r: LeftoverRecipe): boolean {
  const name = words(r.name);
  const all = [...name, ...words(r.category ?? '')];
  if (all.some(w => NEVER.has(w))) return false;
  for (let i = 0; i + 1 < all.length; i++) if (all[i] === 'stir' && (all[i + 1] === 'fry' || all[i + 1] === 'fried')) return false;
  const chili = name.some((w, i) => CHILI.has(w) && (i === name.length - 1 || name[i + 1] === 'con' || name[i + 1] === 'sin'));
  if (chili || all.some(w => STRONG_KEEPERS.has(w))) return true;
  if (all.some(w => DOES_NOT_REHEAT.has(w))) return false;
  return all.some(w => WEAK_KEEPERS.has(w));
}

// ── Plan helpers ───────────────────────────────────────────────────────────

/** A copy of the plan with fresh day objects, so edits never touch the caller's plan. */
function copyPlan<P extends WeekPlanLike>(plan: P): P {
  const out = { ...plan } as P;
  for (const day of WEEK_DAYS) (out as WeekPlanLike)[day] = { ...(plan[day] ?? {}) };
  return out;
}

const entryAt = (plan: WeekPlanLike, day: Day, slot: Slot): PlanEntryLike | null => plan[day]?.[slot] ?? null;

/** Whether a leftover entry still points at a double batch of the same recipe. */
export function linkHolds(plan: WeekPlanLike, entry: PlanEntryLike): boolean {
  const ref = entry.leftoverOf;
  if (!ref || ref.id !== entry.id) return false;
  const source = entryAt(plan, ref.day, ref.slot);
  return !!source && source.id === ref.id && !source.leftoverOf && (source.cookTimes ?? 1) >= 2;
}

/** Every cook-once-eat-twice pair still in the plan. */
export function allLinks(plan: WeekPlanLike): LeftoverLink[] {
  const links: LeftoverLink[] = [];
  for (const day of WEEK_DAYS) for (const slot of SLOT_ORDER) {
    const entry = entryAt(plan, day, slot);
    if (entry?.leftoverOf && linkHolds(plan, entry)) {
      links.push({ from: { day: entry.leftoverOf.day, slot: entry.leftoverOf.slot }, to: { day, slot }, id: entry.id });
    }
  }
  return links;
}

/** A slot a leftover may go into: empty, or a meal nobody picked or locked and that isn't part of another pair. */
function canReceive(entry: PlanEntryLike | null): boolean {
  if (!entry) return true;
  return !entry.chosen && !entry.locked && !entry.leftoverOf && (entry.cookTimes ?? 1) < 2;
}

/**
 * Pairs dinners that reheat well with a later meal. Rules:
 * - only dinners that keep well are cooked twice; a locked dinner is never changed
 * - the leftover goes to the next day's lunch when lunches are planned and that lunch is
 *   free (empty, or not chosen or locked), otherwise to the dinner one or two days later
 * - never more than 2 days after cooking, never past Sunday, never on a fixed day
 * - one leftover per dinner, at most `maxPairs` (default 2) pairs a week, earliest first
 * - links already in the plan are kept and count toward `maxPairs`; running it again
 *   on its own output changes nothing
 * Returns the new plan (the input is not changed) and every link in it.
 */
export function scheduleLeftovers<P extends WeekPlanLike>(plan: P, opts: LeftoverOptions): { plan: P; links: LeftoverLink[] } {
  const out = copyPlan(plan);
  const week = out as WeekPlanLike;
  const fixed = opts.fixedDays ?? new Set<Day>();
  const maxPairs = Math.max(0, Math.floor(opts.maxPairs ?? 2));
  const planned = new Set(opts.slots);

  let pairs = 0;
  for (const day of WEEK_DAYS) for (const slot of SLOT_ORDER) if (entryAt(week, day, slot)?.leftoverOf) pairs++;

  for (let d = 0; d < WEEK_DAYS.length - 1 && pairs < maxPairs; d++) {
    const day = WEEK_DAYS[d];
    if (fixed.has(day)) continue;
    const source = entryAt(week, day, 'dinner');
    if (!source || source.locked || source.leftoverOf || (source.cookTimes ?? 1) >= 2) continue;
    const recipe = opts.recipes.get(source.id);
    if (!recipe || !keepsWell(recipe)) continue;

    const targets: Array<{ day: Day; slot: Slot }> = [];
    if (planned.has('lunch')) targets.push({ day: WEEK_DAYS[d + 1], slot: 'lunch' });
    if (planned.has('dinner')) {
      for (const ahead of [1, 2]) if (d + ahead < WEEK_DAYS.length) targets.push({ day: WEEK_DAYS[d + ahead], slot: 'dinner' });
    }
    const target = targets.find(t => !fixed.has(t.day) && canReceive(entryAt(week, t.day, t.slot)));
    if (!target) continue;

    week[day] = { ...week[day], dinner: { ...source, cookTimes: 2 } };
    week[target.day] = {
      ...week[target.day],
      [target.slot]: { id: source.id, title: source.title, image: source.image, leftoverOf: { day, slot: 'dinner', id: source.id } },
    };
    pairs++;
  }
  return { plan: out, links: allLinks(week) };
}

/**
 * Each planned recipe's multiplier for the grocery list: cookTimes 2 counts twice, a
 * leftover slot counts zero, everything else once. One element per planned meal, in plan
 * order (Monday..Sunday, slot order breakfast, school_lunch, lunch, snack, dinner).
 * A leftover whose double batch is gone from the plan counts once, so nothing goes unbought.
 */
export function groceryMultipliers(plan: WeekPlanLike): Array<{ day: Day; slot: Slot; id: number; multiplier: number }> {
  const out: Array<{ day: Day; slot: Slot; id: number; multiplier: number }> = [];
  for (const day of WEEK_DAYS) for (const slot of SLOT_ORDER) {
    const entry = entryAt(plan, day, slot);
    if (!entry) continue;
    let multiplier: number;
    if (entry.leftoverOf) multiplier = linkHolds(plan, entry) ? 0 : 1;
    else {
      const times = entry.cookTimes;
      multiplier = typeof times === 'number' && Number.isFinite(times) && times >= 1 ? Math.round(times) : 1;
    }
    out.push({ day, slot, id: entry.id, multiplier });
  }
  return out;
}

/** Removes all leftover links (turning the feature off): leftover slots go back to empty, cookTimes goes away. */
export function clearLeftovers<P extends WeekPlanLike>(plan: P): P {
  const out = copyPlan(plan);
  const week = out as WeekPlanLike;
  for (const day of WEEK_DAYS) for (const slot of SLOT_ORDER) {
    if (!(slot in week[day])) continue;
    const entry = week[day][slot];
    if (!entry) continue;
    if (entry.leftoverOf) week[day][slot] = null;
    else if ('cookTimes' in entry) {
      const { cookTimes: _drop, ...rest } = entry;
      week[day][slot] = rest;
    }
  }
  return out;
}
