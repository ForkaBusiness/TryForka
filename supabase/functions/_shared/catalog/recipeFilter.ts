// The deterministic recipe filter. Pure TypeScript (Deno, Vite, Node), so the Edge
// Functions and the app run the same rules. safe_recipes() in SQL is a coarse first pass
// and Claude's prompt only steers it; this is what decides whether a recipe may be shown.

import { ALLERGENS, ALLERGEN_ALIASES, ALLERGEN_LABELS, type Allergen, ingredientAllergens } from './allergens.ts';

export interface FoodPrefs {
  diet?: string;
  /** Allergen keys ("tree_nut") or normalized ingredient names ("mustard"). Hard excludes. */
  allergies: readonly string[];
  /** Dislikes set to "never show". Hard excludes. */
  skip_ingredients: readonly string[];
  /** Dislikes set to "avoid if possible". Ranked last, never removed. */
  avoid_ingredients?: readonly string[];
}

export interface FilterableRecipe {
  name: string;
  display_name?: string | null;
  allergens?: readonly string[] | null;
  diets?: readonly string[] | null;
  ingredient_names?: readonly string[] | null;
}

export interface Verdict {
  allowed: boolean;
  /** Why it was removed, in plain words ("Peanut", "mustard"). */
  blockedBy: string[];
  /** "Avoid if possible" items it contains. */
  avoids: string[];
}

// ── Normalizing ingredient names ───────────────────────────────────────────

const UNITS = 'cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kgs?|kilos?|ml|l|liters?|litres?|cans?|tins?|jars?|packs?|packets?|pinch(?:es)?|handfuls?|bunch(?:es)?|slices?|pieces?';
const QUANTITY = new RegExp(`^[\\d¼½¾⅓⅔⅛.,/-]+(?:\\s+[\\d¼½¾⅓⅔⅛.,/-]+)*(?:\\s*(?:${UNITS})\\b\\.?)?\\s+(?:of\\s+)?`);

const IRREGULAR: Record<string, string> = {
  leaves: 'leaf', loaves: 'loaf', halves: 'half', chillies: 'chili', chilies: 'chili', chiles: 'chili',
  cookies: 'cookie', brownies: 'brownie', pies: 'pie', veggies: 'veggie', smoothies: 'smoothie',
};
const SPELLING: Record<string, string> = { chilli: 'chili', chile: 'chili', yoghurt: 'yogurt' };

