// Nutrition from USDA FoodData Central: matching an ingredient to a food, turning a
// recipe's amounts into grams, and adding up calories, protein, carbs, fat and fiber.
// Pure TypeScript with no runtime-specific imports: the nutrition Edge Function (Deno),
// the web app (Vite) and the Node unit tests all run the same code.
//
// The numbers are estimates and are labeled that way: the catalog has no servings field
// (a recipe is taken to serve 4 as written), ingredient amounts are free text, and a food
// match is the closest plain entry, not a lab result. What can't be matched or weighed is
// reported, never silently counted as zero.

import { MASS, VOLUME, unitFamily } from './catalog/units.ts';
import { normalizeIngredient } from './catalog/recipeFilter.ts';

/** Per serving, per recipe or per 100 g: the same five numbers everywhere, so daily goals can be added later. */
export interface Nutrients { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const;
export const NO_NUTRIENTS: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

/** One ingredient's cached facts (a row of ingredient_nutrition). */
export interface Facts {
  key: string;
  /** False when USDA has no usable match: the ingredient is reported, not guessed. */
  matched: boolean;
  fdc_id: number | null;
  description: string | null;
  /** Per 100 g. */
  kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null;
  /** Grams per kitchen unit: { cup: 160, tbsp: 10, each: 110, clove: 3 }. */
  portions: Record<string, number>;
}

/** An ingredient USDA couldn't match, or couldn't weigh, is looked up again after this long: USDA adds data. */
export const RETRY_UNSETTLED_DAYS = 30;
/**
 * When the matching last got better (search terms, portion weights). An unmatched or
 * unweighable row saved before then is looked up again on the next view rather than after
 * RETRY_UNSETTLED_DAYS. Move it forward whenever the matching improves.
 */
export const MATCHING_IMPROVED_AT = Date.parse('2026-11-18T05:14:00Z');

/**
 * Whether a cached row should be looked up again. A match with portion weights is final;
 * anything less is retried once it's older than the retry window or than the last
 * improvement to the matching. The app and the function both use this, so a recipe whose
 * every ingredient is cached still gets its stale rows refreshed.
 */
export function needsLookup(row: { matched: boolean; portions: Record<string, number> | null; checked_at?: string | null }, now: number = Date.now()): boolean {
  if (row.matched && Object.keys(row.portions ?? {}).length > 0) return false;
  const checked = row.checked_at ? Date.parse(row.checked_at) : NaN;
  if (Number.isNaN(checked)) return true;
  return checked <= Math.max(now - RETRY_UNSETTLED_DAYS * 86_400_000, MATCHING_IMPROVED_AT);
}

/** The catalog has no servings field: a recipe as written is taken to serve this many. */
export const BASE_SERVINGS = 4;

/** The cache key for an ingredient: its normalized US name ("Red Onions" -> "red onion"). */
export const nutritionKey = (nameUs: string) => normalizeIngredient(nameUs);

/** Nothing to look up: no calories worth counting, whatever the amount. */
const NO_CALORIES = new Set(['water', 'cold water', 'hot water', 'warm water', 'boiling water', 'ice', 'ice cube', 'salt', 'sea salt', 'kosher salt', 'table salt', 'flaky sea salt', 'coarse salt']);
export const hasNoCalories = (key: string) => NO_CALORIES.has(key);

// ── Matching an ingredient to a USDA food ──────────────────────────────────

export interface FdcSearchFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodCategory?: string;
  foodNutrients?: Array<{ nutrientId?: number; value?: number }>;
}

export interface FdcFoodDetail {
  foodPortions?: Array<{ gramWeight?: number; amount?: number; modifier?: string; portionDescription?: string; sequenceNumber?: number; measureUnit?: { name?: string; abbreviation?: string } }>;
}

const ENERGY_KCAL = 1008;
const ENERGY_ATWATER = [2047, 2048];
const PROTEIN = 1003, FAT = 1004, CARBS = 1005, FIBER = 1079;

/** Words, singular. A hyphenated word stays one word: "Sugar-apples" is not sugar. */
const tokens = (text: string) => normalizeIngredient(text.replace(/-/g, '')).split(' ').filter(Boolean);
/** The food itself: the words before the first comma ("Onions" in "Onions, raw"). */
const head = (description: string) => tokens(description.split(',')[0]);

