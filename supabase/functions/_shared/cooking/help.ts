// Cooking help: swaps for a missing ingredient and variations on a recipe. Pure TypeScript
// (Deno, Vite, Node), so the app and the cooking-help Edge Function share it, and
// tests/cookingHelp.test.ts runs it.
//
// Common swaps (buttermilk, eggs, butter, sour cream, wine, fresh and dried herbs) come
// from the table here: instant, free and the same every time, with amounts for what the
// recipe needs. Everything else is asked of the model by the Edge Function. Whatever the
// source, every suggestion passes the family's filter (safeHelp): an allergy anyone in the
// family has, a "never" ingredient, or a diet it breaks, and it is not shown.

import { classifyRecipe, ingredientAllergens } from '../catalog/allergens.ts';
import { normalizeIngredient, recipeChecker, type FoodPrefs } from '../catalog/recipeFilter.ts';
import { formatBase, formatNumber, MASS, VOLUME, type UnitSystem } from '../catalog/units.ts';

export interface HelpIngredient {
  name: string;
  name_us?: string | null;
  quantity: number | null;
  unit: string;
}

/** One way to do without an ingredient. */
export interface Swap {
  /** What to use, with the amount: "1 cup milk plus 1 tbsp lemon juice". */
  use: string;
  /** How, in a sentence: "Stir and let it sit for 5 minutes." */
  how: string;
  /** Each ingredient the swap uses, for the family's filter. */
  uses: string[];
}

/** One way to make the recipe different. */
export interface Variation {
  title: string;
  summary: string;
  /** What changes, step by step: "Stir in 2 cups spinach at the end." */
  changes: string[];
  /** Ingredients it adds. */
  adds: string[];
  /** Ingredients it leaves out. */
  removes: string[];
}

// ── The table ──────────────────────────────────────────────────────────────

type Need = { kind: 'volume'; ml: number } | { kind: 'count'; n: number } | { kind: 'unknown' };

/** One ingredient of a swap: how much per unit of what the recipe asks for (ml per ml, or ml per egg), and what. */
type Part = [perUnit: number, what: string];
interface TableOption { parts: Part[]; how: string; uses: string[] }
interface Entry {
  /** "buttermilk", "egg", "fresh parsley": said as "No buttermilk?". */
  missing: string;
  basis: 'volume' | 'count';
  /** When the amount isn't known: the unit a rule of thumb is given for. */
  per: { ml: number; label: string };
  /** Grams per ml, for an amount given by weight. */
  density?: number;
  options: TableOption[];
}

const CUP = VOLUME.cup;
const TBSP = VOLUME.tbsp;

const BUTTERMILK: Entry = {
  missing: 'buttermilk', basis: 'volume', per: { ml: CUP, label: 'cup of buttermilk' }, density: 1.03,
  options: [
    { parts: [[1, 'milk'], [1 / 16, 'lemon juice']], how: 'Stir and let it sit for 5 minutes, until it thickens a little.', uses: ['milk', 'lemon juice'] },
    { parts: [[1, 'milk'], [1 / 16, 'white vinegar']], how: 'Stir and let it sit for 5 minutes.', uses: ['milk', 'white vinegar'] },
    { parts: [[3 / 4, 'plain yogurt'], [1 / 4, 'milk']], how: 'Whisk until smooth.', uses: ['plain yogurt', 'milk'] },
    { parts: [[1, 'oat milk'], [1 / 16, 'lemon juice']], how: 'Stir and let it sit for 5 minutes. A dairy-free swap that works in baking and marinades.', uses: ['oat milk', 'lemon juice'] },
    { parts: [[1, 'soy milk'], [1 / 16, 'lemon juice']], how: 'Stir and let it sit for 5 minutes. A dairy-free swap that thickens the same way.', uses: ['soy milk', 'lemon juice'] },
  ],
};

const EGG: Entry = {
  missing: 'eggs', basis: 'count', per: { ml: 1, label: 'egg' },
  options: [
    { parts: [[TBSP, 'ground flaxseed'], [3 * TBSP, 'water']], how: 'Mix and let it sit for 5 minutes until it gels. Works for binding and baking, not for scrambling.', uses: ['ground flaxseed', 'water'] },
    { parts: [[3 * TBSP, 'aquafaba (the liquid from a can of chickpeas)']], how: 'Whisk until foamy. Good in baking, and it whips like egg white.', uses: ['aquafaba', 'chickpea'] },
    { parts: [[CUP / 4, 'unsweetened applesauce']], how: 'Best in sweet bakes like muffins and cakes. They come out a little denser.', uses: ['unsweetened applesauce'] },
    { parts: [[CUP / 4, 'mashed ripe banana']], how: 'Best in sweet bakes. It adds a little banana flavor.', uses: ['banana'] },
  ],
};

