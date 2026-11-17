// The planner: learns what a family eats and ranks recipes for their week. Pure (no
// network, no clock of its own), so the same inputs always give the same plan and the
// rules can be unit-tested in tests/planner.test.ts.
//
// Two rules sit above everything else:
//   1. Allergies, diet and "never show" ingredients are hard filters. A recipe that fails
//      them is removed before anything is scored, so no amount of liking brings it back.
//   2. A day the household locked, already cooked, or already shopped for is never changed.
//      The caller says which days those are; this file only ever touches the others.

import { normalizeIngredient, pickReplacement, recipeChecker, type FoodPrefs } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';

export const PLAN_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type PlanDay = typeof PLAN_DAYS[number];
export type PlanSlot = 'breakfast' | 'lunch' | 'dinner';
const WEEKNIGHTS: ReadonlySet<string> = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
const DAY_NAMES: Record<PlanDay, string> = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };

export interface PlannerRecipe {
  id: number;
  name: string;
  display_name?: string | null;
  category: string | null;
  area: string | null;
  thumb_url?: string | null;
  total_minutes: number | null;
  meal_role: string | null;
  allergens: readonly string[];
  diets: readonly string[];
  ingredient_names: readonly string[];
}

export interface PlannedMeal {
  id: number;
  title: string;
  image: string;
  /** The household locked this day: it stays through the daily update and a new week. */
  locked?: boolean;
  /** The household put this meal here by hand: the daily update leaves it alone. */
  chosen?: boolean;
}
export type PlannerWeek = Record<PlanDay, Record<PlanSlot, PlannedMeal | null>>;

export type CheckinResponse = 'loved' | 'fine' | 'skipped';

export interface PlannerMember {
  id: string;
  name: string;
  kind: 'adult' | 'kid';
  likes: readonly string[];
  dislikes: readonly string[];
}

export interface Signals {
  /** One per person per dinner; memberId null when the household answered as one. `date` is YYYY-MM-DD. */
  checkins: ReadonlyArray<{ recipeId: number; memberId: string | null; response: CheckinResponse; date: string }>;
  favorites: readonly number[];
  events: ReadonlyArray<{ recipeId: number; kind: 'picked' | 'swapped_out' | 'removed' | 'not_cooked'; at: string }>;
  cooked: ReadonlyArray<{ recipeId: number; at: string }>;
  ratings: ReadonlyArray<{ recipeId: number; rating: number }>;
}

export const NO_SIGNALS: Signals = { checkins: [], favorites: [], events: [], cooked: [], ratings: [] };

// ── Weights ────────────────────────────────────────────────────────────────
// Kept together so the model can be read (and tuned) in one place.

const RESPONSE_VALUE: Record<CheckinResponse, number> = { loved: 3, fine: 0.5, skipped: -3 };
/** A dinner one person refused is a weeknight problem even if the rest loved it. */
const LOWEST_ANSWER_WEIGHT = 0.4;
const FAVORITE = 2.5;
const EVENT_VALUE = { picked: 0.75, swapped_out: -1, removed: -0.75, not_cooked: -0.5 } as const;
const COOKED_EACH = 0.4;
const COOKED_MAX = 1.2;
const DIRECT_LIMIT = 6;
/** Evidence fades: half as strong after this many days. */
const HALF_LIFE_DAYS = 90;
/** How far one recipe's evidence spreads to recipes that share a category, cuisine or ingredient. */
const SHRINK = 3;
const CATEGORY_WEIGHT = 0.8;
const AREA_WEIGHT = 0.5;
const INGREDIENT_WEIGHT = 1;
const SIMILAR_LIMIT = 3;
/** Ingredients in more than this share of recipes say nothing about taste (salt, onion, oil). */
const COMMON_INGREDIENT_SHARE = 0.12;
const MEMBER_LIKE = 1;
const MEMBER_DISLIKE = -1.5;
const HOUSEHOLD_AVOID = -2;
/** A meal eaten in the last week waits its turn, however much it was loved. */
const REPEAT_WINDOW_DAYS = 7;
const REPEAT_PENALTY = 5;
const SAME_CATEGORY_IN_WEEK = 1;
const SAME_AREA_IN_WEEK = 0.5;
const LAST_WEEK_PENALTY = 1.5;
/** Shuffle strength for a new week, so two weeks with the same evidence still differ. */
const JITTER = 1.2;