/**
 * How USDA names the plain version of common catalog ingredients, so the search finds it
 * and the match must contain those words. "egg" alone ties egg white with whole egg, and
 * plain cow's milk isn't in the first results for "milk". USDA's search needs its hyphens
 * ("all-purpose", not "allpurpose"), and plain "pepper" in a recipe is black pepper, not a
 * pepper vegetable. Keyed by nutritionKey().
 */
export const SEARCH_AS: Record<string, string> = {
  egg: 'egg whole raw fresh', 'large egg': 'egg whole raw fresh', 'free range egg': 'egg whole raw fresh',
  sugar: 'sugars granulated', 'caster sugar': 'sugars granulated', 'granulated sugar': 'sugars granulated', 'white sugar': 'sugars granulated',
  'brown sugar': 'sugars brown', 'light brown sugar': 'sugars brown', 'dark brown sugar': 'sugars brown',
  'powdered sugar': 'sugars powdered', 'icing sugar': 'sugars powdered',
  milk: 'milk whole milkfat', 'whole milk': 'milk whole milkfat',
  rice: 'rice white long-grain regular raw', 'white rice': 'rice white long-grain regular raw', 'basmati rice': 'rice white long-grain regular raw',
  'long grain rice': 'rice white long-grain regular raw', 'jasmine rice': 'rice white long-grain regular raw', 'brown rice': 'rice brown long grain raw',
  tomato: 'tomatoes red ripe raw', 'cherry tomato': 'tomatoes red ripe raw', 'plum tomato': 'tomatoes red ripe raw',
  'chicken breast': 'chicken broilers or fryers breast meat only raw', 'chicken thigh': 'chicken broilers or fryers thigh meat only raw',
  butter: 'butter without salt', 'unsalted butter': 'butter without salt', 'salted butter': 'butter salted',
  'chicken stock': 'soup stock chicken', 'beef stock': 'soup stock beef',
  garlic: 'garlic raw', 'garlic clove': 'garlic raw',
  'heavy cream': 'cream fluid heavy whipping', 'double cream': 'cream fluid heavy whipping', 'whipping cream': 'cream fluid heavy whipping',
  parmesan: 'cheese parmesan hard', 'parmesan cheese': 'cheese parmesan hard', 'cheddar cheese': 'cheese cheddar',
  'ground beef': 'beef ground lean meat fat raw', 'minced beef': 'beef ground lean meat fat raw', 'lean ground beef': 'beef ground lean meat fat raw',
  'soy sauce': 'soy sauce shoyu',
  flour: 'wheat flour white all-purpose enriched', 'plain flour': 'wheat flour white all-purpose enriched', 'all purpose flour': 'wheat flour white all-purpose enriched',
  pepper: 'spices pepper black', 'black pepper': 'spices pepper black', 'ground black pepper': 'spices pepper black',
  potato: 'potatoes flesh and skin raw', carrot: 'carrots raw', 'lemon juice': 'lemon juice raw', 'lime juice': 'lime juice raw',
  // The dried entry: USDA's raw pine nuts have no cup or spoon weights, so "2 tbsp" couldn't be weighed.
  'pine nut': 'nuts pine nuts dried',
  // Listed by USDA under spices, so the plain name doesn't match.
  saffron: 'spices saffron',
  // Sherry is a fortified dessert wine in USDA's terms.
  sherry: 'alcoholic beverage wine dessert dry', 'dry sherry': 'alcoholic beverage wine dessert dry', 'sweet sherry': 'alcoholic beverage wine dessert sweet',
  breadcrumb: 'bread crumbs dry grated plain', 'bread crumb': 'bread crumbs dry grated plain', 'panko breadcrumb': 'bread crumbs dry grated plain',
  'semisweet chocolate': 'candies semisweet chocolate', 'semi sweet chocolate': 'candies semisweet chocolate',
  'sesame oil': 'oil sesame salad or cooking', 'sesame seed oil': 'oil sesame salad or cooking', 'toasted sesame oil': 'oil sesame salad or cooking',
  'white vinegar': 'vinegar distilled', 'distilled white vinegar': 'vinegar distilled',
  // USDA has no dark soy sauce; regular soy sauce is the nearest entry.
  'dark soy sauce': 'soy sauce shoyu',
  // A whole bird (meat and skin, without the bones), not ground chicken: "1 chicken" weighs as one.
  chicken: 'chicken broilers or fryers meat and skin raw', 'whole chicken': 'chicken broilers or fryers meat and skin raw',
};
/** What to search USDA for, for an ingredient key. */
export const searchTermFor = (key: string) => SEARCH_AS[key] ?? key;

