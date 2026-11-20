// Portions: shared family meals, each person's portion sized toward their own goal.
// Meals stay the same for everyone; only the amount on each plate changes.
// These are planning estimates, never medical advice.
// No imports on purpose: the tests run this file directly under node --experimental-strip-types.

export type MemberKind = 'adult' | 'kid';
export type GoalKind = 'none' | 'calories' | 'protein' | 'more_protein' | 'lighter' | 'growing_kid';

export interface PersonGoal {
  id: string;
  name: string;
  kind: MemberKind;
  goal: GoalKind;
  /** kcal per day, only for goal 'calories' */
  calories?: number | null;
  /** grams per day, only for goal 'protein' */
  protein?: number | null;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface PlannedMealNutrition {
  slot: MealSlot;
  /** per one serving, estimated */
  kcal: number;
  protein: number;
}

/** Which goals each kind of person may choose. Kids: general goals only, never numeric targets. */
export const GOALS_FOR: Record<MemberKind, GoalKind[]> = {
  adult: ['none', 'calories', 'protein', 'more_protein', 'lighter', 'growing_kid'],
  kid: ['none', 'more_protein', 'growing_kid'],
};

export const LIMITS = {
  adultMinCalories: 1200,
  adultMaxCalories: 4000,
  minProtein: 20,
  maxProtein: 250,
  minPortion: 0.5,
  maxPortion: 2,
  portionStep: 0.25,
} as const;

/** Share of a day's eating each planned meal stands for: breakfast 0.25, lunch 0.3, dinner 0.35, snack 0.1. */
export const MEAL_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.35,
  snack: 0.1,
};

/** Default daily amounts used by the general goals. */
export const DEFAULT_TARGETS: Record<MemberKind, { kcal: number; protein: number }> = {
  adult: { kcal: 2000, protein: 60 },
  kid: { kcal: 1600, protein: 35 },
};

const LIGHTER_FACTOR = 0.85;
const MORE_PROTEIN_FACTOR = 1.3;
const NEAR_TOLERANCE = 0.1;

const NUMERIC_GOALS: GoalKind[] = ['calories', 'protein'];
/** Goals whose portion follows protein rather than calories. */
const PROTEIN_LED_GOALS: GoalKind[] = ['protein', 'more_protein'];

/** 1200 -> "1,200", without depending on the runtime locale. */
function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function isNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Checks a goal before it's saved. Never allows a calorie target under the safe minimum, or any numeric target for a kid. */
export function validateGoal(p: PersonGoal): { ok: true; goal: PersonGoal } | { ok: false; message: string } {
  const kind: MemberKind = p.kind === 'kid' ? 'kid' : 'adult';
  if (!(GOALS_FOR.adult as string[]).includes(p.goal)) {
    return { ok: false, message: 'Please choose one of the listed goals.' };
  }
  if (!GOALS_FOR[kind].includes(p.goal)) {
    if (kind === 'kid' && NUMERIC_GOALS.includes(p.goal)) {
      return {
        ok: false,
        message: 'For kids, Forka offers general goals only, like more protein or growing well. Number targets are for adults.',
      };
    }
    return { ok: false, message: 'For kids, please choose more protein, growing well, or no goal.' };
  }

  if (p.goal === 'calories') {
    const kcal = p.calories;
    if (!isNumber(kcal)) return { ok: false, message: 'Please enter a daily calorie target in kcal.' };
    if (kcal < LIMITS.adultMinCalories) {
      return {
        ok: false,
        message: `Forka plans daily calorie targets from ${groupThousands(LIMITS.adultMinCalories)} kcal. Please choose ${groupThousands(LIMITS.adultMinCalories)} or more.`,
      };
    }
    if (kcal > LIMITS.adultMaxCalories) {
      return {
        ok: false,
        message: `Forka plans daily calorie targets up to ${groupThousands(LIMITS.adultMaxCalories)} kcal. Please choose ${groupThousands(LIMITS.adultMaxCalories)} or less.`,
      };
    }
    return { ok: true, goal: { ...p, kind, calories: Math.round(kcal), protein: null } };
  }

  if (p.goal === 'protein') {
    const grams = p.protein;
    if (!isNumber(grams)) return { ok: false, message: 'Please enter a daily protein target in grams.' };
    if (grams < LIMITS.minProtein || grams > LIMITS.maxProtein) {
      return {
        ok: false,
        message: `Please choose a daily protein target between ${LIMITS.minProtein} g and ${LIMITS.maxProtein} g.`,
      };
    }
    return { ok: true, goal: { ...p, kind, calories: null, protein: Math.round(grams) } };
  }

  // General goals carry no numbers of their own.
  return { ok: true, goal: { ...p, kind, calories: null, protein: null } };
}

