// Grocery list from the week's recipes: one item per ingredient, amounts summed across
// meals where the units can be converted (all weights together, all volumes together,
// each countable unit together), and kept as separate lines where they can't ("1 lb"
// and "6 whole"). Measures with no amount ("handful", "to taste") or no measure at all
// show which recipe needs them instead. Pure: no network, unit-tested in tests/.

import { formatBase, toBase, type UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';

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

export interface MergeRecipe { id: number; title: string; ingredients: MergeIngredient[] }

/** One summed amount: a family ("mass", "volume", "count:clove") and its base-unit total. */
export interface AmountLine { family: string; value: number }
/** An amount we can't add up, with the recipe it's for. */
export interface NoteLine { text: string; recipe: string }

/** Bumped when the way lists are built changes, so saved lists rebuild themselves. */
export const LIST_VERSION = 4;

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
}

// Things nobody buys for a recipe.
const SKIP = new Set(['ice', 'ice cube', 'ice cubes']);
// Pantry staples: shown in "Probably have it". Matched on the normalized key.
const STAPLES = /^(salt|sea salt|kosher salt|table salt|flaky sea salt|coarse salt|(black |white |ground black |freshly ground black )?pepper|black peppercorns?|peppercorns?|water|cold water|hot water|warm water|boiling water|olive oil|extra virgin olive oil|vegetable oil|sunflower oil|canola oil|rapeseed oil|cooking oil|oil|groundnut oil|corn oil)$/;

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

export function combine(recipes: MergeRecipe[], aisleOf: (rawName: string) => Aisle | undefined): GroceryItem[] {
  const byKey = new Map<string, { name: string; aisle: Aisle; totals: Map<string, number>; notes: NoteLine[]; meals: string[]; recipes: number[] }>();
  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = itemKey(ing.name_us || ing.name);
      if (!key || SKIP.has(key)) continue;
      let entry = byKey.get(key);
      if (!entry) {
        const display = shoppingName(ing.name_us || ing.name);
        entry = { name: display.charAt(0).toUpperCase() + display.slice(1), aisle: aisleOf(ing.name.toLowerCase()) ?? 'Other', totals: new Map(), notes: [], meals: [], recipes: [] };
        byKey.set(key, entry);
      }
      entry.meals.push(recipe.title);
      entry.recipes.push(recipe.id);
      if (ing.quantity !== null && ing.quantity > 0) {
        // Ranges buy the upper amount.
        const qty = ing.quantity_max && ing.quantity_max > ing.quantity ? ing.quantity_max : ing.quantity;
        const { family, value } = toBase(qty, ing.unit || IMPLIED_UNIT[baseKey(ing.name_us || ing.name)] || '');
        entry.totals.set(family, (entry.totals.get(family) ?? 0) + value);
      } else {
        const text = ing.measure_raw.trim();
        entry.notes.push({ text, recipe: recipe.title });
      }
    }
  }
  const items: GroceryItem[] = [];
  for (const [key, e] of byKey) {
    // A note only matters when it isn't already covered by a real amount from the same recipe.
    const notes = e.notes.filter(n => n.text || !e.totals.size);
    items.push({
      v: LIST_VERSION, key, name: e.name, aisle: e.aisle, staple: STAPLES.test(key),
      amounts: [...e.totals].map(([family, value]) => ({ family, value })),
      notes, meals: e.meals, recipes: e.recipes,
    });
  }
  return items.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
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
