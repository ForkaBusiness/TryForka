import { askJson } from '../_shared/claude.ts';
import { AppError, claimRequest, serve, userClient } from '../_shared/http.ts';
import { familyFood } from '../_shared/household.ts';
import { callerPlan } from '../_shared/billing/plan.ts';
import { recipeChecker, type FoodPrefs } from '../_shared/catalog/recipeFilter.ts';
import { formatMeasure, type UnitSystem } from '../_shared/catalog/units.ts';
import { safeHelp, tidyText } from '../_shared/cooking/help.ts';

// Meal prep (Forka Pro): the week's chosen recipes as one prep session.
//   { recipes: [{ id, servings }], units? } -> { tasks: PrepTask[], skipped: string[] }
// The recipes are read as the caller and must pass the family's filter. The model breaks
// them into prep tasks (what to cook ahead, how long, hands-on or not, what waits on what,
// how it keeps); the app orders them into a session of about an hour (src/lib/prepSchedule)
// and runs it in cooking mode. A task that mentions anything the family can't eat is left
// out. Pro only, with a daily cap.

const RATE_LIMIT = { kind: 'meal_prep', perMinute: 3, perDay: 10, noun: 'prep sessions' };
const MODEL = Deno.env.get('MEAL_PREP_MODEL') || 'claude-haiku-5-5';
const MAX_RECIPES = 6;

interface Ingredient { name: string; name_us?: string; quantity: number | null; quantity_max: number | null; unit: string; note: string }
interface Recipe { id: number; name: string; display_name: string | null; servings: number | null; ingredients: Ingredient[]; steps: Array<{ text_us: string; text_metric: string }>; allergens: string[]; diets: string[]; ingredient_names: string[] }

export interface PrepTaskOut { id: string; title: string; recipeId: number | null; minutes: number; handsOn: boolean; startMinutes?: number; after?: string[]; storage?: string }

const SYSTEM = `You plan a home cook's weekend meal-prep session from the recipes they'll eat this week.
Pick the parts worth doing ahead (cooking grains, sauces, braises and soups, roasting, chopping and marinating, washing and portioning), and leave what must be done just before eating.
Break them into 4 to 14 tasks for one cook. For each task: a short imperative "title" naming the recipe's food ("Roast the sweet potatoes"), "recipe_id", realistic "minutes" in total, "hands_on" (false for oven, simmering, chilling and marinating, which run on their own), "start_minutes" for a hands-off task (the cook's time to get it going, usually 2 to 5), "after" (ids of tasks that must finish first), and "storage" (how to keep it and for how long, in one short sentence, e.g. "Keeps 4 days in the fridge in a sealed container").
The whole session must fit about 60 minutes for one cook. Keep the hands-on minutes together under about 40: choose the prep that saves the most time on busy days (grains, a braise, soup or sauce that runs on its own, roasting, chopping for several meals at once, marinating) and leave quick or last-minute steps for the day itself. Hands-off tasks run while the cook does hands-on ones; a long braise may keep going after the session ends, which is fine. Don't split one recipe into many small hands-on tasks. Use only ingredients in the recipes; never add new ones. Plain, calm kitchen English: no emoji, no dashes as punctuation.`;

const SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, recipe_id: { type: 'integer' }, minutes: { type: 'integer' },
          hands_on: { type: 'boolean' }, start_minutes: { type: 'integer' }, after: { type: 'array', items: { type: 'string' } }, storage: { type: 'string' },
        },
        required: ['id', 'title', 'recipe_id', 'minutes', 'hands_on', 'start_minutes', 'after', 'storage'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

const line = (i: Ingredient, scale: number, units: UnitSystem) => {
  const amount = formatMeasure({ quantity: i.quantity, quantityMax: i.quantity_max, unit: i.unit, note: i.note }, units, scale);
  return `${i.name_us || i.name}${amount ? `, ${amount}` : ''}`;
};

serve(async (body, req) => {
  const db = userClient(req);
  if ((await callerPlan(db)).plan !== 'pro') throw new AppError('Meal prep is part of Pro.', 402);
  const units: UnitSystem = body.units === 'metric' ? 'metric' : 'us';
  const asked = (Array.isArray(body.recipes) ? body.recipes : []) as Array<{ id?: unknown; servings?: unknown }>;
  const wanted = asked.map(r => ({ id: Number(r.id), servings: Number(r.servings) })).filter(r => Number.isInteger(r.id) && r.id > 0).slice(0, MAX_RECIPES);
  if (!wanted.length) throw new AppError('Pick at least one meal to prep.', 400);

  const { data, error } = await db.from('recipes')
    .select('id, name, display_name, servings, ingredients, steps, allergens, diets, ingredient_names')
    .in('id', [...new Set(wanted.map(w => w.id))]);
  if (error) throw new AppError("Couldn't load the recipes. Try again.", 502);
  let prefs: FoodPrefs;
  try { prefs = await familyFood(db); } catch { throw new AppError("Couldn't load your family's settings. Try again.", 502); }
  const check = recipeChecker(prefs);
  const recipes = ((data ?? []) as Recipe[]).filter(r => check(r).allowed);
  if (!recipes.length) throw new AppError('None of these meals fit your family\'s settings.', 400);
  const skipped = wanted.filter(w => !recipes.some(r => r.id === w.id)).map(w => String(w.id));

  await claimRequest(db, RATE_LIMIT);
  const text = recipes.map(r => {
    const want = wanted.find(w => w.id === r.id)!;
    const base = r.servings ?? 4;
    const servings = Number.isInteger(want.servings) && want.servings >= 1 && want.servings <= 20 ? want.servings : base;
    const scale = servings / base;
    const steps = r.steps.map((s, i) => `${i + 1}. ${units === 'metric' ? s.text_metric : s.text_us}`).join('\n').slice(0, 2500);
    return `Recipe ${r.id}: ${r.display_name || r.name}, for ${servings} servings\nIngredients:\n${r.ingredients.map(i => `- ${line(i, scale, units)}`).join('\n')}\nSteps:\n${steps}`;
  }).join('\n\n');

  const out = await askJson<{ tasks: Array<{ id: string; title: string; recipe_id: number; minutes: number; hands_on: boolean; start_minutes: number; after: string[]; storage: string }> }>({
    system: SYSTEM,
    content: `${text}\n\nUnits: ${units === 'metric' ? 'metric' : 'US cups and spoons'}.`,
    schema: SCHEMA,
    maxTokens: 8000,
    effort: 'low',
    model: MODEL,
    label: 'meal-prep',
  });

  const known = new Set(recipes.map(r => r.id));
  let tasks: PrepTaskOut[] = (out.tasks ?? []).slice(0, 16).map((t, i) => ({
    id: String(t.id || `t${i + 1}`).slice(0, 40),
    title: tidyText(t.title ?? '').slice(0, 120),
    recipeId: known.has(t.recipe_id) ? t.recipe_id : null,
    minutes: Math.min(240, Math.max(1, Math.round(Number(t.minutes) || 0))),
    handsOn: t.hands_on !== false,
    ...(t.hands_on === false ? { startMinutes: Math.min(15, Math.max(1, Math.round(Number(t.start_minutes) || 3))) } : {}),
    after: (Array.isArray(t.after) ? t.after : []).map(String),
    storage: tidyText(t.storage ?? '').slice(0, 160) || undefined,
  })).filter(t => t.title);
  // Nothing the family can't eat, even in passing; then drop links to tasks that are gone.
  tasks = safeHelp(tasks, prefs, t => ({ uses: [], text: [t.title, t.storage ?? ''] }));
  const ids = new Set(tasks.map(t => t.id));
  tasks = tasks.map(t => ({ ...t, after: (t.after ?? []).filter(a => ids.has(a) && a !== t.id) }));
  console.log(`[meal-prep] ${recipes.length} recipes, ${out.tasks?.length ?? 0} tasks suggested, ${tasks.length} kept`);
  if (!tasks.length) throw new AppError("Couldn't plan a prep session for these meals. Try different ones.", 502);
  return { tasks, skipped };
});