/** The person's daily targets: numeric goals as given; general goals from defaults (adult 2000 kcal / 60 g protein, kid 1600 kcal / 35 g); 'lighter' = 85% of the default calories but never under the adult minimum; 'more_protein' = default protein x 1.3; 'growing_kid' = kid defaults (portion never below 1 for that person). 'none' => null targets. An invalid goal is treated as 'none'. */
export function dailyTargets(p: PersonGoal): { kcal: number | null; protein: number | null } {
  const checked = validateGoal(p);
  if (!checked.ok) return { kcal: null, protein: null };
  const g = checked.goal;
  const defaults = DEFAULT_TARGETS[g.kind];
  switch (g.goal) {
    case 'calories':
      return { kcal: g.calories ?? null, protein: null };
    case 'protein':
      return { kcal: null, protein: g.protein ?? null };
    case 'lighter':
      return {
        kcal: Math.max(Math.round(defaults.kcal * LIGHTER_FACTOR), LIMITS.adultMinCalories),
        protein: defaults.protein,
      };
    case 'more_protein':
      return { kcal: defaults.kcal, protein: Math.round(defaults.protein * MORE_PROTEIN_FACTOR) };
    case 'growing_kid':
      return { ...DEFAULT_TARGETS.kid };
    case 'none':
    default:
      return { kcal: null, protein: null };
  }
}

export interface PersonPortion {
  id: string;
  name: string;
  portion: number;
  /** estimated intake from the planned meals at this portion */
  planned: { kcal: number; protein: number };
  /** the target for the share of the day these meals stand for, null when no goal */
  target: { kcal: number | null; protein: number | null };
  /** true when planned is within 10% of the target (or there is no target) */
  near: boolean;
}

/** Rounds to the nearest portionStep and keeps it inside [min, maxPortion]. */
function snapPortion(raw: number, min: number): number {
  const step = LIMITS.portionStep;
  const snapped = Math.round(raw / step) * step;
  return Math.min(LIMITS.maxPortion, Math.max(min, snapped));
}

