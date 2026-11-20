// Grocery list from the week's recipes: one item per ingredient, amounts summed across
// meals where the units can be converted without guessing (all weights together, all
// volumes together, each countable unit together), and kept as separate lines where they
// can't ("1 lb" and "6 whole": nobody can say what six tomatoes weigh). Measures with no
// amount ("handful", "to taste") or no measure at all show which recipe needs them.
//
// Each item keeps what every recipe contributes to it (`parts`), so a recipe can be taken
// off the list and put back, and the list can be shown recipe by recipe, without building
// it again. Pure: no network, unit-tested in tests/.

import { COUNT_UNITS, COUNT_WORDS, formatBase, NUMBER_RE, toBase, type UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';

export const AISLES = ['Produce', 'Meat and seafood', 'Dairy and eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'] as const;
export type Aisle = typeof AISLES[number];
/** Things most kitchens already have; listed last, collapsed. */
export const STAPLES_GROUP = 'Probably have it';

export interface MergeIngredient {
  name: string;
  name_us: string;
  measure_raw: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string;
}

export interface MergeRecipe {
  id: number; title: string; ingredients: MergeIngredient[];
  /**
   * How much of the recipe this meal buys for (default 1): a school lunch for 2 children is
   * 0.5, a double batch for leftovers 2. Measures with no amount are listed whatever it is.
   */
  multiplier?: number;
}

/** One summed amount: a family ("mass", "volume", "count:clove") and its base-unit total. */
export interface AmountLine { family: string; value: number }
/** An amount we can't add up, with the recipe it's for. */
export interface NoteLine { text: string; recipe: string }

/** Bumped when the way lists are built changes, so saved lists rebuild themselves. */
export const LIST_VERSION = 7;

/** What one planned meal needs of an item. `family` is null when its measure has no amount. */
export interface ItemPart { recipe: number; title: string; family: string | null; value: number; note: string }

export interface GroceryItem {
  /** LIST_VERSION the item was built with. */
  v?: number;
  /** Stable id (normalized US name); ticks are stored by key. */
  key: string;
  name: string;
  aisle: Aisle;
  staple: boolean;
  amounts: AmountLine[];
  notes: NoteLine[];
  /** Titles of the planned meals that use it (one per meal, in plan order). */
  meals: string[];
  /** Ids of those meals' recipes, in the same order. */
  recipes: number[];
  /** One per planned meal that uses it, in plan order: what `amounts`, `notes`, `meals` and `recipes` are summed from. */
  parts: ItemPart[];
}

// Things nobody buys for a recipe.
const SKIP = new Set(['ice', 'ice cube', 'ice cubes']);
// Pantry staples: shown in "Probably have it". Matched on the normalized key.
const STAPLES = /^(salt|sea salt|kosher salt|table salt|flaky sea salt|coarse salt|(black |white |ground black |freshly ground black )?pepper|black peppercorns?|peppercorns?|water|cold water|hot water|warm water|boiling water|olive oil|extra virgin olive oil|vegetable oil|sunflower oil|canola oil|rapeseed oil|cooking oil|oil|groundnut oil|corn oil)$/;

/** Salt, pepper, water, cooking oil: things a kitchen has without shopping for them. */
export const isStaple = (key: string) => STAPLES.test(key);

function singular(word: string): string {
  if (/(ss|us|is)$/.test(word) || word.length <= 3) return word;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('leaves')) return word.slice(0, -6) + 'leaf';
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

// Same thing, different names, after US conversion. Values are the canonical key.
const ALIASES: Record<string, string> = {
  'garlic clove': 'garlic', 'clove garlic': 'garlic', 'garlic glove': 'garlic',
  'free-range egg': 'egg', 'free range egg': 'egg', 'large egg': 'egg', 'egg': 'egg',
  'fresh cilantro': 'cilantro', 'cilantro leaf': 'cilantro', 'chopped cilantro': 'cilantro',
  'fresh basil': 'basil', 'basil leaf': 'basil', 'fresh basil leaf': 'basil',
  'fresh parsley': 'parsley', 'flat leaf parsley': 'parsley', 'flat-leaf parsley': 'parsley', 'chopped parsley': 'parsley', 'parsley leaf': 'parsley',
  'fresh mint': 'mint', 'mint leaf': 'mint', 'fresh thyme': 'thyme', 'thyme sprig': 'thyme', 'fresh rosemary': 'rosemary',
  'scallion': 'green onion', 'spring onion': 'green onion',
  'zucchini': 'zucchini', 'courgette': 'zucchini',
  'eggplant': 'eggplant', 'aubergine': 'eggplant',
  'red onion': 'red onion', 'onion': 'onion', 'white onion': 'onion', 'brown onion': 'onion', 'yellow onion': 'onion',
};

// Names that say the unit: "Garlic Clove, 2" is two cloves.
const IMPLIED_UNIT: Record<string, string> = { 'garlic clove': 'clove', 'clove garlic': 'clove', 'garlic glove': 'clove' };

// Prep words describe what to do at home, not what to buy: "Chopped onion" is onions.
// Canned products keep theirs ("chopped tomatoes", "crushed tomatoes").
const PREP = /^(?:(?:finely|roughly|thinly|freshly)\s+)?(?:chopped|diced|sliced|minced|grated|crushed|shredded|peeled)\s+(?!tomato)/;

/** "Chopped onion" -> "Onion" for display; canned "Chopped tomatoes" unchanged. */
export function shoppingName(nameUs: string): string {
  const stripped = nameUs.trim().replace(new RegExp(PREP.source, 'i'), '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function baseKey(nameUs: string): string {
  const words = nameUs.toLowerCase().replace(PREP, '').replace(/[^a-z0-9\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

/** "Garlic Cloves" -> "garlic"; "Cherry Tomatoes" -> "cherry tomato". */
export function itemKey(nameUs: string): string {
  const key = baseKey(nameUs);
  return ALIASES[key] ?? key;
}

const LEADING_NUMBER = new RegExp(String.raw`^\s*${NUMBER_RE}(?:\s*(?:-|to)\s*${NUMBER_RE})?`);

/**
 * What a number with no recognized unit is counting. The measure parser leaves the unit
 * empty when a describing word comes first ("5 chopped cloves", "2 large tins"), and some
 * words it doesn't know at all ("2 x 400g", "2 kaffir leaves"). Only a number followed by
 * nothing but describing words ("2", "1 large") is a count of whole things; a known unit
 * after them is that unit; anything else is kept as written. Null: don't add it up.
 */
export function countUnit(measureRaw: string): string | null {
  const rest = measureRaw.toLowerCase().replace(LEADING_NUMBER, '').replace(/\([^)]*\)/g, ' ');
  const words = rest.split(/[\s,]+/).filter(Boolean).filter(w => !COUNT_WORDS.has(w));
  if (!words.length) return '';
  if (words.length === 1 && COUNT_UNITS[words[0]]) return COUNT_UNITS[words[0]];
  return null;
}

/** The totals for a set of parts: amounts summed per unit family, and the measures that can't be summed. */
function summed(parts: readonly ItemPart[]): Pick<GroceryItem, 'amounts' | 'notes' | 'meals' | 'recipes'> {
  const totals = new Map<string, number>();
  for (const p of parts) if (p.family !== null) totals.set(p.family, (totals.get(p.family) ?? 0) + p.value);
  return {
    amounts: [...totals].map(([family, value]) => ({ family, value })),
    // A measure with no words and no amount only matters when nothing else says how much to buy.
    notes: parts.filter(p => p.family === null && (p.note || !totals.size)).map(p => ({ text: p.note, recipe: p.title })),
    meals: parts.map(p => p.title),
    recipes: parts.map(p => p.recipe),
  };
}

export function combine(recipes: MergeRecipe[], aisleOf: (rawName: string) => Aisle | undefined): GroceryItem[] {
  const byKey = new Map<string, { name: string; aisle: Aisle; parts: ItemPart[] }>();
  for (const recipe of recipes) {
    const times = recipe.multiplier ?? 1;
    if (!(times > 0)) continue;
    for (const ing of recipe.ingredients) {
      const key = itemKey(ing.name_us || ing.name);
      if (!key || SKIP.has(key)) continue;
      let entry = byKey.get(key);
      if (!entry) {
        const display = shoppingName(ing.name_us || ing.name);
        entry = { name: display.charAt(0).toUpperCase() + display.slice(1), aisle: aisleOf(ing.name.toLowerCase()) ?? 'Other', parts: [] };
        byKey.set(key, entry);
      }
      if (ing.quantity !== null && ing.quantity > 0) {
        // Ranges buy the upper amount.
        const qty = ing.quantity_max && ing.quantity_max > ing.quantity ? ing.quantity_max : ing.quantity;
        const unit = ing.unit || IMPLIED_UNIT[baseKey(ing.name_us || ing.name)] || countUnit(ing.measure_raw);
        if (unit === null) {
          // A number we can't say what it counts: kept as written, beside the amounts that add up.
          entry.parts.push({ recipe: recipe.id, title: recipe.title, family: null, value: 0, note: ing.measure_raw.trim() });
          continue;
        }
        const { family, value } = toBase(qty * times, unit);
        entry.parts.push({ recipe: recipe.id, title: recipe.title, family, value, note: '' });
      } else {
        entry.parts.push({ recipe: recipe.id, title: recipe.title, family: null, value: 0, note: ing.measure_raw.trim() });
      }
    }
  }
  const items: GroceryItem[] = [...byKey].map(([key, e]) => ({ v: LIST_VERSION, key, name: e.name, aisle: e.aisle, staple: STAPLES.test(key), ...summed(e.parts), parts: e.parts }));
  return items.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/**
 * The list without some recipes: their share comes off every amount, and items only they
 * needed drop out. Putting a recipe back is the same call without it.
 */
export function withoutRecipes(items: readonly GroceryItem[], excluded: ReadonlySet<number>): GroceryItem[] {
  if (!excluded.size) return [...items];
  return items.flatMap(item => {
    const parts = (item.parts ?? []).filter(p => !excluded.has(p.recipe));
    return parts.length ? [{ ...item, ...summed(parts), parts }] : [];
  });
}

/** What one recipe needs, as list items carrying only that recipe's amounts (for the list grouped by recipe). */
export function recipeItems(items: readonly GroceryItem[], recipeId: number): GroceryItem[] {
  return items.flatMap(item => {
    const parts = (item.parts ?? []).filter(p => p.recipe === recipeId);
    // The meals stay the full list, so a row can say what else the item is for.
    return parts.length ? [{ ...item, ...summed(parts), meals: item.meals, parts }] : [];
  });
}

/** Display lines for an item's amounts: ["2 lb", "6 whole"]. */
export function amountLines(item: Pick<GroceryItem, 'amounts'>, system: UnitSystem): string[] {
  return item.amounts.map(a => {
    const text = formatBase(a.family, a.value, system);
    return a.family === 'count:' ? `${text} whole` : text;
  });
}

/**
 * Recipes the household has started shopping for: any checked item on the list uses them.
 * Staples don't count, or a ticked "Salt" would mark the whole week as bought.
 */
export function shoppedRecipeIds(items: readonly Pick<GroceryItem, 'key' | 'staple' | 'recipes'>[], checked: Iterable<string>): Set<number> {
  const ticked = new Set(checked);
  return new Set(items.filter(i => !i.staple && ticked.has(i.key)).flatMap(i => i.recipes ?? []));
}

/**
 * Recipes whose day the daily update must leave alone because of the grocery list: any
 * with an ingredient ticked off, read from the whole list (a recipe taken off the list
 * keeps its ticks), and any the household took off the list, usually because they already
 * have what it needs.
 */
export function protectedByList(list: { items: readonly Pick<GroceryItem, 'key' | 'staple' | 'recipes'>[]; checked: Iterable<string>; excluded: readonly number[] }): Set<number> {
  return new Set([...shoppedRecipeIds(list.items, list.checked), ...list.excluded]);
}

/** Distinct meal titles, for "for 2 meals" and its expanded list. */
export const uniqueMeals = (item: Pick<GroceryItem, 'meals'>) => [...new Set(item.meals)];

/** Plain-text list for copy/share; ticked items are left out. */
export function listText(items: GroceryItem[], custom: Array<{ key: string; name: string }>, checked: Set<string>, system: UnitSystem): string {
  const lines: string[] = ['Grocery list'];
  for (const aisle of AISLES) {
    const left = items.filter(i => i.aisle === aisle && !i.staple && !checked.has(i.key));
    if (!left.length) continue;
    lines.push('', aisle);
    for (const i of left) {
      const amount = amountLines(i, system).join(', ') || i.notes.map(n => n.text).filter(Boolean).join(', ');
      lines.push(`- ${i.name}${amount ? `, ${amount}` : ''}`);
    }
  }
  const extra = custom.filter(c => !checked.has(c.key));
  if (extra.length) lines.push('', 'Also', ...extra.map(c => `- ${c.name}`));
  return lines.join('\n');
}

/** The Monday (local) of the week a moment falls in, as YYYY-MM-DD. */
function mondayOf(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Whether a list is still for the same shop: the same plan, or a plan made again in the
 * same calendar week (re-planning mid-week after the big shop keeps what's been bought).
 * A list from before plans were recorded counts as the same shop.
 */
export function sameShop(previousPlanCreatedAt: string | null, planCreatedAt: string): boolean {
  return !previousPlanCreatedAt || mondayOf(previousPlanCreatedAt) === mondayOf(planCreatedAt);
}

/** How much of a planned meal's recipe to buy: its share (school lunches), twice for a double batch, nothing for leftovers. */
export const entryMultiplier = (e: { share?: number; cookTimes?: number; leftoverOf?: unknown }) =>
  e.leftoverOf ? 0 : (e.share ?? 1) * (e.cookTimes ?? 1);