// The daily update is deliberately conservative: a plan that reshuffles itself every
// night is worse than one that is slightly less than perfect. A planned dinner goes when
// it now looks like something that won't get eaten. A dinner the family has no opinion on
// makes way only for one they clearly liked at the table: loved in a check-in, or (with
// more evidence) very close to several they loved. A heart or a rating on its own shapes
// the next new week, not tonight's update, and one loved dinner doesn't pull its
// lookalikes into the week.
const MAX_CHANGES_PER_UPDATE = 2;
const MAX_BROUGHT_IN_PER_UPDATE = 1;
const WEAK_MEAL = -1;
const LIKED_ITSELF = 1.25;
const LIKED_BY_RESEMBLANCE = 2.5;
const GAIN_TO_REPLACE = 1.25;
/** A dinner the household took out of the plan isn't offered back by the update for this long. */
const TAKEN_OUT_DAYS = 7;

const DAY_MS = 86_400_000;
const title = (r: PlannerRecipe) => r.display_name || r.name;
const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
const daysBetween = (from: string | number | Date, to: Date) => Math.max(0, (to.getTime() - new Date(from).getTime()) / DAY_MS);
const fade = (ageDays: number) => 0.5 ** (ageDays / HALF_LIFE_DAYS);
/** Check-in dates are local calendar days; noon keeps them on the right day in any zone. */
const dayStamp = (date: string) => new Date(`${date}T12:00:00`);

// ── What the family has told us ────────────────────────────────────────────

interface Evidence { value: number; lovedBy: string[]; refusedBy: string[]; date: string | null; favorite: boolean }

export interface Taste {
  now: Date;
  members: readonly PlannerMember[];
  /** Evidence about each recipe itself. */
  direct: Map<number, Evidence>;
  /** Learned leaning per category ("cat:Chicken"), cuisine ("area:Thai") and ingredient ("ing:rice"). */
  affinity: Map<string, number>;
  /** The recipe that taught each leaning the most, for the note that explains a change. */
  source: Map<string, { best: number; worst: number }>;
  lastEaten: Map<number, Date>;
  /** Recipes the household swapped out or removed in the last week: the daily update doesn't bring them back. */
  takenOut: Set<number>;
  common: Set<string>;
  recipes: Map<number, PlannerRecipe>;
  avoids: (r: PlannerRecipe) => boolean;
  memberTerms: Array<{ member: PlannerMember; likes: (r: PlannerRecipe) => string[]; dislikes: (r: PlannerRecipe) => string[] }>;
}

const termMatcher = (terms: readonly string[]) => {
  if (!terms.length) return () => [] as string[];
  const check = recipeChecker({ allergies: [], skip_ingredients: [], avoid_ingredients: terms });
  return (r: PlannerRecipe) => check(r).avoids;
};

function features(r: PlannerRecipe, common: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (r.category && r.category !== 'Miscellaneous') out.push(`cat:${r.category}`);
  if (r.area && r.area !== 'Unknown') out.push(`area:${r.area}`);
  for (const name of new Set(r.ingredient_names.map(normalizeIngredient))) if (name && !common.has(name)) out.push(`ing:${name}`);
  return out;
}

/**
 * Turns the family's history into a taste profile. `recipes` is every recipe the profile
 * may need to know about: the candidates, plus any recipe the history mentions.
 */
