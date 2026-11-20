import { recipeIngredients } from './catalog';
import { recipeFacts, recipeNutrition } from './nutrition';
import type { FamilyMember } from './familyPrefs';
import type { WeekPlan, Day } from './plan';
import { householdDay, type DayMeal, type Eater, type PersonPortion } from './portions';

// Goals for each person (Pro): the day's shared meals, each person's portion sized toward
// their own goal, with estimated totals. The math is in portions.ts (pure, tested); this
// file loads the recipes' estimated nutrition for one day of the plan.

/** True when anyone in the family has a goal set. */
export const hasGoals = (members: readonly FamilyMember[]) => members.some(m => m.goal && m.goal !== 'none');

export const asEater = (m: FamilyMember): Eater => ({
  id: m.id, name: m.name, kind: m.kind, goal: m.goal ?? 'none', calories: m.goal_calories ?? null, protein: m.goal_protein ?? null, school_lunch: m.school_lunch,
});

const perServing = new Map<number, Promise<{ kcal: number; protein: number } | null>>();

/** One serving's estimated calories and protein, or null when it can't be estimated. Cached for the visit. */
function servingOf(id: number): Promise<{ kcal: number; protein: number } | null> {
  let p = perServing.get(id);
  if (!p) {
    p = (async () => {
      const [recipe] = await recipeIngredients([id]);
      if (!recipe?.ingredients?.length) return null;
      const facts = await recipeFacts(id, recipe.ingredients);
      if (!facts) return null;
      const n = recipeNutrition(recipe.ingredients, key => facts.get(key));
      // Mostly unknown ingredients would make the estimate misleading.
      if (!n.ingredients || n.counted / n.ingredients < 0.5 || !(n.perServing.kcal > 0)) return null;
      return { kcal: n.perServing.kcal, protein: n.perServing.protein };
    })().catch(err => { perServing.delete(id); throw err; });
    perServing.set(id, p);
  }
  return p;
}

export interface DayPortions { people: PersonPortion[]; /** Meal titles left out of the estimate. */ missing: string[] }

/** Each person's portion and estimated totals for one day of the plan. */
export async function portionsForDay(plan: WeekPlan, day: Day, members: readonly FamilyMember[]): Promise<DayPortions> {
  // Leftovers are eaten too: they count like any other meal.
  const all = (['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner'] as const).flatMap(s => { const entry = plan[day][s]; return entry ? [{ slot: s, entry }] : []; });
  const values = await Promise.all(all.map(e => servingOf(e.entry.id)));
  const meals: DayMeal[] = [];
  const missing: string[] = [];
  all.forEach((e, i) => {
    const v = values[i];
    if (v) meals.push({ slot: e.slot, kcal: v.kcal, protein: v.protein });
    else missing.push(e.entry.title);
  });
  return { people: householdDay(meals, members.map(asEater)), missing };
}
