import { askTool } from '../_shared/claude.ts';
import { AppError, claimRequest, serve, userClient } from '../_shared/http.ts';
import { filterRecipes } from '../_shared/catalog/recipeFilter.ts';

// "Find meals like this": a photo (plus optional words) -> what the dish is -> the closest
// recipes in the household's safe catalog.
//   body: { image: base64 JPEG/PNG/WebP (no data: prefix), mediaType, context? }
//   -> { dish_name, recipes: RecipeCard[] }
// The image is sent to Claude and never stored. The dish name and attributes are saved
// in dish_lookups (RLS: the user's own rows) for future suggestions.

const RATE_LIMIT = { kind: 'photo', perMinute: 5, perDay: 20, noun: 'photo lookups' };
const MAX_BASE64 = 3_000_000; // ~2.2 MB decoded; the app sends ~1024px JPEGs (~150-400 KB)
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MEAL_ROLES = ['breakfast', 'main', 'side', 'dessert', 'condiment', 'drink'];
const PROTEINS = ['chicken', 'beef', 'pork', 'lamb', 'goat', 'fish', 'shellfish', 'eggs', 'tofu', 'beans or lentils', 'cheese', 'none', 'other'];
const CARD_COLUMNS = 'id, name, display_name, subtitle, category, area, thumb_url, total_minutes, meal_role, allergens, diets, ingredient_names';
const NOT_FOUND = "Couldn't tell what that dish is. Add a short description and try again.";

interface Dish {
  is_food: boolean;
  dish_name: string;
  area: string;
  category: string;
  main_ingredients: string[];
  protein: string;
  cooking_method: string;
  flavor_profile: string[];
  meal_role: string;
  confidence: number;
}

interface Row {
  id: number; name: string; display_name: string | null; subtitle: string | null; category: string | null; area: string | null;
  thumb_url: string | null; total_minutes: number | null; meal_role: string; allergens: string[]; diets: string[]; ingredient_names: string[];
}

const STOP = new Set(['with', 'and', 'the', 'of', 'in', 'a', 'my', 'style', 'recipe', 'homemade', 'easy', 'classic']);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/(es|s)$/, '');
const words = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ]+/).map(stem).filter(w => w.length >= 3 && !STOP.has(w));

const PROTEIN_WORDS: Record<string, string[]> = {
  chicken: ['chicken'], beef: ['beef', 'steak', 'brisket', 'ground beef'], pork: ['pork', 'bacon', 'ham', 'chorizo', 'sausage'],
  lamb: ['lamb', 'mutton'], goat: ['goat'], fish: ['salmon', 'cod', 'tuna', 'haddock', 'fish', 'mackerel', 'sardine', 'trout'],
  shellfish: ['shrimp', 'prawn', 'crab', 'mussel', 'clam', 'squid', 'scallop', 'lobster'], eggs: ['egg'], tofu: ['tofu'],
  'beans or lentils': ['bean', 'lentil', 'chickpea'], cheese: ['cheese', 'feta', 'mozzarella', 'paneer', 'halloumi'],
};

