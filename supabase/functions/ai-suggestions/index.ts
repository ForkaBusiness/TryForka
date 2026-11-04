import { askJson } from '../_shared/claude.ts';
import { AppError, claimRequest, serve, userClient } from '../_shared/http.ts';
import { ALLERGEN_LABELS, ingredientAllergens } from '../_shared/catalog/allergens.ts';
import { allergyFamilies, allergyLabel, filterRecipes, recipeChecker, type FoodPrefs } from '../_shared/catalog/recipeFilter.ts';

// Suggestions and week plans, picked from the recipe catalog.
//   { mode: "suggestions", prompt, slot?, exclude? } -> { picks: [{ recipe, reason }] }
//   { mode: "week" }                                  -> { plan: { monday: { breakfast, lunch, dinner }, … } }
// Candidates come from safe_recipes() called as the user and then pass through the recipe
// filter, so allergies, diet and skipped ingredients are out before Claude sees anything.
// Claude only chooses among those ids, and every id it returns is checked against the
// list. The exclusions also go in the prompt, but the filter is what's enforced.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const WEEKNIGHTS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
type Slot = 'breakfast' | 'lunch' | 'dinner';

const RATE_LIMIT = { kind: 'suggestions', perMinute: 5, perDay: 50, noun: 'suggestions' };
const CARD_COLUMNS = 'id, name, display_name, subtitle, category, area, thumb_url, total_minutes, meal_role, allergens, diets, ingredient_names';

interface Card {
  id: number; name: string; display_name: string | null; subtitle: string | null; category: string | null;
  area: string | null; thumb_url: string | null; total_minutes: number | null; meal_role: string;
  allergens: string[]; diets: string[]; ingredient_names: string[];
}

const SYSTEM = `You help a busy family decide what to cook. You only ever choose recipes from the numbered list in the request, by id. Never invent recipes.
The list is already filtered for the family's allergies, diet and the ingredients they skip, so any listed recipe is safe for them.
Each line is: id | name | cuisine | category | minutes.`;

const line = (c: Card) => `${c.id} | ${c.display_name ?? c.name} | ${c.area ?? ''} | ${c.category ?? ''} | ${c.total_minutes ?? '?'}`;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function candidates(db: ReturnType<typeof userClient>, roles: string[], prefs: FoodPrefs): Promise<Card[]> {
  const { data, error } = await db.rpc('safe_recipes').select(CARD_COLUMNS).in('meal_role', roles);
  if (error) {
    console.error('[suggestions] safe_recipes failed:', error);
    throw new AppError("Couldn't load recipes. Try again.", 502);
  }
  return filterRecipes((data ?? []) as Card[], prefs);
}

async function foodPrefs(db: ReturnType<typeof userClient>): Promise<FoodPrefs> {
  const { data } = await db.from('user_preferences').select('diet, allergies, skip_ingredients, avoid_ingredients').maybeSingle();
  return {
    diet: (data?.diet as string) ?? 'none',
    allergies: (data?.allergies as string[]) ?? [],
    skip_ingredients: (data?.skip_ingredients as string[]) ?? [],
    avoid_ingredients: (data?.avoid_ingredients as string[]) ?? [],
  };
}

/** Tells Claude what's been filtered out, so a reason never claims a recipe contains it. */
function avoidLine(prefs: FoodPrefs): string {
  const lines: string[] = [];
  if (prefs.allergies.length) lines.push(`The household is allergic to ${prefs.allergies.map(a => allergyLabel(a).toLowerCase()).join(', ')}. None of the listed recipes contain these. Never say or suggest a recipe contains them, even if the request asks for them.`);
  if (prefs.skip_ingredients.length) lines.push(`Never pick a recipe with these ingredients: ${prefs.skip_ingredients.join(', ')}.`);
  if (prefs.avoid_ingredients?.length) lines.push(`Avoid these ingredients if you can: ${prefs.avoid_ingredients.join(', ')}.`);
  return lines.join('\n');
}

async function tasteHints(db: ReturnType<typeof userClient>): Promise<string> {
  const [{ data: favs }, { data: rated }] = await Promise.all([
    db.from('favorites').select('recipe_title').order('created_at', { ascending: false }).limit(15),
    db.from('recipe_ratings').select('recipe_id, rating').gte('rating', 4).limit(15),
  ]);
  const names = (favs ?? []).map(f => f.recipe_title as string);
  const parts = [];
  if (names.length) parts.push(`Recipes they saved as favorites: ${names.join(', ')}.`);
  if ((rated ?? []).length) parts.push(`Recipe ids they rated 4 or 5 stars: ${(rated ?? []).map(r => r.recipe_id).join(', ')}.`);
  return parts.join('\n');
}