/** Words in a USDA description that don't change what the food is. */
const NEUTRAL = new Set(['raw', 'fresh', 'all', 'purpose', 'whole', 'nfs', 'or', 'and', 'with', 'without', 'salt', 'added', 'unsalted', 'salted', 'plain', 'regular', 'commercial', 'commercially', 'prepared', 'salad', 'cooking', 'mature', 'seed', 'unenriched', 'enriched', 'year', 'round', 'average', 'variety', 'type', 'grade', 'large', 'medium', 'small', 'skin', 'pulp', 'only', 'meat', 'separable', 'lean', 'fat', 'trimmed', 'to', 'select', 'choice', 'broiler', 'fryer', 'fluid', 'vitamin', 'd', 'a', 'ground']);
/** A different product from the plain ingredient, unless the recipe asked for it. */
const PROCESSED = new Set(['dehydrated', 'dried', 'powder', 'canned', 'frozen', 'cooked', 'boiled', 'fried', 'roasted', 'baked', 'pickled', 'juice', 'flake', 'ring', 'chip', 'sauce', 'soup', 'babyfood', 'restaurant', 'fast', 'candied', 'sweetened', 'concentrate', 'imitation', 'substitute', 'snack', 'breaded', 'stewed', 'drained', 'microwaved', 'braised', 'grilled', 'smoked', 'cured']);
/** Part of the food, not the food: an egg white isn't an egg, and skin changes the numbers. */
const PART = new Set(['yolk', 'skin', 'heart', 'liver', 'giblet', 'neck', 'back', 'wing']);
const BRANDED_CATEGORIES = /restaurant|fast food|baby food|snack|sweets|meals, entrees|breakfast cereal|beverage/i;

const nutrient = (food: FdcSearchFood, ...ids: number[]): number | null => {
  for (const id of ids) {
    const hit = food.foodNutrients?.find(n => n.nutrientId === id && typeof n.value === 'number');
    if (hit) return hit.value as number;
  }
  return null;
};

/** The five numbers per 100 g, or null when the entry has no energy and no macros to derive it from. */
export function per100g(food: FdcSearchFood): Nutrients | null {
  const protein = nutrient(food, PROTEIN), fat = nutrient(food, FAT), carbs = nutrient(food, CARBS);
  let kcal = nutrient(food, ENERGY_KCAL, ...ENERGY_ATWATER);
  // Foundation foods often list no energy: the standard 4-4-9 factors fill it in.
  if (kcal === null && protein !== null && fat !== null && carbs !== null) kcal = 4 * protein + 4 * carbs + 9 * fat;
  if (kcal === null) return null;
  // USDA's carbs are "by difference" and can come out slightly below zero.
  const floor = (n: number | null) => Math.max(0, n ?? 0);
  return { kcal: Math.max(0, kcal), protein: floor(protein), carbs: floor(carbs), fat: floor(fat), fiber: floor(nutrient(food, FIBER)) };
}

/**
 * The search result that best stands for a plain ingredient: every word of the ingredient
 * must be in the description, and the fewest other words wins ("Onions, raw" over
 * "Onions, dehydrated flakes" and over a restaurant's onion rings). Null when nothing
 * contains the whole name: no match is better than a wrong one.
 */
export function pickFood(query: string, foods: readonly FdcSearchFood[]): FdcSearchFood | null {
  const wanted = tokens(query);
  if (!wanted.length) return null;
  let best: { food: FdcSearchFood; score: number } | null = null;
  for (const food of foods) {
    if (!per100g(food)) continue;
    const words = tokens(food.description);
    if (!wanted.every(w => words.includes(w))) continue;
    // The food itself must be one of the words asked for: "Toaster pastries, brown-sugar-cinnamon" isn't sugar.
    if (!head(food.description).some(w => wanted.includes(w))) continue;
    const extra = words.filter(w => !wanted.includes(w));
    let score = 0;
    for (const w of extra) score -= PROCESSED.has(w) ? 6 : PART.has(w) ? 4 : NEUTRAL.has(w) ? 0.25 : 2;
    if (words.includes('raw') && !wanted.includes('raw')) score += 1.5;
    if (words[0] === wanted[0] || words[0] === wanted[wanted.length - 1]) score += 1;
    if (BRANDED_CATEGORIES.test(food.foodCategory ?? '')) score -= 8;
    // SR Legacy entries carry household portions (a cup, a medium onion); Foundation ones often don't.
    if (food.dataType === 'SR Legacy') score += 0.5;
    if (!best || score > best.score) best = { food, score };
  }
  // Too many unrelated words: it's a dish that happens to contain the ingredient.
  return best && best.score > -7 ? best.food : null;
}