export function buildTaste(signals: Signals, recipes: readonly PlannerRecipe[], members: readonly PlannerMember[], now: Date, avoidIngredients: readonly string[] = []): Taste {
  const byId = new Map(recipes.map(r => [r.id, r]));
  const counts = new Map<string, number>();
  for (const r of recipes) for (const n of new Set(r.ingredient_names.map(normalizeIngredient))) counts.set(n, (counts.get(n) ?? 0) + 1);
  const common = new Set([...counts].filter(([, n]) => recipes.length >= 20 && n / recipes.length > COMMON_INGREDIENT_SHARE).map(([name]) => name));

  const direct = new Map<number, Evidence>();
  const lastEaten = new Map<number, Date>();
  const evidence = (id: number) => {
    let e = direct.get(id);
    if (!e) { e = { value: 0, lovedBy: [], refusedBy: [], date: null, favorite: false }; direct.set(id, e); }
    return e;
  };
  const ate = (id: number, when: Date) => { if (!lastEaten.has(id) || lastEaten.get(id)! < when) lastEaten.set(id, when); };
  const memberName = (id: string | null) => (id === null ? null : members.find(m => m.id === id)?.name ?? null);

  // Check-ins, one dinner at a time: the average answer, pulled toward the lowest one.
  const dinners = new Map<string, Array<{ memberId: string | null; response: CheckinResponse }>>();
  for (const c of signals.checkins) {
    const key = `${c.recipeId}|${c.date}`;
    dinners.set(key, [...(dinners.get(key) ?? []), { memberId: c.memberId, response: c.response }]);
  }
  for (const [key, answers] of [...dinners].sort(([a], [b]) => a.split('|')[1].localeCompare(b.split('|')[1]))) {
    const [id, date] = [Number(key.split('|')[0]), key.split('|')[1]];
    const values = answers.map(a => RESPONSE_VALUE[a.response]);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const value = mean * (1 - LOWEST_ANSWER_WEIGHT) + Math.min(...values) * LOWEST_ANSWER_WEIGHT;
    const e = evidence(id);
    e.value += value * fade(daysBetween(dayStamp(date), now));
    // The latest dinner is the one a note talks about.
    e.date = date;
    // "Everyone" only when the household answered as one, or every person at the table
    // gave this answer. Two of three people loving it is those two, by name.
    const everyoneAnswered = members.length > 0 && members.every(m => answers.some(a => a.memberId === m.id));
    const names = (response: CheckinResponse) => {
      const hit = answers.filter(a => a.response === response);
      if (!hit.length) return [];
      if (hit.some(a => a.memberId === null) || (everyoneAnswered && hit.length === answers.length)) return ['everyone'];
      return hit.map(a => memberName(a.memberId)).filter((n): n is string => !!n);
    };
    e.lovedBy = names('loved');
    e.refusedBy = names('skipped');
    ate(id, dayStamp(date));
  }
  for (const id of signals.favorites) { const e = evidence(id); e.value += FAVORITE; e.favorite = true; }
  for (const r of signals.ratings) evidence(r.recipeId).value += r.rating - 3;
  const takenOut = new Set<number>();
  for (const ev of signals.events) {
    evidence(ev.recipeId).value += EVENT_VALUE[ev.kind] * fade(daysBetween(ev.at, now));
    if ((ev.kind === 'swapped_out' || ev.kind === 'removed') && daysBetween(ev.at, now) < TAKEN_OUT_DAYS) takenOut.add(ev.recipeId);
  }
  const cookedCount = new Map<number, number>();
  for (const c of signals.cooked) {
    cookedCount.set(c.recipeId, (cookedCount.get(c.recipeId) ?? 0) + 1);
    ate(c.recipeId, new Date(c.at));
  }
  for (const [id, n] of cookedCount) evidence(id).value += Math.min(COOKED_MAX, n * COOKED_EACH);
  for (const e of direct.values()) e.value = clamp(e.value, DIRECT_LIMIT);

  // Spread each recipe's evidence to what it has in common with other recipes.
  const sums = new Map<string, { sum: number; n: number }>();
  const source = new Map<string, { best: number; worst: number }>();
  for (const [id, e] of direct) {
    const r = byId.get(id);
    if (!r || !e.value) continue;
    for (const f of features(r, common)) {
      const s = sums.get(f) ?? { sum: 0, n: 0 };
      s.sum += e.value; s.n += 1;
      sums.set(f, s);
      const src = source.get(f) ?? { best: id, worst: id };
      if (e.value > (direct.get(src.best)?.value ?? 0)) src.best = id;
      if (e.value < (direct.get(src.worst)?.value ?? 0)) src.worst = id;
      source.set(f, src);
    }
  }
  const affinity = new Map([...sums].map(([f, s]) => [f, s.sum / (s.n + SHRINK)]));

  const avoidMatch = termMatcher(avoidIngredients);
  return {
    now, members, direct, affinity, source, lastEaten, takenOut, common, recipes: byId,
    avoids: r => avoidMatch(r).length > 0,
    memberTerms: members.map(member => ({ member, likes: termMatcher(member.likes), dislikes: termMatcher(member.dislikes) })),
  };
}

// ── Scoring one recipe ─────────────────────────────────────────────────────

export interface Score {
  total: number;
  /** Evidence about this recipe itself. */
  direct: number;
  /** What it shares with recipes the family has an opinion on. */
  similar: number;
  /** Per-person likes and dislikes, and the household's "avoid if possible". */
  people: number;
  /** Negative when it was eaten in the last few days. */
  recent: number;
  /** The feature that pulled hardest in each direction, for the note. */
  pull: { up: string | null; down: string | null };
  likedBy: Array<{ name: string; what: string }>;
  dislikedBy: Array<{ name: string; what: string }>;
}

