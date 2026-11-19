import { askJson } from '../_shared/claude.ts';
import { AppError, claimRequest, serve, userClient } from '../_shared/http.ts';
import { familyFood } from '../_shared/household.ts';
import { BASE_SERVINGS } from '../_shared/nutrition.ts';
import { allergyLabel, recipeChecker, type FoodPrefs } from '../_shared/catalog/recipeFilter.ts';
import { formatMeasure, type UnitSystem } from '../_shared/catalog/units.ts';
import { safeSwaps, safeVariations, tableSwaps, tidyText, type Swap, type Variation } from '../_shared/cooking/help.ts';

// Cooking help, from cooking mode.
//   { mode: "substitute", recipe_id, ingredient, servings?, units? } -> { missing, swaps: Swap[], source: "table" | "model" }
//   { mode: "variations", recipe_id, servings?, units? }              -> { variations: Variation[] }
// The recipe is read as the caller, so a household's own recipe is only found by them, and
// it must pass the family's filter. Common swaps come from the built-in table
// (_shared/cooking/help.ts) without a model call and without counting toward the cap; the
// rest go to the model. Every answer, from the table or the model, passes the family's
// filter before it is sent (the app checks it again). Model requests count toward a daily
// cap per user (claim_request, kind 'cooking_help'), and each answered variations request
// is counted with record_usage('recipe_variations') for Phase 4's plans. Nothing about the
// recipe is logged.

const RATE_LIMIT = { kind: 'cooking_help', perMinute: 6, perDay: 30, noun: 'cooking help' };
const MODEL = Deno.env.get('COOKING_HELP_MODEL') || 'claude-haiku-5-5';
const MAX_STEPS_CHARS = 2500;
const ON_HAND_DAYS = 7;

interface Ingredient { name: string; name_us?: string; quantity: number | null; quantity_max: number | null; unit: string; note: string }
interface Recipe {
  id: number; name: string; display_name: string | null; servings: number | null;
  ingredients: Ingredient[]; steps: Array<{ text_us: string; text_metric: string }>;
  allergens: string[]; diets: string[]; ingredient_names: string[];
}

const ingredientName = (i: Ingredient) => i.name_us || i.name;

/** "Buttermilk, 1 1/2 cups" at the chosen servings, in the household's units. */
function line(i: Ingredient, scale: number, units: UnitSystem): string {
  const amount = formatMeasure({ quantity: i.quantity, quantityMax: i.quantity_max, unit: i.unit, note: i.note }, units, scale);
  return amount ? `${ingredientName(i)}, ${amount}` : ingredientName(i);
}

function recipeText(recipe: Recipe, scale: number, units: UnitSystem, servings: number): string {
  let steps = recipe.steps.map((s, i) => `${i + 1}. ${units === 'metric' ? s.text_metric : s.text_us}`).join('\n');
  if (steps.length > MAX_STEPS_CHARS) steps = `${steps.slice(0, MAX_STEPS_CHARS)}…`;
  return `Recipe: ${recipe.display_name || recipe.name}, for ${servings} servings.\nIngredients:\n${recipe.ingredients.map(i => `- ${line(i, scale, units)}`).join('\n')}\nSteps:\n${steps}`;
}

/** What must never be suggested, for the prompt. The filter after the answer is what's enforced. */
function avoidText(prefs: FoodPrefs): string {
  const lines: string[] = [];
  if (prefs.allergies.length) lines.push(`Someone in the family is allergic to: ${prefs.allergies.map(a => allergyLabel(a).toLowerCase()).join(', ')}. Never suggest or mention anything that contains these, even as an option.`);
  if (prefs.skip_ingredients.length) lines.push(`The family never eats: ${prefs.skip_ingredients.join(', ')}. Never suggest these.`);
  if (prefs.diet && prefs.diet !== 'none') lines.push(`The family is ${prefs.diet}. Everything suggested must be ${prefs.diet}.`);
  if (prefs.avoid_ingredients?.length) lines.push(`They'd rather avoid: ${prefs.avoid_ingredients.join(', ')}.`);
  return lines.join('\n');
}