/** One day's shared meals: each person's portion so the planned meals cover their target's share. Portion is the same for every meal of that day, rounded to the nearest portionStep, kept within [minPortion, maxPortion], and never below 1 for growing_kid. Calorie goals drive the portion; protein goals ('protein' and 'more_protein') drive it by protein. An invalid goal is treated as 'none'. With no planned meals, portion 1 and zero totals. */
export function dayPortions(meals: PlannedMealNutrition[], people: PersonGoal[]): PersonPortion[] {
  let kcalPerServing = 0;
  let proteinPerServing = 0;
  let share = 0;
  for (const meal of meals) {
    kcalPerServing += isNumber(meal.kcal) && meal.kcal > 0 ? meal.kcal : 0;
    proteinPerServing += isNumber(meal.protein) && meal.protein > 0 ? meal.protein : 0;
    share += MEAL_SHARE[meal.slot] ?? 0;
  }
  share = Math.min(1, share);
  const hasMeals = meals.length > 0;

  return people.map((person) => {
    const checked = validateGoal(person);
    const goal: GoalKind = checked.ok ? checked.goal.goal : 'none';
    const daily = dailyTargets(person);
    const target = {
      kcal: daily.kcal === null ? null : Math.round(daily.kcal * share),
      protein: daily.protein === null ? null : roundTo(daily.protein * share, 1),
    };

    // Which number this person's portion follows.
    let driver: 'kcal' | 'protein' | null = null;
    if (PROTEIN_LED_GOALS.includes(goal) && target.protein !== null) driver = 'protein';
    else if (target.kcal !== null) driver = 'kcal';
    else if (target.protein !== null) driver = 'protein';

    const floor = goal === 'growing_kid' ? Math.max(1, LIMITS.minPortion) : LIMITS.minPortion;
    let portion = 1;
    if (hasMeals && driver === 'kcal' && kcalPerServing > 0) {
      portion = snapPortion((target.kcal as number) / kcalPerServing, floor);
    } else if (hasMeals && driver === 'protein' && proteinPerServing > 0) {
      portion = snapPortion((target.protein as number) / proteinPerServing, floor);
    } else {
      portion = Math.max(floor, 1);
    }

    const planned = {
      kcal: Math.round(portion * kcalPerServing),
      protein: roundTo(portion * proteinPerServing, 1),
    };

    let near = true;
    if (hasMeals && driver !== null) {
      const goalAmount = target[driver] as number;
      near = Math.abs(planned[driver] - goalAmount) <= goalAmount * NEAR_TOLERANCE;
    }

    return { id: person.id, name: person.name, portion, planned, target, near };
  });
}

/** Servings to cook for a shared meal: the sum of everyone's portions, rounded up to the nearest 0.5 (at least 1). The grocery list uses this. */
export function servingsToCook(portions: Pick<PersonPortion, 'portion'>[]): number {
  const total = portions.reduce((sum, p) => sum + (isNumber(p.portion) && p.portion > 0 ? p.portion : 0), 0);
  // The small epsilon keeps float noise (2.0000000001) from rounding up a whole half serving.
  const rounded = Math.ceil(total * 2 - 1e-9) / 2;
  return Math.max(1, rounded);
}

// ── A household's day ──────────────────────────────────────────────────────

/** A planned meal of the day as the plan holds it, with its estimated nutrition per serving. */
export interface DayMeal { slot: 'breakfast' | 'school_lunch' | 'lunch' | 'snack' | 'dinner'; kcal: number; protein: number }

export type Eater = PersonGoal & { school_lunch?: boolean | null };

/** The meals one person eats that day: a child who takes a school lunch has it instead of the home lunch; nobody else has the school lunch. */
export function mealsFor(person: Eater, meals: readonly DayMeal[]): PlannedMealNutrition[] {
  const packed = person.kind === 'kid' && !!person.school_lunch && meals.some(m => m.slot === 'school_lunch');
  return meals.flatMap(m => {
    if (m.slot === 'school_lunch') return packed ? [{ slot: 'lunch' as const, kcal: m.kcal, protein: m.protein }] : [];
    if (m.slot === 'lunch' && packed) return [];
    return [{ slot: m.slot, kcal: m.kcal, protein: m.protein }];
  });
}

/** Each person's portion and estimated totals for one day of shared meals (see dayPortions). */
export function householdDay(meals: readonly DayMeal[], people: readonly Eater[]): PersonPortion[] {
  return people.map(p => dayPortions(mealsFor(p, meals), [p])[0]);
}

/** "1 portion", "1¼ portions", "½ portion". */
export function portionLabel(portion: number): string {
  const whole = Math.floor(portion);
  const frac = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round((portion - whole) * 4) / 4 as 0 | 0.25 | 0.5 | 0.75] ?? '';
  const n = `${whole || !frac ? whole : ''}${frac}`;
  return `${n} ${portion === 1 || portion < 1 ? 'portion' : 'portions'}`;
}

/** The one line shown with every estimate. */
export const ESTIMATE_NOTE = 'Estimates from the recipes, to help plan portions. Not medical or nutrition advice: for a health condition, follow your doctor or dietitian.';