const BUTTER: Entry = {
  missing: 'butter', basis: 'volume', per: { ml: TBSP, label: 'tablespoon of butter' }, density: 0.93,
  options: [
    { parts: [[3 / 4, 'olive oil']], how: 'For cooking and roasting. In baking, use a mild oil instead.', uses: ['olive oil'] },
    { parts: [[3 / 4, 'vegetable oil']], how: 'Works in most baking and cooking. Bakes come out a little moister.', uses: ['vegetable oil'] },
    { parts: [[1, 'coconut oil']], how: 'Melt it if the recipe melts the butter, or use it solid if the butter is creamed.', uses: ['coconut oil'] },
  ],
};

const SOUR_CREAM: Entry = {
  missing: 'sour cream', basis: 'volume', per: { ml: CUP, label: 'cup of sour cream' }, density: 1,
  options: [
    { parts: [[1, 'plain Greek yogurt']], how: 'Stir it in off the heat, or it can split.', uses: ['Greek yogurt'] },
    { parts: [[1, 'crème fraîche']], how: 'Richer, and it won\'t split in a hot sauce.', uses: ['crème fraîche'] },
    { parts: [[1, 'mashed ripe avocado'], [1 / 16, 'lemon juice']], how: 'As a topping or dip only, not for cooking.', uses: ['avocado', 'lemon juice'] },
  ],
};

const WHITE_WINE: Entry = {
  missing: 'white wine', basis: 'volume', per: { ml: CUP, label: 'cup of wine' }, density: 1,
  options: [
    { parts: [[1, 'vegetable stock'], [1 / 16, 'lemon juice']], how: 'Use it the same way. The lemon gives the sharpness the wine would.', uses: ['vegetable stock', 'lemon juice'] },
    { parts: [[1, 'chicken stock'], [1 / 48, 'white wine vinegar']], how: 'Use it the same way.', uses: ['chicken stock', 'white wine vinegar'] },
  ],
};

const RED_WINE: Entry = {
  missing: 'red wine', basis: 'volume', per: { ml: CUP, label: 'cup of wine' }, density: 1,
  options: [
    { parts: [[1, 'beef stock'], [1 / 48, 'balsamic vinegar']], how: 'Use it the same way. Good in stews and sauces.', uses: ['beef stock', 'balsamic vinegar'] },
    { parts: [[1, 'vegetable stock'], [1 / 48, 'red wine vinegar']], how: 'Use it the same way.', uses: ['vegetable stock', 'red wine vinegar'] },
  ],
};

const HERBS = ['parsley', 'basil', 'thyme', 'oregano', 'rosemary', 'dill', 'cilantro', 'coriander', 'mint', 'sage', 'tarragon', 'chive', 'marjoram'];
// Soft herbs lose most of their flavor dried.
const SOFT_HERBS = new Set(['parsley', 'basil', 'dill', 'cilantro', 'coriander', 'mint', 'chive']);

function freshHerb(herb: string): Entry {
  const soft = SOFT_HERBS.has(herb);
  return {
    missing: `fresh ${herb}`, basis: 'volume', per: { ml: TBSP, label: `tablespoon of fresh ${herb}` },
    options: [{
      parts: [[1 / 3, `dried ${herb}`]],
      how: soft
        ? `Dried is stronger, so use a third as much and add it with the liquid so it softens. Dried ${herb} is milder than fresh; for a garnish, leave it out.`
        : 'Dried is stronger, so use a third as much and add it early, with the liquid.',
      uses: [`dried ${herb}`],
    }],
  };
}

function driedHerb(herb: string): Entry {
  return {
    missing: `dried ${herb}`, basis: 'volume', per: { ml: VOLUME.tsp, label: `teaspoon of dried ${herb}` },
    options: [{ parts: [[3, `chopped fresh ${herb}`]], how: 'Fresh is milder, so use three times as much and add it near the end.', uses: [`fresh ${herb}`] }],
  };
}

const HERB = HERBS.join('|');
const FRESH_HERB = new RegExp(`^(?:fresh\\s+)?(?:flat leaf\\s+|italian\\s+|curly\\s+)?(${HERB})(?:\\s+(?:leaf|sprig))?$`);
const DRIED_HERB = new RegExp(`^dried\\s+(${HERB})(?:\\s+leaf)?$`);

/** The table's entry for an ingredient, by its name. */
function entryFor(names: string[]): Entry | null {
  for (const raw of names) {
    const n = normalizeIngredient(raw);
    // The ingredient itself, not a product named after it ("buttermilk biscuits").
    if (/^(?:(?:low fat|lowfat|full fat|cultured)\s+)?buttermilk$/.test(n)) return BUTTERMILK;
    if (/^(?:(?:large|medium|small|extra large|free range|whole|organic|beaten|room temperature)\s+)*egg(?:\s+(?:lightly\s+)?(?:beaten|whisked))?$/.test(n)) return EGG;
    if (/^(?:(?:unsalted|salted|softened|melted|cold|chilled|cubed|room temperature)\s+)*butter$/.test(n)) return BUTTER;
    if (/^(?:(?:light|low fat|full fat|reduced fat)\s+)?sour cream$/.test(n)) return SOUR_CREAM;
    if (/^(?:dry\s+|crisp\s+)?white wine$|^wine$/.test(n)) return WHITE_WINE;
    if (/^(?:dry\s+|full bodied\s+)?red wine$/.test(n)) return RED_WINE;
    const dried = n.match(DRIED_HERB);
    if (dried) return driedHerb(dried[1]);
    const fresh = n.match(FRESH_HERB);
    if (fresh) return freshHerb(fresh[1]);
  }
  return null;
}

