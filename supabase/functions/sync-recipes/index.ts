import { deriveRecipe, type MealDbMeal } from '../_shared/catalog/derive.ts';
import { usIngredientName, usKitchenText } from '../_shared/catalog/names.ts';
import { askJson } from '../_shared/claude.ts';
import { AppError, json, serviceClient } from '../_shared/http.ts';

// Keeps public.recipes and public.ingredient_meta in sync with TheMealDB.
//   step "fetch"    : every meal (search.php?f=a..z), deterministic columns upserted
//   step "classify" : recipes with no meal_role yet -> Claude (role, names, minutes)
//   step "aisles"   : ingredient names with no ingredient_meta row -> Claude (aisle)
//   step "names"    : tidies display names: US words, sentence case, "Name (Translation)" splits
//   step "subtitles": rewrites subtitles from each recipe's own ingredients, 10 per call (manual)
//   step "all"      : all four in order (what the weekly cron job sends)
// Claude columns are only ever written for rows that don't have them, so a recipe is
// never classified twice. Every step reads catalog rows only (owner_id is null): a household's
// own recipes live in the same table and are never classified, renamed or sent to Claude.
//
// Not user-facing: requires the x-sync-secret header to match the SYNC_SECRET secret.
// TheMealDB key: MEALDB_API_KEY secret (defaults to the public test key "1"; swap in
// the paid key without a client deploy).

const MEALDB_BASE = () => `https://www.themealdb.com/api/json/v1/${Deno.env.get('MEALDB_API_KEY') || '1'}/`;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const MEAL_ROLES = ['breakfast', 'main', 'side', 'dessert', 'condiment', 'drink'] as const;
const AISLES = ['Produce', 'Meat and seafood', 'Dairy and eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'] as const;

async function mealDb<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${MEALDB_BASE()}${path}`);
    if (res.status === 429 && attempt < 4) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`TheMealDB ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
}

async function fetchStep(): Promise<{ meals: number }> {
  const db = serviceClient();
  const now = new Date().toISOString();
  let meals = 0;
  // One letter at a time: fetch, derive, save, so memory and CPU stay small per batch.
  for (const letter of LETTERS) {
    const data = await mealDb<{ meals?: MealDbMeal[] | null }>(`search.php?f=${letter}`);
    const rows = (data.meals ?? []).map(m => ({ ...deriveRecipe(m), synced_at: now }));
    if (rows.length) {
      const { error } = await db.from('recipes').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`recipes upsert failed (${letter}): ${error.message}`);
    }
    meals += rows.length;
    await new Promise(r => setTimeout(r, 150));
  }
  return { meals };
}

const CLASSIFY_SYSTEM = `You prepare a recipe catalog for a US meal-planning app for busy families.
For each recipe, return:
- meal_role: "breakfast" (eaten in the morning: porridge, pancakes, egg breakfasts, breakfast pastries), "main" (can be the main dish of lunch or dinner on its own: curries, stews, pasta, pies, substantial salads and soups, sandwiches, burgers), "side" (served alongside a main: vegetables, rice, potatoes, breads, small salads), "dessert" (sweet dishes, cakes, cookies, sweet pastries), "condiment" (pickles, sauces, dips, dressings, chutneys, jams, spreads), "drink".
- display_name: the dish name in US English and sentence case (capitalize the first word and proper nouns only). Drop any parenthetical translation. Keep well-known dish names as they are ("Pad Thai", "Patatas bravas", "Shakshuka"). Use US ingredient words (eggplant, zucchini, cilantro, ground beef, shrimp). Use "and", not "&". At most 48 characters.
- subtitle: a plain-English description in sentence case, at most 60 characters, no final period, no marketing words. If the name isn't plain English, the subtitle says what the dish is ("Syrian green beans in olive oil"). Otherwise describe it briefly ("Crispy potatoes with smoky tomato sauce").
- total_minutes: realistic time from start to table in minutes, including soaking, marinating, rising and cooking written in the instructions, rounded to the nearest 5. Leave out optional overnight steps only if the recipe says they're optional.`;

interface ClassifyRow { id: number; name: string; category: string | null; area: string | null; ingredients: Array<{ name: string }>; instructions_raw: string | null }