const PORTION_UNITS: Array<[RegExp, string]> = [
  [/^(cups?)\b/, 'cup'], [/^(tbsp|tablespoons?)\b/, 'tbsp'], [/^(tsp|teaspoons?)\b/, 'tsp'], [/^fl\.? ?oz\b/, 'fl oz'],
  [/^(medium|whole|each|item|fruit|unit)\b/, 'each'], [/^large\b/, 'large'], [/^small\b/, 'small'],
  // "1/2 chicken, bone removed": a whole bird, for a recipe's "1 chicken".
  [/^chicken\b/, 'each'],
  [/^cloves?\b/, 'clove'], [/^slices?\b/, 'slice'], [/^stalks?\b/, 'stalk'], [/^sprigs?\b/, 'sprig'], [/^(leaf|leaves)\b/, 'leaf'],
  [/^heads?\b/, 'head'], [/^sticks?\b/, 'stick'], [/^fillets?\b/, 'fillet'], [/^breasts?\b/, 'breast'], [/^thighs?\b/, 'thigh'],
  [/^pieces?\b/, 'piece'], [/^strips?\b/, 'strip'], [/^pods?\b/, 'pod'], [/^bulbs?\b/, 'bulb'], [/^(egg|eggs)\b/, 'each'],
];

/** Grams per kitchen unit from a food's portions: { cup: 160, tbsp: 10, each: 110 }. */
export function portionsOf(detail: FdcFoodDetail | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const portions = [...(detail?.foodPortions ?? [])].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
  for (const p of portions) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const unitName = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    const text = `${unitName} ${p.modifier ?? ''} ${p.portionDescription ?? ''}`.toLowerCase().replace(/^\s*[\d./]+\s*/, '').trim();
    // "unit (yield from 1 lb ready-to-cook chicken)" is what a pound turns into, not one of anything.
    if (/yield from/.test(text)) continue;
    const unit = PORTION_UNITS.find(([re]) => re.test(text))?.[1];
    // The first portion listed for a unit is the plain one ("cup, chopped" before "cup, sliced").
    if (unit && out[unit] === undefined) out[unit] = +(p.gramWeight / (p.amount && p.amount > 0 ? p.amount : 1)).toFixed(2);
  }
  // A bare count ("2 onions") means a medium one; failing that, whatever size is listed, or
  // the food's own piece ("2 chicken breasts" against "1 piece", "4 chicken thighs" against "1 thigh").
  if (out.each === undefined) { const size = out.large ?? out.small ?? out.piece ?? out.fillet ?? out.thigh; if (size !== undefined) out.each = size; }
  return out;
}

/** A cache row from a search hit and its detail record. */
export function factsFromFdc(key: string, food: FdcSearchFood | null, detail?: FdcFoodDetail | null): Facts {
  const n = food ? per100g(food) : null;
  if (!food || !n) return { key, matched: false, fdc_id: null, description: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, portions: {} };
  return { key, matched: true, fdc_id: food.fdcId, description: food.description, kcal: n.kcal, protein_g: n.protein, carbs_g: n.carbs, fat_g: n.fat, fiber_g: n.fiber, portions: portionsOf(detail) };
}

// ── From a recipe's amounts to grams ───────────────────────────────────────

export interface MeasuredIngredient { name_us: string; quantity: number | null; quantity_max?: number | null; unit: string }

/** Amounts too small to matter, whatever they're of. */
const TRACE_UNITS = new Set(['pinch', 'dash', 'drop']);
/** Millilitres in each unit a food's portions may be given in. */
const PORTION_ML: Array<[string, number]> = [['cup', VOLUME.cup], ['tbsp', VOLUME.tbsp], ['tsp', VOLUME.tsp], ['fl oz', VOLUME['fl oz']]];