const VOICE = 'Write plainly, like a calm friend in the kitchen: short sentences, US kitchen English, no emoji, no dashes as punctuation, no exclamation marks.';

const SUBSTITUTE_SYSTEM = `You help a home cook who is partway through a recipe and has just found they are missing one ingredient.
Suggest up to 3 substitutions that work in this specific recipe, best first, using things most home kitchens have. Give the amount for what the recipe needs, in the units given. If the dish works without it, one option can be to leave it out and what to do instead.
${VOICE}
For each: "use" says what to use with its amount, starting with "Use" (or "Leave it out"); "how" says in one or two sentences how to use it and what changes; "uses" lists each ingredient it uses, by name.`;

const VARIATIONS_SYSTEM = `You suggest a few ways a family can make a recipe a little different tonight, without starting over.
Suggest 3 variations: different flavors, a swap of the main vegetable or protein, a topping or side folded in. Prefer ingredients the family has on hand or likes, when they fit. Keep the method the same as far as possible.
${VOICE}
For each: a short "title" (2 to 5 words), a one-sentence "summary", "changes" as 2 to 4 short instructions with amounts, "adds" listing each ingredient it adds by name, and "removes" listing each ingredient it leaves out.`;

const SWAPS_SCHEMA = {
  type: 'object',
  properties: {
    swaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { use: { type: 'string' }, how: { type: 'string' }, uses: { type: 'array', items: { type: 'string' } } },
        required: ['use', 'how', 'uses'],
        additionalProperties: false,
      },
    },
  },
  required: ['swaps'],
  additionalProperties: false,
};

const VARIATIONS_SCHEMA = {
  type: 'object',
  properties: {
    variations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' }, summary: { type: 'string' },
          changes: { type: 'array', items: { type: 'string' } },
          adds: { type: 'array', items: { type: 'string' } },
          removes: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'summary', 'changes', 'adds', 'removes'],
        additionalProperties: false,
      },
    },
  },
  required: ['variations'],
  additionalProperties: false,
};

const words = (list: unknown, max: number) => (Array.isArray(list) ? list : []).filter((s): s is string => typeof s === 'string')
  .map(s => tidyText(s).slice(0, 200)).filter(Boolean).slice(0, max);

/** What the household wants used up (it counts for a week) and what the family likes. */
async function pantry(db: ReturnType<typeof userClient>): Promise<{ onHand: string[]; likes: string[] }> {
  const [{ data: prefs }, { data: members }] = await Promise.all([
    db.from('user_preferences').select('on_hand, on_hand_at').maybeSingle(),
    db.from('family_members').select('likes'),
  ]);
  const at = prefs?.on_hand_at ? new Date(prefs.on_hand_at as string).getTime() : 0;
  const onHand = at && Date.now() - at < ON_HAND_DAYS * 86_400_000 ? ((prefs?.on_hand as string[] | null) ?? []) : [];
  const likes = [...new Set(((members ?? []) as Array<{ likes: string[] | null }>).flatMap(m => m.likes ?? []))];
  return { onHand: onHand.slice(0, 30), likes: likes.slice(0, 30) };
}