async function classifyBatch(rows: ClassifyRow[]) {
  const schema = {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            meal_role: { type: 'string', enum: [...MEAL_ROLES] },
            display_name: { type: 'string' },
            subtitle: { type: 'string' },
            total_minutes: { type: 'integer' },
          },
          required: ['id', 'meal_role', 'display_name', 'subtitle', 'total_minutes'],
          additionalProperties: false,
        },
      },
    },
    required: ['recipes'],
    additionalProperties: false,
  };
  const content = rows.map(r => [
    `id: ${r.id}`,
    `name: ${r.name}`,
    `category: ${r.category ?? ''}; cuisine: ${r.area ?? ''}`,
    `ingredients: ${r.ingredients.map(i => i.name).join(', ')}`,
    `instructions: ${(r.instructions_raw ?? '').replace(/\s+/g, ' ').slice(0, 1400)}`,
  ].join('\n')).join('\n\n');
  const out = await askJson<{ recipes: Array<{ id: number; meal_role: string; display_name: string; subtitle: string; total_minutes: number }> }>({
    system: CLASSIFY_SYSTEM,
    content: `Classify these ${rows.length} recipes. Return one entry per id.\n\n${content}`,
    schema,
    maxTokens: 150 * rows.length + 200,
    label: `classify x${rows.length}`,
  });
  const ids = new Set(rows.map(r => r.id));
  return out.recipes.filter(r => ids.has(r.id) && (MEAL_ROLES as readonly string[]).includes(r.meal_role));
}

async function classifyStep(limit: number): Promise<{ classified: number; remaining: number }> {
  const db = serviceClient();
  const { data, error } = await db.from('recipes')
    .select('id, name, category, area, ingredients, instructions_raw')
    .is('meal_role', null).is('owner_id', null).order('id').limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClassifyRow[];
  const batches: ClassifyRow[][] = [];
  for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10));
  let classified = 0;
  // Three batches at a time keeps a 100-recipe run well inside the function time limit.
  for (let i = 0; i < batches.length; i += 3) {
    const results = await Promise.all(batches.slice(i, i + 3).map(b => classifyBatch(b).catch(err => {
      console.error('[sync] classify batch failed:', err instanceof Error ? err.message : err);
      return [];
    })));
    const now = new Date().toISOString();
    for (const r of results.flat()) {
      const minutes = Math.max(5, Math.min(24 * 60, Math.round(r.total_minutes / 5) * 5 || 5));
      const { error: upErr } = await db.from('recipes').update({
        meal_role: r.meal_role,
        display_name: usKitchenText(r.display_name.trim()).slice(0, 80),
        subtitle: usKitchenText(r.subtitle.trim().replace(/\.$/, '')).slice(0, 90),
        total_minutes: minutes,
        classified_at: now,
      }).eq('id', r.id).is('meal_role', null);
      if (upErr) console.error('[sync] classify update failed:', r.id, upErr.message);
      else classified++;
    }
  }
  const { count } = await db.from('recipes').select('id', { count: 'exact', head: true }).is('meal_role', null).is('owner_id', null);
  return { classified, remaining: count ?? 0 };
}