/** How much the recipe needs, in ml (or eggs), at the chosen servings. */
function needOf(ing: HelpIngredient, scale: number, entry: Entry): Need {
  if (ing.quantity === null || !(ing.quantity > 0)) return { kind: 'unknown' };
  const q = ing.quantity * scale;
  if (entry.basis === 'count') return ing.unit === '' ? { kind: 'count', n: q } : { kind: 'unknown' };
  if (ing.unit in VOLUME) return { kind: 'volume', ml: q * VOLUME[ing.unit] };
  if (ing.unit in MASS && entry.density) return { kind: 'volume', ml: (q * MASS[ing.unit]) / entry.density };
  if (ing.unit === 'stick' && entry === BUTTER) return { kind: 'volume', ml: q * 8 * TBSP };
  return { kind: 'unknown' };
}

/** A volume to measure: small US amounts stay in spoons ("6 tbsp", not "1/3 cup"). */
function amount(ml: number, system: UnitSystem): string {
  // A clean cup fraction (1/4, 1/3) reads as cups; anything else under half a cup in spoons.
  const cupFraction = [1 / 4, 1 / 3].some(f => Math.abs(ml - f * CUP) <= 2);
  if (system === 'us' && !cupFraction && ml >= TBSP - 1 && ml < CUP / 2) return `${formatNumber(Math.round((ml / TBSP) * 2) / 2)} tbsp`;
  return formatBase('volume', ml, system);
}

function describe(option: TableOption, need: Need, entry: Entry, system: UnitSystem): Swap {
  const total = (perUnit: number) => (need.kind === 'volume' ? perUnit * need.ml : need.kind === 'count' ? perUnit * need.n : perUnit * entry.per.ml);
  const parts = option.parts.map(([perUnit, what]) => `${amount(total(perUnit), system)} ${what}`).join(' plus ');
  const use = need.kind === 'unknown' ? `For each ${entry.per.label}, use ${parts}` : `Use ${parts}`;
  return { use, how: option.how, uses: option.uses };
}

/**
 * Swaps from the table for this ingredient, with amounts for what the recipe needs at
 * `scale` (servings chosen / servings written), in the household's units. Null when the
 * table doesn't cover it: then the model is asked.
 */
export function tableSwaps(ing: HelpIngredient, scale: number, system: UnitSystem): { missing: string; swaps: Swap[] } | null {
  const entry = entryFor([ing.name_us ?? '', ing.name].filter(Boolean));
  if (!entry) return null;
  const need = needOf(ing, scale, entry);
  return { missing: entry.missing, swaps: entry.options.map(o => describe(o, need, entry, system)) };
}

// ── The family's filter ────────────────────────────────────────────────────

/**
 * Keeps only suggestions the family can eat: nothing anyone is allergic to, no "never"
 * ingredient, nothing that breaks the household's diet. Reads every word of a suggestion,
 * not only the ingredients it lists, so a swap that mentions almond milk in passing is out.
 * It leans broad on purpose, like the recipe filter.
 */
export function safeHelp<T>(items: readonly T[], prefs: FoodPrefs, parts: (item: T) => { uses: string[]; text: string[] }): T[] {
  const check = recipeChecker(prefs);
  return items.filter(item => {
    const { uses, text } = parts(item);
    const names = [...uses, ...text].map(s => s.trim()).filter(Boolean);
    const allergens = [...new Set(names.flatMap(ingredientAllergens))];
    // Diets read every word too: a swap that says "chicken stock" isn't vegetarian, whatever it lists.
    const { diets } = classifyRecipe({ name: '', category: '', ingredientNames: names });
    return check({ name: '', ingredient_names: names, allergens, diets }).allowed;
  });
}

export const safeSwaps = (swaps: readonly Swap[], prefs: FoodPrefs) =>
  safeHelp(swaps, prefs, s => ({ uses: s.uses, text: [s.use, s.how] }));

export const safeVariations = (variations: readonly Variation[], prefs: FoodPrefs) =>
  safeHelp(variations, prefs, v => ({ uses: v.adds, text: [v.title, v.summary, ...v.changes] }));

/**
 * A title in the app's sentence case: "Bright Lemon Herb" -> "Bright lemon herb". Only when
 * every word is capitalized (a Title Case answer); names in a sentence-case title stay.
 */
export function sentenceCase(title: string): string {
  const minor = /^(and|or|of|in|with|the|a|an|to|for|on|over)$/i;
  const words = title.split(' ');
  const main = words.filter(w => !minor.test(w));
  if (main.length < 2 || !main.every(w => /^[A-Z]/.test(w))) return title;
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(' ');
}

/** Model text in the app's voice: no em dashes, no emoji. */
export function tidyText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}