serve(async (body, req) => {
  const db = userClient(req);
  const mode = body.mode;
  if (mode !== 'substitute' && mode !== 'variations') throw new AppError('Unknown request.', 400);
  const recipeId = Number(body.recipe_id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) throw new AppError('Unknown recipe.', 400);
  const units: UnitSystem = body.units === 'metric' ? 'metric' : 'us';

  const { data, error } = await db.from('recipes')
    .select('id, name, display_name, servings, ingredients, steps, allergens, diets, ingredient_names')
    .eq('id', recipeId).maybeSingle();
  if (error) throw new AppError("Couldn't load the recipe. Try again.", 502);
  if (!data) throw new AppError('Unknown recipe.', 404);
  const recipe = data as Recipe;
  let prefs: FoodPrefs;
  try { prefs = await familyFood(db); } catch { throw new AppError("Couldn't load your family's settings. Try again.", 502); }
  if (!recipeChecker(prefs)(recipe).allowed) throw new AppError("This recipe is hidden for your family's settings.", 403);

  const base = recipe.servings ?? BASE_SERVINGS;
  const asked = Number(body.servings);
  const servings = Number.isInteger(asked) && asked >= 1 && asked <= 20 ? asked : base;
  const scale = servings / base;

  if (mode === 'substitute') {
    const index = Number(body.ingredient);
    const ing = Number.isInteger(index) ? recipe.ingredients[index] : undefined;
    if (!ing) throw new AppError('Unknown ingredient.', 400);
    // The table first: no model call, nothing counted.
    const table = tableSwaps(ing, scale, units);
    const fromTable = table ? safeSwaps(table.swaps, prefs) : [];
    if (table && fromTable.length) return { missing: table.missing, swaps: fromTable, source: 'table' };

    await claimRequest(db, RATE_LIMIT);
    const { onHand } = await pantry(db).catch(() => ({ onHand: [] as string[], likes: [] as string[] }));
    const missing = table?.missing ?? ingredientName(ing).toLowerCase();
    const out = await askJson<{ swaps: Swap[] }>({
      system: SUBSTITUTE_SYSTEM,
      content: `${recipeText(recipe, scale, units, servings)}\n\nMissing: ${line(ing, scale, units)}\nUnits: ${units === 'metric' ? 'metric' : 'US cups and spoons'}\n${onHand.length ? `They have on hand: ${onHand.join(', ')}.\n` : ''}${avoidText(prefs)}`,
      schema: SWAPS_SCHEMA,
      maxTokens: 700,
      effort: 'low',
      model: MODEL,
      label: 'cooking-help substitute',
    });
    const swaps = safeSwaps((out.swaps ?? []).slice(0, 4).map(s => ({ use: tidyText(s.use ?? '').slice(0, 240), how: tidyText(s.how ?? '').slice(0, 400), uses: words(s.uses, 8) }))
      .filter(s => s.use), prefs).slice(0, 3);
    console.log(`[cooking-help] substitute: ${out.swaps?.length ?? 0} suggested, ${swaps.length} safe`);
    return { missing, swaps, source: 'model' };
  }

  await claimRequest(db, RATE_LIMIT);
  const { onHand, likes } = await pantry(db).catch(() => ({ onHand: [] as string[], likes: [] as string[] }));
  const out = await askJson<{ variations: Variation[] }>({
    system: VARIATIONS_SYSTEM,
    content: `${recipeText(recipe, scale, units, servings)}\n\nUnits: ${units === 'metric' ? 'metric' : 'US cups and spoons'}\n${onHand.length ? `They have on hand and want to use up: ${onHand.join(', ')}.\n` : ''}${likes.length ? `The family likes: ${likes.join(', ')}.\n` : ''}${avoidText(prefs)}`,
    schema: VARIATIONS_SCHEMA,
    maxTokens: 1400,
    effort: 'low',
    model: MODEL,
    label: 'cooking-help variations',
  });
  const variations = safeVariations((out.variations ?? []).slice(0, 5).map(v => ({
    title: tidyText(v.title ?? '').slice(0, 60),
    summary: tidyText(v.summary ?? '').slice(0, 240),
    changes: words(v.changes, 5),
    adds: words(v.adds, 10),
    removes: words(v.removes, 10),
  })).filter(v => v.title && v.changes.length), prefs).slice(0, 3);
  console.log(`[cooking-help] variations: ${out.variations?.length ?? 0} suggested, ${variations.length} safe`);
  // Counted for Phase 4's plans; never blocks or fails the answer.
  if (variations.length) {
    const { error: usageError } = await db.rpc('record_usage', { p_kind: 'recipe_variations' });
    if (usageError) console.error('[cooking-help] usage not counted:', usageError.message);
  }
  return { variations, onHand };
});