async function aislesStep(): Promise<{ classified: number }> {
  const db = serviceClient();
  const { data: recipes, error } = await db.from('recipes').select('ingredients').is('owner_id', null);
  if (error) throw new Error(error.message);
  const names = new Map<string, string>(); // lowercased -> as written
  for (const r of recipes ?? []) {
    for (const ing of (r.ingredients as Array<{ name: string; name_us: string }>) ?? []) names.set(ing.name.toLowerCase(), ing.name);
  }
  const { data: known } = await db.from('ingredient_meta').select('name');
  for (const k of known ?? []) names.delete(k.name);
  const pending = [...names.entries()];
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, aisle: { type: 'string', enum: [...AISLES] } },
          required: ['name', 'aisle'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  };
  let classified = 0;
  for (let i = 0; i < pending.length; i += 80) {
    const batch = pending.slice(i, i + 80);
    const out = await askJson<{ items: Array<{ name: string; aisle: string }> }>({
      system: 'You sort grocery ingredients into the supermarket aisle a US shopper would find them in. Fresh herbs, fruit and vegetables are Produce. Dried herbs, ground spices, salt, pepper and seasoning blends are Spices. Canned, dried and jarred goods, oils, vinegars, sauces, flour, sugar, rice, pasta, nuts and stock are Pantry. Raw meat, poultry and fish are Meat and seafood. Milk, cheese, butter, cream, yogurt and eggs are Dairy and eggs. Bread, tortillas and buns are Bakery.',
      content: `Return one entry per ingredient, with the name exactly as given.\n${batch.map(([, n]) => n).join('\n')}`,
      schema,
      maxTokens: 20 * batch.length + 200,
      label: `aisles x${batch.length}`,
    });
    const byName = new Map(out.items.map(it => [it.name.toLowerCase(), it.aisle]));
    const rows = batch
      .map(([key, name]) => ({ name: key, name_us: usIngredientName(name), aisle: byName.get(key) }))
      .filter((r): r is { name: string; name_us: string; aisle: string } => !!r.aisle && (AISLES as readonly string[]).includes(r.aisle));
    const { error: upErr } = await db.from('ingredient_meta').upsert(rows, { onConflict: 'name', ignoreDuplicates: true });
    if (upErr) throw new Error(`ingredient_meta upsert failed: ${upErr.message}`);
    classified += rows.length;
  }
  return { classified };
}


// A display name in Title Case ("Pork and Sauerkraut Goulash") rather than sentence case.
const TITLE_CASE = /^\S+(?: (?:and|with|in|of|a|the|de|di|la|al|bi|en|y|e|da|do|com|\p{Lu}\S*))+$/u;
const isTitleCase = (s: string) => TITLE_CASE.test(s) && /\s\p{Lu}/u.test(s) && s.split(' ').length >= 2;

function sentenceCase(text: string, keep: Set<string>): string {
  return text.trim().split(/\s+/).map((w, i) => {
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
    return keep.has(w.toLowerCase()) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
  }).join(' ');
}

async function namesStep(): Promise<{ split: number; recased: number }> {
  const db = serviceClient();
  const { data, error } = await db.from('recipes').select('id, name, display_name, subtitle, ingredient_names').not('meal_role', 'is', null).is('owner_id', null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: number; name: string; display_name: string; subtitle: string; ingredient_names: string[] }>;
  // Nationality words keep their capital: "Syrian", "Algerian".
  const areas = await mealDb<{ meals?: Array<{ strArea: string }> }>('list.php?a=list').catch(() => ({ meals: [] }));
  const keep = new Set((areas.meals ?? []).flatMap(a => a.strArea.toLowerCase().split(/[ ,]+/)));
  const vocabulary = new Set(rows.flatMap(r => r.ingredient_names.flatMap(n => n.split(/\s+/))));
  let split = 0;
  const recase: typeof rows = [];
  for (const r of rows) {
    // "Beets soup" -> "Beet soup" (the vegetable as a modifier is singular in US English).
    let display = usKitchenText(r.display_name).replace(/\b(B|b)eets (?!and\b|with\b|in\b)(?=\w)/, '$1eet ');
    let subtitle = usKitchenText(r.subtitle);
    // "Fasoliyyeh Bi Z-Zayt (Syrian Green Beans with Olive Oil)": when the translation
    // became the name, use the dish's own name with the translation as the subtitle.
    const m = r.name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) {
      const [own, translation] = [m[1].trim(), m[2].trim()];
      const firstOwn = own.split(/\s+/)[0].toLowerCase();
      const firstDisplay = display.split(/\s+/)[0].toLowerCase();
      if (translation.split(/\s+/).length >= 3 && firstDisplay !== firstOwn && translation.toLowerCase().startsWith(firstDisplay) && !vocabulary.has(firstOwn)) {
        display = sentenceCase(own, keep);
        subtitle = usKitchenText(sentenceCase(translation, keep));
        split++;
      }
    }
    if (isTitleCase(display)) recase.push({ ...r, display_name: display, subtitle });
    else if (display !== r.display_name || subtitle !== r.subtitle) {
      await db.from('recipes').update({ display_name: display, subtitle }).eq('id', r.id);
    }
  }
  // Title Case -> sentence case, keeping nationality words and acronyms ("BBQ").
  let recased = 0;
  for (const r of recase) {
    const display = r.display_name.split(/\s+/).map((w, i) => (i === 0 || /^[A-Z]{2,}$/.test(w) || keep.has(w.toLowerCase()) ? w : w.toLowerCase())).join(' ');
    await db.from('recipes').update({ display_name: display, subtitle: r.subtitle }).eq('id', r.id);
    recased++;
  }
  return { split, recased };
}