serve(async (body, req) => {
  const db = userClient(req);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) throw new AppError('Sign in again to continue.', 401);

  const image = typeof body.image === 'string' ? body.image : '';
  const mediaType = MEDIA_TYPES.find(t => t === body.mediaType);
  if (!image || !mediaType) throw new AppError('Choose a JPEG, PNG or WebP photo.', 400);
  if (image.length > MAX_BASE64) throw new AppError('That photo is too large. Try a smaller one.', 413);
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 200) : '';

  await claimRequest(db, RATE_LIMIT);

  // The cuisines and categories that exist in the catalog, so the answer maps onto them.
  const { data: facets, error: facetErr } = await db.from('recipes').select('area, category').not('meal_role', 'is', null);
  if (facetErr) throw new AppError("Couldn't load recipes. Try again.", 502);
  const areas = [...new Set((facets ?? []).map(f => f.area as string).filter(Boolean))].sort();
  const categories = [...new Set((facets ?? []).map(f => f.category as string).filter(Boolean))].sort();

  const dish = await askTool<Dish>({
    system: 'You identify dishes in food photos for a meal-planning app. Describe what is on the plate. When the person describes the dish, trust their description for dish_name and ingredients, and use the photo for the rest. If the photo is not food, set is_food to false. Confidence is 0 to 1: how sure you are about dish_name.',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text', text: context ? `The person says: "${context}"` : 'No description was given.' },
    ],
    tool: {
      name: 'describe_dish',
      description: 'Record what dish is in the photo.',
      input_schema: {
        type: 'object',
        properties: {
          is_food: { type: 'boolean' },
          dish_name: { type: 'string', description: 'Plain US-English name, e.g. "Chicken tinga tacos"' },
          area: { type: 'string', enum: [...areas, 'Unknown'], description: 'Closest cuisine from the list' },
          category: { type: 'string', enum: categories, description: 'Closest catalog category' },
          main_ingredients: { type: 'array', items: { type: 'string' }, description: 'Up to 6, US names' },
          protein: { type: 'string', enum: PROTEINS },
          cooking_method: { type: 'string' },
          flavor_profile: { type: 'array', items: { type: 'string' } },
          meal_role: { type: 'string', enum: MEAL_ROLES },
          confidence: { type: 'number' },
        },
        required: ['is_food', 'dish_name', 'area', 'category', 'main_ingredients', 'protein', 'cooking_method', 'flavor_profile', 'meal_role', 'confidence'],
      },
    },
    maxTokens: 500,
    label: 'analyze-dish',
  });

  // A description from the person counts as knowing what the dish is.
  // Tool output isn't schema-enforced: default anything missing before using it.
  dish.dish_name = typeof dish.dish_name === 'string' && dish.dish_name.trim() ? dish.dish_name.trim() : context || 'this dish';
  dish.main_ingredients = Array.isArray(dish.main_ingredients) ? dish.main_ingredients.filter(x => typeof x === 'string') : [];
  dish.flavor_profile = Array.isArray(dish.flavor_profile) ? dish.flavor_profile.filter(x => typeof x === 'string') : [];
  dish.protein = typeof dish.protein === 'string' ? dish.protein : 'other';
  dish.cooking_method = typeof dish.cooking_method === 'string' ? dish.cooking_method : '';
  dish.confidence = Number(dish.confidence) || 0;
  if (!dish.is_food || (!context && !(dish.confidence >= 0.5))) throw new AppError(NOT_FOUND, 422);

  // Score the household's safe recipes (allergens, diet and skipped ingredients are
  // already filtered out by safe_recipes() and the recipe filter).
  const role = ['main', 'breakfast', 'side', 'dessert'].includes(dish.meal_role) ? dish.meal_role : 'main';
  const [{ data: rows, error }, { data: prefs }, { data: plan }, { data: favs }, { data: rated }] = await Promise.all([
    db.rpc('safe_recipes').select(CARD_COLUMNS).eq('meal_role', role),
    db.from('user_preferences').select('diet, allergies, skip_ingredients, avoid_ingredients').maybeSingle(),
    db.from('week_plans').select('plan').maybeSingle(),
    db.from('favorites').select('recipe_id'),
    db.from('recipe_ratings').select('recipe_id').gte('rating', 4),
  ]);
  if (error) throw new AppError("Couldn't load recipes. Try again.", 502);
  const candidates = filterRecipes((rows ?? []) as Row[], {
    diet: prefs?.diet ?? 'none', allergies: prefs?.allergies ?? [], skip_ingredients: prefs?.skip_ingredients ?? [], avoid_ingredients: prefs?.avoid_ingredients ?? [],
  });
  const planned = new Set<number>();
  for (const day of Object.values((plan?.plan ?? {}) as Record<string, Record<string, { id: number } | null>>)) {
    for (const entry of Object.values(day ?? {})) if (entry?.id) planned.add(entry.id);
  }
  const liked = new Set([...(favs ?? []).map(f => f.recipe_id as number), ...(rated ?? []).map(r => r.recipe_id as number)]);
  const likedRows = candidates.filter(c => liked.has(c.id));
  const likedAreas = new Set(likedRows.map(c => c.area));
  const likedCategories = new Set(likedRows.map(c => c.category));

  const nameWords = words(`${dish.dish_name} ${context}`);
  const ingredientWords = dish.main_ingredients.flatMap(words);
  const proteinWords = PROTEIN_WORDS[dish.protein] ?? [];

  const scored = candidates.map(c => {
    const haystack = c.ingredient_names.join(' | ');
    const title = words(`${c.display_name ?? ''} ${c.name}`);
    let score = 0;
    if (c.area && c.area === dish.area) score += 3;
    if (c.category && c.category === dish.category) score += 2;
    if (proteinWords.some(p => haystack.includes(p) || (c.category ?? '').toLowerCase().includes(p))) score += 3;
    score += Math.min(6, ingredientWords.filter(w => haystack.includes(w)).length * 1.5);
    score += Math.min(6, nameWords.filter(w => title.includes(w)).length * 2);
    if (liked.has(c.id)) score += 1;
    else if (likedAreas.has(c.area) || likedCategories.has(c.category)) score += 0.5;
    if (planned.has(c.id)) score -= 5;
    return { c, score };
  }).sort((a, b) => b.score - a.score);

  const recipes = scored.slice(0, 8).map(({ c }) => {
    const { ingredient_names: _drop, ...card } = c;
    return card;
  });

  const { error: logErr } = await db.from('dish_lookups').insert({
    user_id: auth.user.id,
    dish_name: dish.dish_name.slice(0, 120),
    context: context || null,
    attributes: {
      area: dish.area, category: dish.category, main_ingredients: dish.main_ingredients.slice(0, 8), protein: dish.protein,
      cooking_method: dish.cooking_method, flavor_profile: dish.flavor_profile.slice(0, 6), meal_role: dish.meal_role, confidence: dish.confidence,
    },
  });
  if (logErr) console.error('[analyze-dish] lookup log failed:', logErr.message);

  return { dish_name: dish.dish_name, recipes };
});