export function scoreRecipe(r: PlannerRecipe, taste: Taste): Score {
  const direct = taste.direct.get(r.id)?.value ?? 0;
  let category = 0, area = 0, ingredients = 0, count = 0;
  let up: [string | null, number] = [null, 0], down: [string | null, number] = [null, 0];
  for (const f of features(r, taste.common)) {
    const a = taste.affinity.get(f);
    if (a === undefined) { if (f.startsWith('ing:')) count++; continue; }
    // A recipe doesn't count as "similar to itself".
    const own = taste.direct.get(r.id)?.value ?? 0;
    const src = taste.source.get(f);
    const selfOnly = own !== 0 && src?.best === r.id && src?.worst === r.id;
    const value = selfOnly ? 0 : a;
    if (f.startsWith('cat:')) category = value;
    else if (f.startsWith('area:')) area = value;
    else { ingredients += value; count++; }
    if (value > up[1]) up = [f, value];
    if (value < down[1]) down = [f, value];
  }
  const similar = clamp(CATEGORY_WEIGHT * category + AREA_WEIGHT * area + INGREDIENT_WEIGHT * (count ? ingredients / Math.sqrt(count) : 0), SIMILAR_LIMIT);

  const likedBy: Score['likedBy'] = [];
  const dislikedBy: Score['dislikedBy'] = [];
  for (const { member, likes, dislikes } of taste.memberTerms) {
    const liked = likes(r)[0];
    const disliked = dislikes(r)[0];
    if (liked) likedBy.push({ name: member.name, what: liked });
    if (disliked) dislikedBy.push({ name: member.name, what: disliked });
  }
  const people = Math.min(3, likedBy.length) * MEMBER_LIKE + Math.min(3, dislikedBy.length) * MEMBER_DISLIKE + (taste.avoids(r) ? HOUSEHOLD_AVOID : 0);

  const eaten = taste.lastEaten.get(r.id);
  const age = eaten ? daysBetween(eaten, taste.now) : Infinity;
  const recent = age < REPEAT_WINDOW_DAYS ? -REPEAT_PENALTY * (1 - age / REPEAT_WINDOW_DAYS) : 0;

  return { total: direct + similar + people + recent, direct, similar, people, recent, pull: { up: up[0], down: down[0] }, likedBy, dislikedBy };
}

/** Candidates that pass the hard filter, best first. The filter runs here so no caller can skip it. */
export function rankRecipes<T extends PlannerRecipe>(candidates: readonly T[], taste: Taste, food: FoodPrefs): Array<{ recipe: T; score: Score }> {
  const check = recipeChecker(food);
  return candidates
    .filter(r => check(r).allowed)
    .map(recipe => ({ recipe, score: scoreRecipe(recipe, taste) }))
    .sort((a, b) => b.score.total - a.score.total || a.recipe.id - b.recipe.id);
}

// ── Planning a week ────────────────────────────────────────────────────────