/** Output that reads like a note to the editor rather than a description. */
const NOT_A_SUBTITLE = /\b(subtitle|ingredients?|recipe|mentions?|listed|does not|doesn't|instead|remove|missing)\b/i;

/**
 * Rewrites every subtitle from the recipe's own name and full ingredient list, ten
 * recipes per call so descriptions can't cross between recipes. Manual step.
 */
async function subtitlesStep(): Promise<{ checked: number; written: number }> {
  const db = serviceClient();
  const { data, error } = await db.from('recipes').select('id, name, display_name, category, area, ingredients').not('meal_role', 'is', null).is('owner_id', null).order('id');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: number; name: string; display_name: string; category: string | null; area: string | null; ingredients: Array<{ name_us: string }> }>;
  const schema = {
    type: 'object',
    properties: { recipes: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, subtitle: { type: 'string' } }, required: ['id', 'subtitle'], additionalProperties: false } } },
    required: ['recipes'],
    additionalProperties: false,
  };
  let written = 0;
  const batches: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10));
  for (let i = 0; i < batches.length; i += 5) {
    const results = await Promise.all(batches.slice(i, i + 5).map(batch => askJson<{ recipes: Array<{ id: number; subtitle: string }> }>({
      system: 'You write the one-line description shown under a recipe name in a US cooking app. Describe the dish itself in plain English: what it is and its main ingredients. Only name ingredients from that recipe\'s own list. Sentence case, at most 60 characters, no final period, no marketing words, no exclamation marks. Never comment on the recipe or the list; just describe the dish.',
      content: batch.map(r => `id ${r.id}: ${r.display_name || r.name} (original name: ${r.name}; ${[r.area, r.category].filter(Boolean).join(', ')})\ningredients: ${r.ingredients.map(x => x.name_us).join(', ')}`).join('\n\n'),
      schema,
      maxTokens: 60 * batch.length + 200,
      label: `subtitles x${batch.length}`,
    }).catch(err => { console.error('[sync] subtitle batch failed:', err instanceof Error ? err.message : err); return { recipes: [] }; })));
    for (const [j, out] of results.entries()) {
      const ids = new Set(batches[i + j].map(r => r.id));
      for (const r of out.recipes) {
        const subtitle = usKitchenText(r.subtitle.trim().replace(/\.$/, '')).slice(0, 90);
        if (!ids.has(r.id) || !subtitle || NOT_A_SUBTITLE.test(subtitle)) { console.log('[sync] subtitle rejected:', r.id, subtitle); continue; }
        const { error: upErr } = await db.from('recipes').update({ subtitle }).eq('id', r.id);
        if (!upErr) written++;
      }
    }
  }
  return { checked: rows.length, written };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('SYNC_SECRET');
  if (!secret || req.headers.get('x-sync-secret') !== secret) return json({ error: 'Forbidden' }, 403);
  let body: { step?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const step = body.step ?? 'all';
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200);
  try {
    const result: Record<string, unknown> = {};
    if (step === 'fetch' || step === 'all') result.fetch = await fetchStep();
    if (step === 'classify' || step === 'all') result.classify = await classifyStep(limit);
    if (step === 'aisles' || step === 'all') result.aisles = await aislesStep();
    if (step === 'names' || step === 'all') result.names = await namesStep();
    // Not part of "all": only needed after a classification batch, run by hand.
    if (step === 'subtitles') result.subtitles = await subtitlesStep();
    if (!Object.keys(result).length) return json({ error: `Unknown step "${step}"` }, 400);
    console.log('[sync] done:', JSON.stringify(result));
    return json(result, 200);
  } catch (err) {
    console.error('[sync] failed:', err);
    return json({ error: err instanceof AppError || err instanceof Error ? err.message : 'Sync failed' }, 500);
  }
});