/**
 * What an ingredient weighs, in grams. Weights convert directly. A volume needs the food's
 * own weight per cup or spoon, and a count needs its weight per piece: without them the
 * answer is null (it can't be weighed), not a guess.
 */
export function gramsOf(ing: MeasuredIngredient, portions: Record<string, number>): number | null {
  if (ing.quantity === null || !(ing.quantity > 0)) return null;
  // A range ("1-2 tbsp") counts as its middle.
  const quantity = ing.quantity_max && ing.quantity_max > ing.quantity ? (ing.quantity + ing.quantity_max) / 2 : ing.quantity;
  const family = unitFamily(ing.unit);
  if (family === 'mass') return quantity * MASS[ing.unit];
  if (family === 'volume') {
    const ml = quantity * VOLUME[ing.unit];
    const known = PORTION_ML.find(([unit]) => portions[unit] !== undefined);
    return known ? ml * (portions[known[0]] / known[1]) : null;
  }
  if (TRACE_UNITS.has(ing.unit)) return 0;
  const perPiece = ing.unit ? portions[ing.unit] : portions.each;
  return perPiece !== undefined ? quantity * perPiece : null;
}

// ── A recipe's nutrition ───────────────────────────────────────────────────

export interface RecipeNutrition {
  servings: number;
  perServing: Nutrients;
  /** For all `servings`. */
  total: Nutrients;
  /** How many ingredients are in the numbers, out of how many the recipe has. */
  counted: number;
  ingredients: number;
  /** Ingredient names USDA had no usable match for. */
  unmatched: string[];
  /** Matched, but the recipe's amount can't be turned into a weight ("1 can", "2 handfuls"). */
  unweighed: string[];
  /** Listed with no amount at all ("to taste", "to serve"). */
  noAmount: string[];
}

const scale = (n: Nutrients, by: number): Nutrients => ({ kcal: n.kcal * by, protein: n.protein * by, carbs: n.carbs * by, fat: n.fat * by, fiber: n.fiber * by });
const add = (a: Nutrients, b: Nutrients): Nutrients => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat, fiber: a.fiber + b.fiber });

/**
 * Adds up a recipe. The recipe as written is `BASE_SERVINGS` servings, so one serving is a
 * quarter of it whatever number is being cooked; `total` is for all of the servings asked
 * for, and grows with them the way the ingredient amounts do.
 */
export function recipeNutrition(ingredients: readonly MeasuredIngredient[], factsFor: (key: string) => Facts | null | undefined, servings: number = BASE_SERVINGS): RecipeNutrition {
  let asWritten = NO_NUTRIENTS;
  let counted = 0;
  const unmatched: string[] = [], unweighed: string[] = [], noAmount: string[] = [];
  for (const ing of ingredients) {
    const key = nutritionKey(ing.name_us);
    if (hasNoCalories(key)) { counted++; continue; }
    if (ing.quantity === null || !(ing.quantity > 0)) { noAmount.push(ing.name_us); continue; }
    const facts = factsFor(key);
    if (!facts?.matched || facts.kcal === null) { unmatched.push(ing.name_us); continue; }
    const grams = gramsOf(ing, facts.portions ?? {});
    if (grams === null) { unweighed.push(ing.name_us); continue; }
    asWritten = add(asWritten, scale({ kcal: facts.kcal, protein: facts.protein_g ?? 0, carbs: facts.carbs_g ?? 0, fat: facts.fat_g ?? 0, fiber: facts.fiber_g ?? 0 }, grams / 100));
    counted++;
  }
  const perServing = scale(asWritten, 1 / BASE_SERVINGS);
  return { servings, perServing, total: scale(perServing, servings), counted, ingredients: ingredients.length, unmatched, unweighed, noAmount };
}

/** Numbers as they're shown: calories to the nearest 10 (they're estimates), grams to the nearest 1. */
export function rounded(n: Nutrients): Nutrients {
  return { kcal: Math.round(n.kcal / 10) * 10, protein: Math.round(n.protein), carbs: Math.round(n.carbs), fat: Math.round(n.fat), fiber: Math.round(n.fiber) };
}

/** How much of the recipe to cook for this many servings. */
export const servingsMultiplier = (servings: number) => servings / BASE_SERVINGS;
