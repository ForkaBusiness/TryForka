import { AppError, claimRequest, serve, serviceClient, userClient } from '../_shared/http.ts';
import { factsFromFdc, hasNoCalories, nutritionKey, pickFood, type Facts, type FdcFoodDetail, type FdcSearchFood } from '../_shared/nutrition.ts';

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
/** An ingredient that didn't match is tried again after this long: USDA adds foods. */
const RETRY_UNMATCHED_DAYS = 30;
const COLUMNS = 'key, matched, fdc_id, description, kcal, protein_g, carbs_g, fat_g, fiber_g, portions';

async function fdc<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${FDC}${path}${path.includes('?') ? '&' : '?'}api_key=${apiKey}`);
  if (res.status === 429) throw new AppError('Nutrition is busy right now. Try again in a few minutes.', 429);
  if (!res.ok) {
    console.error('[nutrition] USDA answered', res.status, path.split('?')[0]);
    throw new AppError("Couldn't reach the nutrition data. Try again.", 502);
  }
  return await res.json() as T;
}

/** One ingredient: search, pick the plain food, read its household portions. */
async function lookup(key: string, name: string, apiKey: string): Promise<Facts> {
  const search = await fdc<{ foods?: FdcSearchFood[] }>(`/foods/search?query=${encodeURIComponent(name)}&dataType=${encodeURIComponent('Foundation,SR Legacy')}&pageSize=25`, apiKey);
  const food = pickFood(name, search.foods ?? []);
  if (!food) return factsFromFdc(key, null);
  // Portions are only on the food's own record. Without them weights still work.
  const detail = await fdc<FdcFoodDetail>(`/food/${food.fdcId}`, apiKey).catch(() => null);
  return factsFromFdc(key, food, detail);
}

serve(async (body, req) => {
  const db = userClient(req);
  const recipeId = Number(body.recipe_id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) throw new AppError('Unknown recipe.', 400);
  await claimRequest(db, RATE_LIMIT);

  const { data: recipe, error } = await db.from('recipes').select('ingredients').eq('id', recipeId).maybeSingle();
  if (error) throw new AppError("Couldn't load the recipe. Try again.", 502);
  if (!recipe) throw new AppError('Unknown recipe.', 404);

  const names = new Map<string, string>();
  for (const ing of (recipe.ingredients ?? []) as Array<{ name_us?: string; name?: string }>) {
    const name = (ing.name_us || ing.name || '').trim();
    const key = nutritionKey(name);
    if (key && !hasNoCalories(key) && !names.has(key)) names.set(key, name);
  }
  if (!names.size) return { facts: [] };

  const admin = serviceClient();
  const { data: cached, error: cacheError } = await admin.from('ingredient_nutrition').select(`${COLUMNS}, checked_at`).in('key', [...names.keys()]);
  if (cacheError) {
    console.error('[nutrition] cache read failed:', cacheError);
    throw new AppError('Nutrition is not set up on the server.', 500);
  }
  const stale = Date.now() - RETRY_UNMATCHED_DAYS * 86_400_000;
  const known = new Map((cached ?? []).filter(row => row.matched || new Date(row.checked_at as string).getTime() > stale).map(row => [row.key as string, row]));
  const missing = [...names].filter(([key]) => !known.has(key)).slice(0, MAX_LOOKUPS);

  const found: Facts[] = [];
  if (missing.length) {
    const apiKey = Deno.env.get('FDC_API_KEY');
    if (!apiKey) throw new AppError('Nutrition is not set up on the server.', 500);
    for (let i = 0; i < missing.length; i += TOGETHER) {
      found.push(...await Promise.all(missing.slice(i, i + TOGETHER).map(([key, name]) => lookup(key, name, apiKey))));
    }
    const { error: saveError } = await admin.from('ingredient_nutrition')
      .upsert(found.map(f => ({ ...f, checked_at: new Date().toISOString() })), { onConflict: 'key' });
    // The answer is still good for this request; it will be looked up again next time.
    if (saveError) console.error('[nutrition] cache write failed:', saveError);
    console.log(`[nutrition] recipe ${recipeId}: looked up ${found.length}, matched ${found.filter(f => f.matched).length}`);
  }
  const facts = [...known.values()].map(({ checked_at: _checked, ...row }) => row as unknown as Facts).concat(found);
  return { facts };
});
