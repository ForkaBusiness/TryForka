import { ALLERGENS, ALLERGEN_ALIASES, ALLERGEN_LABELS, type Allergen } from '../../supabase/functions/_shared/catalog/allergens.ts';
import { isDislikeGroup, normalizeIngredient } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';

// The search behind the preference inputs. Suggestions are the catalog's own ingredient
// names, normalized the way the recipe filter normalizes them, so a saved choice always
// matches. Pure, so it can be tested without Supabase.

export const MAX_SUGGESTIONS = 8;

export interface IngredientOption {
  /** What gets saved: a normalized ingredient name, or an allergen key. */
  value: string;
  label: string;
  /** Other names it can be found under ("aubergine" for eggplant). */
  names: string[];
  /** A whole allergen family rather than one ingredient. */
  family?: boolean;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One option per normalized US name, however many spellings the catalog has for it. */
export function buildIngredientIndex(rows: ReadonlyArray<{ name: string; name_us: string }>): IngredientOption[] {
  const byValue = new Map<string, IngredientOption>();
  for (const row of rows) {
    const value = normalizeIngredient(row.name_us);
    if (!value) continue;
    const option = byValue.get(value) ?? { value, label: sentence(value), names: [value] };
    const alternate = normalizeIngredient(row.name);
    if (!option.names.includes(alternate)) option.names.push(alternate);
    byValue.set(value, option);
  }
  return [...byValue.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** The allergen families, findable by what people call them ("milk" finds Dairy). */
export const ALLERGEN_OPTIONS: IngredientOption[] = ALLERGENS.map((key: Allergen) => ({
  value: key,
  label: ALLERGEN_LABELS[key],
  family: true,
  names: [ALLERGEN_LABELS[key].toLowerCase(), ...Object.keys(ALLERGEN_ALIASES).filter(word => ALLERGEN_ALIASES[word].includes(key))],
}));

/** Families first; an ingredient with the same name as a family ("peanut") stays out. */
const withFamilies = (families: IngredientOption[], index: readonly IngredientOption[]): IngredientOption[] =>
  [...families, ...index.filter(o => !families.some(f => f.value === o.value))];

export const allergyOptions = (index: readonly IngredientOption[]) => withFamilies(ALLERGEN_OPTIONS, index);

/** Dislikes offer only the families that aren't one ingredient: "Dairy", not "Egg". */
export const dislikeOptions = (index: readonly IngredientOption[]) => withFamilies(ALLERGEN_OPTIONS.filter(o => isDislikeGroup(o.value)), index);

/** 0 starts the name, 1 starts a later word, 2 is inside a word, null is no match. */
function rank(option: IngredientOption, queries: string[]): number | null {
  let best: number | null = null;
  for (const name of option.names) {
    for (const q of queries) {
      const at = name.indexOf(q);
      if (at < 0) continue;
      const score = at === 0 ? 0 : name[at - 1] === ' ' ? 1 : 2;
      if (best === null || score < best) best = score;
    }
  }
  return best;
}

/**
 * The option a finished word means. The catalog has "Black olive" and "Olive oil" but no
 * plain "Olive", so a word that's a whole word in some name counts too: the filter matches
 * it against those names. Half a word ("oliv") doesn't.
 */
export function exactOption(index: readonly IngredientOption[], text: string): IngredientOption | undefined {
  const name = normalizeIngredient(text);
  if (!name) return undefined;
  const exact = index.find(o => o.names.includes(name));
  if (exact) return exact;
  const inName = index.some(o => o.names.some(n => ` ${n} `.includes(` ${name} `)));
  return inName ? { value: name, label: sentence(name), names: [name] } : undefined;
}

/** Prefix matches first, then substring; allergen families above everything else. */
export function searchIngredients(index: readonly IngredientOption[], query: string, exclude: readonly string[] = [], limit = MAX_SUGGESTIONS): IngredientOption[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  // Both forms, so "tomatoe" (half typed) and "tomatoes" both find tomato.
  const queries = [...new Set([raw, normalizeIngredient(raw)])].filter(Boolean);
  const skip = new Set(exclude);
  const found = index
    .flatMap(option => {
      const score = skip.has(option.value) ? null : rank(option, queries);
      return score === null ? [] : [{ option, score: score + (option.family ? -10 : 0) }];
    })
    .sort((a, b) => a.score - b.score || a.option.value.length - b.option.value.length || a.option.value.localeCompare(b.option.value))
    .map(m => m.option);
  const word = exactOption(index, raw);
  if (word && !skip.has(word.value) && !found.some(o => o.value === word.value)) found.splice(found.filter(o => o.family).length, 0, word);
  return found.slice(0, limit);
}