/** "Thai green curry, aromatic and quick." -> "Aromatic and quick" (the name is already shown). */
function tidyReason(reason: string, card: Card): string {
  let r = reason.trim().replace(/[.!]+$/, '');
  for (const name of [card.display_name, card.name]) {
    if (name && r.toLowerCase().startsWith(name.toLowerCase())) r = r.slice(name.length).replace(/^[\s,:;\-–]+(is |are |offers |features )?/i, '');
  }
  return r.charAt(0).toUpperCase() + r.slice(1);
}

async function suggestions(db: ReturnType<typeof userClient>, body: Record<string, unknown>) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 300) : '';
  if (!prompt) throw new AppError('Type what sounds good first.', 400);
  const slot = (['breakfast', 'lunch', 'dinner'] as const).find(s => s === body.slot);
  const exclude = new Set(Array.isArray(body.exclude) ? body.exclude.map(Number) : []);
  const roles = slot === 'breakfast' ? ['breakfast'] : slot ? ['main'] : ['main', 'breakfast'];
  const prefs = await foodPrefs(db);
  const list = (await candidates(db, roles, prefs)).filter(c => !exclude.has(c.id));
  if (!list.length) throw new AppError('No recipes match your settings. Check your allergies and skipped ingredients in Settings.', 404);
  const pool = shuffle(list).slice(0, 400);
  const byId = new Map(pool.map(c => [c.id, c]));
  const hints = await tasteHints(db);
  const allergies = prefs.allergies.flatMap(allergyFamilies);
  // Asking for something they're allergic to ("peanut noodles"): say why it's not there.
  // Adjectives too: "creamy cheesy pasta" asks for dairy and gluten.
  const promptText = prompt.replace(/\b(cream|chees|butter|milk|nutt|egg|bread|flour)(y|ie)\b/gi, '$1');
  const asked = ingredientAllergens(promptText.replace(/\bchees\b/gi, 'cheese')).filter(a => allergies.includes(a));
  const note = asked.length
    ? `You marked ${asked.map(a => ALLERGEN_LABELS[a].toLowerCase()).join(' and ')} as an allergy, so these recipes leave it out.`
    : null;
  const out = await askJson<{ picks: Array<{ id: number; reason: string }> }>({
    system: SYSTEM,
    content: `${hints}\n${avoidLine(prefs)}\n${slot ? `They're choosing a ${slot}.` : ''}\nThey asked: "${prompt}"\n\nPick the 6 to 8 recipes that best fit the request, best first. For each, give a reason of at most 10 words saying why it fits the request, in plain kitchen English. Don't repeat the recipe name, don't start with it, and don't use exclamation marks. Good: "Ready in 20 minutes and mild enough for kids".\n\n${pool.map(line).join('\n')}`,
    schema: {
      type: 'object',
      properties: {
        picks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'integer' }, reason: { type: 'string' } },
            required: ['id', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['picks'],
      additionalProperties: false,
    },
    maxTokens: 500,
    label: 'suggestions',
  });
  const seen = new Set<number>();
  const picks = out.picks
    .filter(p => byId.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 8)
    .map(p => ({ recipe: byId.get(p.id)!, reason: tidyReason(p.reason, byId.get(p.id)!) }));
  return { picks, note };
}

async function week(db: ReturnType<typeof userClient>) {
  const { data: prefs } = await db.from('user_preferences')
    .select('plan_breakfast, plan_lunch, plan_dinner, max_weeknight_minutes').maybeSingle();
  const slots: Slot[] = [];
  if (prefs?.plan_breakfast) slots.push('breakfast');
  if (prefs?.plan_lunch) slots.push('lunch');
  if (prefs?.plan_dinner ?? true) slots.push('dinner');
  if (!slots.length) slots.push('dinner');
  const maxWeeknight: number | null = prefs?.max_weeknight_minutes ?? null;

  const food = await foodPrefs(db);
  const check = recipeChecker(food);
  const all = await candidates(db, ['main', 'breakfast'], food);
  // filterRecipes puts "avoid if possible" recipes last, so reshuffle within each group.
  const ranked = (role: string) => filterRecipes(shuffle(all.filter(c => c.meal_role === role)), food);
  const mains = ranked('main').slice(0, 260);
  const breakfasts = ranked('breakfast');
  if (!mains.length) throw new AppError('No recipes match your settings. Check your allergies and skipped ingredients in Settings.', 404);
  const byId = new Map([...mains, ...breakfasts].map(c => [c.id, c]));

  // Last week's lunches and dinners (the plan being replaced), to avoid repeating them.
  const { data: current } = await db.from('week_plans').select('plan').maybeSingle();
  const lastWeek = new Set<number>();
  for (const day of Object.values((current?.plan ?? {}) as Record<string, Record<string, { id: number } | null>>)) {
    for (const [slot, entry] of Object.entries(day ?? {})) if (slot !== 'breakfast' && entry?.id) lastWeek.add(entry.id);
  }

  const daySchema = {
    type: 'object',
    properties: Object.fromEntries(slots.map(s => [s, { type: 'integer' }])),
    required: slots,
    additionalProperties: false,
  };
  const rules = [
    `Plan ${slots.join(', ')} for each day, Monday to Sunday.`,
    slots.includes('breakfast') ? 'Breakfasts come from the breakfast list. Repeating a breakfast is fine if the list is short.' : '',
    'Lunches and dinners come from the mains list. Never use the same main twice in the week.',
    lastWeek.size ? `Avoid these ids, eaten last week, unless there's nothing else: ${[...lastWeek].join(', ')}.` : '',
    maxWeeknight ? `Monday to Friday dinners must take ${maxWeeknight} minutes or less. Weekend dinners can take longer.` : '',
    'Vary cuisines and main ingredients across the week, and keep it family-friendly.',
  ].filter(Boolean).join('\n');
  const hints = await tasteHints(db);
  const out = await askJson<{ plan: Record<string, Partial<Record<Slot, number>>> }>({
    system: SYSTEM,
    content: `${hints}\n${avoidLine(food)}\n${rules}\n\nMains:\n${mains.map(line).join('\n')}${slots.includes('breakfast') ? `\n\nBreakfasts:\n${breakfasts.map(line).join('\n')}` : ''}`,
    schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          properties: Object.fromEntries(DAYS.map(d => [d, daySchema])),
          required: [...DAYS],
          additionalProperties: false,
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    maxTokens: 300 + 40 * slots.length * 7,
    label: `week x${slots.length}`,
  });

  // Check every pick and fill every slot. Lunches and dinners never repeat within the
  // week while any unused main is left. When the household's recipes run short, rules
  // are relaxed in this order: "avoid if possible" ingredients and last week's meals, then
  // the weeknight time limit, then repeats within the week (fewest uses first).
  const uses = new Map<number, number>();
  const relaxed = new Set<'lastWeek' | 'time' | 'repeat'>();
  const tooLong = (c: Card, day: string, slot: Slot) =>
    slot === 'dinner' && !!maxWeeknight && WEEKNIGHTS.has(day) && (c.total_minutes ?? Infinity) > maxWeeknight;
  type Level = 0 | 1 | 2 | 3;
  const fits = (c: Card | undefined, day: string, slot: Slot, level: Level): c is Card => {
    if (!c) return false;
    if (slot === 'breakfast') return c.meal_role === 'breakfast';
    if (c.meal_role !== 'main') return false;
    if (level < 1 && check(c).avoids.length) return false;
    if (level < 3 && uses.has(c.id)) return false;
    if (level < 1 && lastWeek.has(c.id)) return false;
    if (level < 2 && tooLong(c, day, slot)) return false;
    return true;
  };
  const plan: Record<string, Record<Slot, { id: number; title: string; image: string } | null>> = {};
  for (const [i, day] of DAYS.entries()) {
    plan[day] = { breakfast: null, lunch: null, dinner: null };
    for (const slot of slots) {
      let pick: Card | undefined = byId.get(Number(out.plan?.[day]?.[slot]));
      if (slot === 'breakfast') {
        if (!fits(pick, day, slot, 0)) pick = breakfasts.length ? breakfasts[i % breakfasts.length] : undefined;
      } else if (!fits(pick, day, slot, 0)) {
        pick = undefined;
        for (const level of [0, 1, 2, 3] as Level[]) {
          const pool = level === 2 ? [...mains].sort((a, b) => (a.total_minutes ?? 999) - (b.total_minutes ?? 999)) // shortest first
            : level === 3 ? [...mains].sort((a, b) => (uses.get(a.id) ?? 0) - (uses.get(b.id) ?? 0)) : mains;
          pick = pool.find(c => fits(c, day, slot, level));
          if (pick) {
            if (level >= 1 && lastWeek.has(pick.id)) relaxed.add('lastWeek');
            if (level >= 2 && tooLong(pick, day, slot)) relaxed.add('time');
            if (level >= 3 && uses.has(pick.id)) relaxed.add('repeat');
            break;
          }
        }
      }
      if (!pick) continue;
      if (slot !== 'breakfast') uses.set(pick.id, (uses.get(pick.id) ?? 0) + 1);
      plan[day][slot] = { id: pick.id, title: pick.display_name ?? pick.name, image: pick.thumb_url ?? '' };
    }
  }
  // Tell the household plainly when their settings leave too few recipes.
  const notes: string[] = [];
  if (relaxed.has('repeat')) notes.push("Your settings leave only a few recipes, so some meals repeat this week.");
  else if (relaxed.has('lastWeek')) notes.push('A few meals from last week are back: your settings leave only a few recipes.');
  if (relaxed.has('time')) notes.push(`Not enough recipes take ${maxWeeknight} minutes or less, so some weeknight dinners take longer.`);
  return { plan, notice: notes.join(' ') || null };
}

serve(async (body, req) => {
  const db = userClient(req);
  await claimRequest(db, RATE_LIMIT);
  if (body.mode === 'week') return week(db);
  if (body.mode === 'suggestions') return suggestions(db, body);
  throw new AppError('Unknown request.', 400);
});