function singular(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (SPELLING[word]) return SPELLING[word];
  if (word.length <= 3 || /(ss|us|is)$/.test(word) || word === 'molasses') return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

/** "2 cups Peanuts" -> "peanut", "Jalapeños" -> "jalapeno", "goat's cheese" -> "goat cheese". */
export function normalizeIngredient(raw: string): string {
  return raw
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(QUANTITY, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(singular)
    .join(' ');
}

const normalized = new Map<string, string>();
function memoNormalize(raw: string): string {
  let n = normalized.get(raw);
  if (n === undefined) { n = normalizeIngredient(raw); normalized.set(raw, n); }
  return n;
}

const flags = new Map<string, Allergen[]>();
function memoAllergens(name: string): Allergen[] {
  let a = flags.get(name);
  if (!a) { a = ingredientAllergens(name); flags.set(name, a); }
  return a;
}

/** Whole words only: "egg" is in "egg yolk", not in "eggplant"; "tea" is not in "steak". */
const hasWords = (text: string, term: string) => ` ${text} `.includes(` ${term} `);

/** A dislike is about the taste, so "olive" isn't "olive oil" (a third of the catalog). */
const hasDislike = (text: string, term: string) => hasWords(text, term) && !hasWords(text, `${term} oil`);

// ── Allergy and dislike terms ──────────────────────────────────────────────

const isAllergen = (v: string): v is Allergen => (ALLERGENS as readonly string[]).includes(v);

/** The allergen families a term means: "peanuts" -> peanut, "Peanut Butter" -> peanut, "nuts" -> both. */
export function allergyFamilies(term: string): Allergen[] {
  if (isAllergen(term)) return [term];
  const name = normalizeIngredient(term);
  return ALLERGEN_ALIASES[name] ?? ingredientAllergens(name);
}

/** One spelling for a saved allergy: the family key when it names a family, else the normalized name. */
export function canonicalAllergy(term: string): string {
  if (isAllergen(term)) return term;
  const name = normalizeIngredient(term);
  const aliased = ALLERGEN_ALIASES[name];
  return aliased?.length === 1 ? aliased[0] : name;
}

/** "Peanut" for a family key, "mustard" for an ingredient. */
export const allergyLabel = (term: string) => (isAllergen(term) ? ALLERGEN_LABELS[term] : term);

// A dislike that names a whole group ("dairy", "seafood") means the family; any other
// dislike means that ingredient, so disliking eggs doesn't hide mayonnaise.
const DISLIKE_GROUPS = ['dairy', 'gluten', 'wheat', 'nut', 'tree nut', 'fish', 'shellfish', 'seafood'];

export const isDislikeGroup = (term: string) => DISLIKE_GROUPS.includes(normalizeIngredient(term));

function dislikeFamilies(name: string): Allergen[] {
  return DISLIKE_GROUPS.includes(name) ? ALLERGEN_ALIASES[name] : [];
}

interface Term { label: string; name: string; families: Allergen[] }

function dislikeTerms(values: readonly string[] | undefined): Term[] {
  return (values ?? []).map(v => ({ v, name: normalizeIngredient(v) })).filter(t => t.name.length >= 2)
    .map(({ v, name }) => ({ label: v, name, families: dislikeFamilies(name) }));
}

/** Prepares the household's settings once, then checks any number of recipes. */
export function recipeChecker(prefs: FoodPrefs): (recipe: FilterableRecipe) => Verdict {
  const allergyFamiliesWanted = new Map<Allergen, string>();
  const allergyTerms: string[] = [];
  for (const a of prefs.allergies) {
    for (const f of allergyFamilies(a)) allergyFamiliesWanted.set(f, allergyLabel(f));
    if (!isAllergen(a)) {
      const name = normalizeIngredient(a);
      if (name.length >= 2 && !ALLERGEN_ALIASES[name]) allergyTerms.push(name);
    }
  }
  const skips = dislikeTerms(prefs.skip_ingredients);
  const skipNames = new Set(skips.map(t => t.name));
  const avoids = dislikeTerms(prefs.avoid_ingredients).filter(t => !skipNames.has(t.name));
  const diet = prefs.diet && prefs.diet !== 'none' ? prefs.diet : null;

  return recipe => {
    const names = (recipe.ingredient_names ?? []).filter(Boolean);
    const texts = [...names, recipe.name, recipe.display_name ?? ''].filter(Boolean).map(memoNormalize);
    const families = new Set<string>(recipe.allergens ?? []);
    // The stored column can lag behind the map until the next sync, so ask the map too.
    for (const n of names) for (const a of memoAllergens(n)) families.add(a);

    const matches = (t: Term) => texts.some(x => hasDislike(x, t.name)) || t.families.some(f => families.has(f));
    const blockedBy: string[] = [];
    if (diet && !(recipe.diets ?? []).includes(diet)) blockedBy.push(`not ${diet}`);
    for (const [family, label] of allergyFamiliesWanted) if (families.has(family)) blockedBy.push(label);
    // Allergies lean broad on purpose: "corn" also catches "cornstarch". Short words stay
    // whole-word, or "rum" would catch "breadcrumbs".
    for (const term of allergyTerms) {
      if (texts.some(x => (term.length >= 4 ? x.includes(term) : hasWords(x, term)))) blockedBy.push(term);
    }
    for (const t of skips) if (matches(t)) blockedBy.push(t.label);
    return { allowed: blockedBy.length === 0, blockedBy, avoids: avoids.filter(matches).map(t => t.label) };
  };
}

export const checkRecipe = (recipe: FilterableRecipe, prefs: FoodPrefs) => recipeChecker(prefs)(recipe);

/** Removes every recipe that fails, and moves "avoid if possible" recipes to the end. */
export function filterRecipes<T extends FilterableRecipe>(recipes: readonly T[], prefs: FoodPrefs): T[] {
  const check = recipeChecker(prefs);
  const clear: T[] = [];
  const avoided: T[] = [];
  for (const r of recipes) {
    const v = check(r);
    if (v.allowed) (v.avoids.length ? avoided : clear).push(r);
  }
  return [...clear, ...avoided];
}

// ── Plan repair ────────────────────────────────────────────────────────────

/** How many candidates one empty slot looks at before it's left empty. */
export const REPLACEMENT_TRIES = 40;

/** The first unused candidate that passes, or null when there's none within the limit. */
export function pickReplacement<T extends FilterableRecipe & { id: number }>(
  pool: readonly T[], check: (r: T) => Verdict, used: ReadonlySet<number>,
): T | null {
  let tries = 0;
  for (const candidate of pool) {
    if (used.has(candidate.id)) continue;
    if (++tries > REPLACEMENT_TRIES) return null;
    if (check(candidate).allowed) return candidate;
  }
  return null;
}