/** A stable 0..1 number per recipe and seed, so a plan can be reproduced. */
function jitter(seed: number, id: number): number {
  let h = (seed ^ (id * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

export function emptyWeek(): PlannerWeek {
  return Object.fromEntries(PLAN_DAYS.map(d => [d, { breakfast: null, lunch: null, dinner: null }])) as PlannerWeek;
}

const asMeal = (r: PlannerRecipe): PlannedMeal => ({ id: r.id, title: title(r), image: r.thumb_url ?? '' });

export type Relaxed = 'lastWeek' | 'time' | 'repeat';

export interface PlanWeekInput {
  candidates: readonly PlannerRecipe[];
  taste: Taste;
  food: FoodPrefs;
  slots: readonly PlanSlot[];
  /** Monday to Friday dinners take at most this long; null for no limit. */
  maxWeeknightMinutes: number | null;
  /** Lunches and dinners of the plan being replaced. */
  lastWeek?: ReadonlySet<number>;
  /** Locked meals of the current plan stay where they are. */
  keep?: PlannerWeek | null;
  seed: number;
}

/**
 * A new week. Dinners are chosen first so the best recipes go to them, one day at a time,
 * each pick lowering the score of what resembles it so the week stays varied. When the
 * household's settings leave too few recipes, rules relax in this order: last week's
 * meals, then the weeknight time limit, then repeats within the week.
 */
export function planWeek(input: PlanWeekInput): { plan: PlannerWeek; relaxed: Set<Relaxed> } {
  const { taste, food, slots, maxWeeknightMinutes: maxMinutes, seed } = input;
  const lastWeek = input.lastWeek ?? new Set<number>();
  const ranked = rankRecipes(input.candidates, taste, food);
  const mains = ranked.filter(c => c.recipe.meal_role === 'main');
  const breakfasts = ranked.filter(c => c.recipe.meal_role === 'breakfast');
  const plan = emptyWeek();
  const relaxed = new Set<Relaxed>();
  const uses = new Map<number, number>();
  const categories = new Map<string, number>();
  const areas = new Map<string, number>();
  const note = (r: PlannerRecipe | undefined) => {
    if (!r) return;
    uses.set(r.id, (uses.get(r.id) ?? 0) + 1);
    if (r.category) categories.set(r.category, (categories.get(r.category) ?? 0) + 1);
    if (r.area) areas.set(r.area, (areas.get(r.area) ?? 0) + 1);
  };

  for (const day of PLAN_DAYS) for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
    const kept = input.keep?.[day]?.[slot];
    if (!kept?.locked) continue;
    plan[day][slot] = kept;
    note(taste.recipes.get(kept.id) ?? input.candidates.find(c => c.id === kept.id));
    if (!uses.has(kept.id)) uses.set(kept.id, 1);
  }

  const tooLong = (r: PlannerRecipe, day: PlanDay, slot: PlanSlot) =>
    slot === 'dinner' && !!maxMinutes && WEEKNIGHTS.has(day) && (r.total_minutes ?? Infinity) > maxMinutes;
  const value = (c: { recipe: PlannerRecipe; score: Score }) =>
    c.score.total + JITTER * jitter(seed, c.recipe.id)
    - SAME_CATEGORY_IN_WEEK * (categories.get(c.recipe.category ?? '') ?? 0)
    - SAME_AREA_IN_WEEK * (areas.get(c.recipe.area ?? '') ?? 0)
    - (lastWeek.has(c.recipe.id) ? LAST_WEEK_PENALTY : 0);

  const pickMain = (day: PlanDay, slot: PlanSlot): PlannerRecipe | null => {
    // Level 0 keeps every rule; each level after drops one.
    for (const level of [0, 1, 2, 3]) {
      let best: { recipe: PlannerRecipe; score: Score } | null = null;
      let bestValue = -Infinity;
      for (const c of mains) {
        if (level < 3 && uses.has(c.recipe.id)) continue;
        if (level < 1 && lastWeek.has(c.recipe.id)) continue;
        if (level < 2 && tooLong(c.recipe, day, slot)) continue;
        // Out of unused recipes: the one used least, then the quickest.
        const v = level === 3 ? -(uses.get(c.recipe.id) ?? 0) * 100 + value(c) : value(c);
        if (v > bestValue) { best = c; bestValue = v; }
      }
      if (best) {
        if (level >= 1 && lastWeek.has(best.recipe.id)) relaxed.add('lastWeek');
        if (level >= 2 && tooLong(best.recipe, day, slot)) relaxed.add('time');
        if (level >= 3 && uses.has(best.recipe.id)) relaxed.add('repeat');
        return best.recipe;
      }
    }
    return null;
  };

  for (const slot of (['dinner', 'lunch'] as const).filter(s => slots.includes(s))) {
    for (const day of PLAN_DAYS) {
      if (plan[day][slot]) continue;
      const pick = pickMain(day, slot);
      if (!pick) continue;
      note(pick);
      plan[day][slot] = asMeal(pick);
    }
  }
  if (slots.includes('breakfast') && breakfasts.length) {
    const order = [...breakfasts].sort((a, b) => (b.score.total + JITTER * jitter(seed, b.recipe.id)) - (a.score.total + JITTER * jitter(seed, a.recipe.id)));
    let i = 0;
    for (const day of PLAN_DAYS) {
      if (plan[day].breakfast) continue;
      // Breakfasts may repeat: most households rotate a handful.
      plan[day].breakfast = asMeal(order[i++ % order.length].recipe);
    }
  }
  return { plan, relaxed };
}

/** The plain note for a week that had to bend a rule. */
export function relaxedNotice(relaxed: ReadonlySet<Relaxed>, maxWeeknightMinutes: number | null): string | null {
  const notes: string[] = [];
  if (relaxed.has('repeat')) notes.push('Your settings leave only a few recipes, so some meals repeat this week.');
  else if (relaxed.has('lastWeek')) notes.push('A few meals from last week are back: your settings leave only a few recipes.');
  if (relaxed.has('time') && maxWeeknightMinutes) notes.push(`Not enough recipes take ${maxWeeknightMinutes} minutes or less, so some weeknight dinners take longer.`);
  return notes.join(' ') || null;
}

// ── The daily update ───────────────────────────────────────────────────────

export interface PlanChange { day: PlanDay; from: PlannedMeal; to: PlannedMeal; reason: string }

export interface UpdateInput {
  plan: PlannerWeek;
  /** Days the update may change. The caller leaves out today, past days, and every day that is locked, cooked or shopped for. */
  days: readonly PlanDay[];
  candidates: readonly PlannerRecipe[];
  taste: Taste;
  food: FoodPrefs;
  maxWeeknightMinutes: number | null;
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "everyone", "the kids", or names. */
export function who(names: readonly string[], members: readonly PlannerMember[]): string {
  if (!names.length || names.includes('everyone')) return 'everyone';
  const kids = members.filter(m => m.kind === 'kid').map(m => m.name);
  if (kids.length > 1 && kids.length === names.length && kids.every(k => names.includes(k))) return 'the kids';
  return list([...names]);
}

/** "tonight", "last night", "on Monday", "last week". */
export function when(date: string, now: Date): string {
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  const days = Math.round((today.getTime() - dayStamp(date).getTime()) / DAY_MS);
  if (days <= 0) return 'tonight';
  if (days === 1) return 'last night';
  if (days < 7) return `on ${dayStamp(date).toLocaleDateString('en-US', { weekday: 'long' })}`;
  if (days < 14) return 'last week';
  if (days < 45) return 'a few weeks ago';
  return 'a while back';
}

/**
 * One short sentence: what changed and why. Recipe names stay out of it: the new dinner
 * is on the day itself, and names read badly mid-sentence ("Friday's BBQ pork...").
 */
function changeReason(day: PlanDay, from: PlannerRecipe | undefined, fromScore: Score | null, to: PlannerRecipe, toScore: Score, taste: Taste): string {
  const dayName = DAY_NAMES[day];
  const loved = taste.direct.get(to.id);
  // The new meal has its own history: the strongest and simplest reason.
  if (loved && loved.lovedBy.length && loved.date && toScore.direct > 0) {
    return `Swapped ${dayName} for something ${who(loved.lovedBy, taste.members)} loved ${when(loved.date, taste.now)}.`;
  }
  // The old meal is one that didn't get eaten, or resembles one.
  if (from && fromScore && fromScore.total <= WEAK_MEAL) {
    const own = taste.direct.get(from.id);
    if (own && own.refusedBy.length && own.date) {
      return `Swapped ${dayName}'s dinner. ${didntEat(own.refusedBy, taste.members)} it ${when(own.date, taste.now)}.`;
    }
    const src = fromScore.pull.down ? taste.source.get(fromScore.pull.down)?.worst : undefined;
    const srcEvidence = src !== undefined ? taste.direct.get(src) : undefined;
    if (srcEvidence?.refusedBy.length && srcEvidence.date) {
      return `Swapped ${dayName} for something different. ${didntEat(srcEvidence.refusedBy, taste.members)} a dinner like it ${when(srcEvidence.date, taste.now)}.`;
    }
    if (fromScore.dislikedBy.length) return `Swapped ${dayName} for something ${list(fromScore.dislikedBy.map(d => d.name))} will eat.`;
    return `Swapped ${dayName} for something that suits your family better.`;
  }
  if (loved?.favorite && toScore.direct > 0) return `Swapped ${dayName} for one of your favorites.`;
  // The new meal resembles something that went down well.
  const src = toScore.pull.up ? taste.source.get(toScore.pull.up)?.best : undefined;
  const srcEvidence = src !== undefined ? taste.direct.get(src) : undefined;
  if (srcEvidence?.lovedBy.length && srcEvidence.date) {
    return `Swapped ${dayName} for something close to a dinner ${who(srcEvidence.lovedBy, taste.members)} loved ${when(srcEvidence.date, taste.now)}.`;
  }
  if (toScore.likedBy.length) return `Swapped ${dayName} for something ${list(toScore.likedBy.map(l => l.name))} will like.`;
  return `Swapped ${dayName} for something closer to what your family eats.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Nobody ate" or "Mia didn't eat". */
const didntEat = (names: readonly string[], members: readonly PlannerMember[]) =>
  (names.includes('everyone') ? 'Nobody ate' : `${cap(who(names, members))} didn't eat`);

/**
 * Re-ranks the dinners of the days it's given against everything the family has told us.
 * A dinner is replaced only when something clearly better is available: either it now
 * looks like a meal that won't get eaten, or a meal the family liked is waiting. At most
 * two days change per update, and at most one of them to bring a liked meal in.
 */
export function updatePlan(input: UpdateInput): { plan: PlannerWeek; changes: PlanChange[] } {
  const { taste, food, maxWeeknightMinutes: maxMinutes } = input;
  const ranked = rankRecipes(input.candidates.filter(c => c.meal_role === 'main'), taste, food);
  const byId = new Map(input.candidates.map(c => [c.id, c]));
  const recipeOf = (id: number) => byId.get(id) ?? taste.recipes.get(id);
  let plan = input.plan;
  const changes: PlanChange[] = [];
  const open = new Set(input.days);
  let broughtIn = 0;

  while (changes.length < MAX_CHANGES_PER_UPDATE) {
    const inPlan = new Set(PLAN_DAYS.flatMap(d => (['breakfast', 'lunch', 'dinner'] as const).map(s => plan[d][s]?.id)).filter((id): id is number => id !== undefined));
    let best: { day: PlanDay; from: PlannedMeal; to: { recipe: PlannerRecipe; score: Score }; gain: number; fromScore: Score | null; weak: boolean } | null = null;
    for (const day of open) {
      const current = plan[day].dinner;
      // Empty days stay empty, and a day the household locked or filled by hand is never
      // touched, even if the caller listed it.
      if (!current || current.locked || current.chosen) continue;
      const currentRecipe = recipeOf(current.id);
      const fromScore = currentRecipe ? scoreRecipe(currentRecipe, taste) : null;
      const currentTotal = fromScore?.total ?? 0;
      const others = PLAN_DAYS.filter(d => d !== day).map(d => plan[d].dinner && recipeOf(plan[d].dinner!.id)).filter((r): r is PlannerRecipe => !!r);
      // How much a recipe repeats what the rest of the week already has.
      const sameness = (r: PlannerRecipe | undefined) => (r
        ? others.filter(o => o.category && o.category === r.category).length * SAME_CATEGORY_IN_WEEK + others.filter(o => o.area && o.area === r.area).length * SAME_AREA_IN_WEEK
        : 0);
      const currentSameness = sameness(currentRecipe);
      const weak = currentTotal <= WEAK_MEAL;
      for (const c of ranked) {
        // Ranked best first: once the taste gain is too small, nothing after it qualifies.
        const tasteGain = c.score.total - currentTotal;
        if (tasteGain < GAIN_TO_REPLACE) break;
        // Not what's already in the week, and not what the household just took out of it.
        if (inPlan.has(c.recipe.id) || taste.takenOut.has(c.recipe.id)) continue;
        if (maxMinutes && WEEKNIGHTS.has(day) && (c.recipe.total_minutes ?? Infinity) > maxMinutes) continue;
        // Taste decides whether a swap is worth making; variety only decides which one.
        const lovedAtTheTable = (taste.direct.get(c.recipe.id)?.lovedBy.length ?? 0) > 0 && c.score.direct >= LIKED_ITSELF;
        const liked = lovedAtTheTable || c.score.similar >= LIKED_BY_RESEMBLANCE;
        if (!weak && !(liked && broughtIn < MAX_BROUGHT_IN_PER_UPDATE)) continue;
        const gain = tasteGain - (sameness(c.recipe) - currentSameness);
        if (!best || gain > best.gain) best = { day, from: current, to: c, gain, fromScore, weak };
      }
    }
    if (!best) break;
    const to = asMeal(best.to.recipe);
    plan = { ...plan, [best.day]: { ...plan[best.day], dinner: to } };
    open.delete(best.day);
    if (!best.weak) broughtIn++;
    changes.push({ day: best.day, from: best.from, to, reason: changeReason(best.day, recipeOf(best.from.id), best.fromScore, best.to.recipe, best.to.score, taste) });
  }
  return { plan, changes };
}

/** The note shown when the daily update changed the plan. */
export const changeNote = (changes: readonly PlanChange[]): string | null => changes.map(c => c.reason).join(' ') || null;

// ── Which days may change, and what the household changed by hand ──────────

/**
 * The days the daily update may touch: after today, with a dinner that isn't locked,
 * wasn't put there by hand, hasn't been cooked, and has none of its ingredients checked
 * off the grocery list.
 */
export function openDays(plan: PlannerWeek, today: PlanDay, cooked: ReadonlySet<number>, shopped: ReadonlySet<number>): PlanDay[] {
  return PLAN_DAYS.slice(PLAN_DAYS.indexOf(today) + 1).filter(day => {
    const dinner = plan[day].dinner;
    return !!dinner && !dinner.locked && !dinner.chosen && !cooked.has(dinner.id) && !shopped.has(dinner.id);
  });
}

export interface PlanEdit { recipeId: number; kind: 'picked' | 'swapped_out' | 'removed'; day: PlanDay }

/** What an edit by hand says about taste. A meal moved to another day says nothing. */
export function planEdits(before: PlannerWeek | null, after: PlannerWeek): PlanEdit[] {
  const ids = (week: PlannerWeek | null) => new Set(week ? PLAN_DAYS.flatMap(d => Object.values(week[d]).flatMap(m => (m ? [m.id] : []))) : []);
  const was = ids(before);
  const is = ids(after);
  const edits: PlanEdit[] = [];
  for (const day of PLAN_DAYS) for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
    const old = before?.[day]?.[slot] ?? null;
    const now = after[day][slot];
    if (old && !is.has(old.id)) edits.push({ recipeId: old.id, kind: now ? 'swapped_out' : 'removed', day });
    if (now && !was.has(now.id)) edits.push({ recipeId: now.id, kind: 'picked', day });
  }
  return edits;
}

// ── Keeping a saved plan safe ──────────────────────────────────────────────
// A saved plan was only checked against the settings of the day it was made. These run
// again whenever it loads or the family's settings change, before any screen sees it.

/** The slots whose recipe the family can't eat, or that is no longer in the catalog. */
export function planFailures(plan: PlannerWeek, cards: ReadonlyMap<number, PlannerRecipe>, food: FoodPrefs): Array<{ day: PlanDay; slot: PlanSlot }> {
  const check = recipeChecker(food);
  return PLAN_DAYS.flatMap(day => (['breakfast', 'lunch', 'dinner'] as const).flatMap(slot => {
    const meal = plan[day][slot];
    if (!meal) return [];
    const card = cards.get(meal.id);
    return !card || !check(card).allowed ? [{ day, slot }] : [];
  }));
}

export interface PlanRepair { plan: PlannerWeek; changed: boolean; replaced: number; /** "day:slot" keys left empty. */ blocked: string[] }

/**
 * Replaces every meal the family can't eat with a safe one of the same kind from
 * `options`; with no safe replacement the slot goes empty. A lock doesn't protect a meal
 * from this: safety comes before the household's own lock.
 */
export function repairPlan(
  plan: PlannerWeek, cards: ReadonlyMap<number, PlannerRecipe>,
  options: { mains: readonly PlannerRecipe[]; breakfasts: readonly PlannerRecipe[] }, food: FoodPrefs,
): PlanRepair {
  const failed = planFailures(plan, cards, food);
  if (!failed.length) return { plan, changed: false, replaced: 0, blocked: [] };
  const check = recipeChecker(food);
  const used = new Set(PLAN_DAYS.flatMap(d => Object.values(plan[d]).flatMap(m => (m ? [m.id] : []))));
  let next = plan;
  let replaced = 0;
  const blocked: string[] = [];
  for (const { day, slot } of failed) {
    // Same rule as the week planner: a breakfast may repeat, a main may not.
    const pick = slot === 'breakfast'
      ? pickReplacement(options.breakfasts, check, used) ?? pickReplacement(options.breakfasts, check, new Set())
      : pickReplacement(options.mains, check, used);
    if (pick) { used.add(pick.id); replaced++; } else blocked.push(`${day}:${slot}`);
    next = { ...next, [day]: { ...next[day], [slot]: pick ? asMeal(pick) : null } };
  }
  return { plan: next, changed: true, replaced, blocked };
}

/**
 * Marks every meal that sits somewhere it didn't before as chosen by the household. Used
 * when the household edits the plan by hand, and when they undo an update: what they put
 * back is what they want.
 */
export function markChosen(before: PlannerWeek | null, after: PlannerWeek): PlannerWeek {
  const out = { ...after };
  for (const day of PLAN_DAYS) for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
    const meal = after[day][slot];
    if (meal && !meal.chosen && before?.[day]?.[slot]?.id !== meal.id) out[day] = { ...out[day], [slot]: { ...meal, chosen: true } };
  }
  return out;
}
