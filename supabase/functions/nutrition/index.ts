import { AppError, claimRequest, serve, serviceClient, userClient } from '../_shared/http.ts';
import { cacheOwner, factsFromFdc, hasNoCalories, needsLookup, nutritionKey, pickFood, searchTermFor, type Facts, type FdcFoodDetail, type FdcSearchFood } from '../_shared/nutrition.ts';

// Nutrition facts for a recipe's ingredients, from USDA FoodData Central.
//   { recipe_id } -> { facts: Facts[] }   (one per ingredient that needs a lookup)
// Each ingredient is looked up once and cached in ingredient_nutrition, so a recipe whose
// ingredients are all cached never reaches this function: the app reads the cache itself.
// An ingredient USDA can't match is cached as unmatched and shown as such in the app.
// The numbers are added up in the app (nutrition.ts, the same code this function uses to
// read USDA's answers).
// Secrets: FDC_API_KEY (free, from https://fdc.nal.usda.gov/api-key-signup). Never sent to the app.

const RATE_LIMIT = { kind: 'nutrition', perMinute: 10, perDay: 150, noun: 'nutrition lookups' };
const FDC = 'https://api.nal.usda.gov/fdc/v1';
/** USDA allows 1,000 requests an hour per key; one recipe uses at most this many (two per ingredient). */
const MAX_LOOKUPS = 30;
const TOGETHER = 4;
const COLUMNS = 'key, matched, fdc_id, description, kcal, protein_g, carbs_g, fat_g, fiber_g, portions';

async function fdc<T>(path: string, apiKey: string): Promise<T> {
  // The key goes in a header, so it never appears in a URL or a log line.
  const res = await fetch(`${FDC}${path}`, { headers: { 'X-Api-Key': apiKey } });
  if (res.status === 429) throw new AppError('Nutrition is busy right now. Try again in a few minutes.', 429);
  if (!res.ok) {
    console.error('[nutrition] USDA answered', res.status, path.split('?')[0]);
    throw new AppError("Couldn't reach the nutrition data. Try again.", 502);
  }
  return await res.json() as T;
}

/**
 * One ingredient: search, pick the plain food, read its household portions. `cache` is
 * false when part of the answer is missing because USDA failed (not because the food has
 * no portions): that answer is used once but not kept, so the next request tries again.
 */
async function lookup(key: string, apiKey: string): Promise<{ facts: Facts; cache: boolean }> {
  const query = searchTermFor(key);
  const search = await fdc<{ foods?: FdcSearchFood[] }>(`/foods/search?query=${encodeURIComponent(query)}&dataType=${encodeURIComponent('Foundation,SR Legacy')}&pageSize=25&requireAllWords=true`, apiKey);
  const food = pickFood(query, search.foods ?? []);
  if (!food) return { facts: factsFromFdc(key, null), cache: true };
  try {
    return { facts: factsFromFdc(key, food, await fdc<FdcFoodDetail>(`/food/${food.fdcId}`, apiKey)), cache: true };
  } catch {
    return { facts: factsFromFdc(key, food, null), cache: false };
  }
}

serve(async (body, req) => {
  const db = userClient(req);
  const recipeId = Number(body.recipe_id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) throw new AppError('Unknown recipe.', 400);
  await claimRequest(db, RATE_LIMIT);

  // Read as the caller: a household's own recipe is only found by that household.
  const { data: recipe, error } = await db.from('recipes').select('ingredients, owner_id').eq('id', recipeId).maybeSingle();
  if (error) throw new AppError("Couldn't load the recipe. Try again.", 502);
  if (!recipe) throw new AppError('Unknown recipe.', 404);
  /** Whose recipe this is: cache rows it creates are private to them (null: a catalog recipe, shared). */
  const requester = (recipe.owner_id as string | null) ?? null;

  const names = new Map<string, string>();
  for (const ing of (recipe.ingredients ?? []) as Array<{ name_us?: string; name?: string }>) {
    const key = nutritionKey((ing.name_us || ing.name || '').trim());
    if (key && !hasNoCalories(key) && !names.has(key)) names.set(key, key);
  }
  if (!names.size) return { facts: [] };

  const admin = serviceClient();
  const { data: cached, error: cacheError } = await admin.from('ingredient_nutrition').select(`${COLUMNS}, checked_at, owner_id`).in('key', [...names.keys()]);
  if (cacheError) {
    console.error('[nutrition] cache read failed:', cacheError);
    throw new AppError('Nutrition is not set up on the server.', 500);
  }
  // Rows another household owns that this recipe needs too become shared (see cacheOwner).
  const owners = new Map((cached ?? []).map(row => [row.key as string, (row.owner_id as string | null) ?? null]));
  const toShare = [...owners].filter(([, owner]) => owner !== null && owner !== requester).map(([key]) => key);
  if (toShare.length) {
    const { error: shareError } = await admin.from('ingredient_nutrition').update({ owner_id: null }).in('key', toShare);
    // Not fatal: this request gets its answer either way; the household reads it through here.
    if (shareError) console.error('[nutrition] sharing rows failed:', shareError);
    for (const key of toShare) owners.set(key, null);
  }
  // Unmatched rows, and matched rows saved without portions, are looked up again after a
  // while (USDA adds data), or as soon as the matching has improved since they were saved.
  const known = new Map((cached ?? []).filter(row => !needsLookup(row as never)).map(row => [row.key as string, row]));
  const missing = [...names].filter(([key]) => !known.has(key)).slice(0, MAX_LOOKUPS);

  const found: Array<{ facts: Facts; cache: boolean }> = [];
  if (missing.length) {
    const apiKey = Deno.env.get('FDC_API_KEY');
    if (!apiKey) throw new AppError('Nutrition is not set up on the server.', 500);
    let failed = 0;
    for (let i = 0; i < missing.length; i += TOGETHER) {
      // One ingredient failing doesn't lose the others: it's left out and tried again next time.
      for (const result of await Promise.allSettled(missing.slice(i, i + TOGETHER).map(([key]) => lookup(key, apiKey)))) {
        if (result.status === 'fulfilled') found.push(result.value); else failed++;
      }
    }
    const keep = found.filter(f => f.cache).map(f => ({
      ...f.facts,
      checked_at: new Date().toISOString(),
      owner_id: cacheOwner(owners.has(f.facts.key) ? owners.get(f.facts.key) : undefined, requester),
    }));
    if (keep.length) {
      const { error: saveError } = await admin.from('ingredient_nutrition').upsert(keep, { onConflict: 'key' });
      // The answer is still good for this request; it will be looked up again next time.
      if (saveError) console.error('[nutrition] cache write failed:', saveError);
    }
    console.log(`[nutrition] recipe ${recipeId}: looked up ${found.length}, matched ${found.filter(f => f.facts.matched).length}, failed ${failed}`);
  }
  const facts = [...known.values()].map(({ checked_at: _checked, owner_id: _owner, ...row }) => row as unknown as Facts).concat(found.map(f => f.facts));
  return { facts };
});
