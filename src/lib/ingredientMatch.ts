// Find recipes by what's in the kitchen. Pure (no network): the catalog is loaded once and
// searched in memory, so results update as fast as someone types. Unit-tested in
// tests/ingredientMatch.test.ts.

import { normalizeIngredient } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';
import { isStaple, itemKey, shoppingName } from './groceryMerge.ts';

/**
 * Words that make an ingredient a different product from the food it's named after:
 * chicken stock isn't chicken, rice vinegar isn't rice. Unless the person typed the word
 * themselves ("chicken stock").
 */
const PRODUCTS = new Set([
  'stock', 'broth', 'vinegar', 'powder', 'sauce', 'oil', 'paste', 'flour', 'wine', 'extract', 'juice', 'cube', 'seasoning', 'syrup',
  'concentrate', 'gravy', 'ketchup', 'starch', 'salt', 'noodle', 'wrapper', 'tortilla', 'chocolate', 'krispy', 'cordial', 'roll',
  'paper', 'sheet', 'bean', 'pea',
]);
/** Fruit whose juice or zest is the fruit as far as a shopper is concerned. */
const FRUIT = new Set(['lemon', 'lime', 'orange', 'grapefruit']);

/** Foods named after another food that aren't it: green onions aren't onions. */
const DIFFERENT: Record<string, string[]> = {
  onion: ['green onion', 'spring onion'],
  potato: ['sweet potato'],
  milk: ['coconut milk', 'almond milk', 'soy milk', 'soya milk', 'oat milk'],
  butter: ['peanut butter', 'almond butter', 'palm butter'],
  cream: ['ice cream', 'cream cheese', 'cream of tartar', 'sour cream'],
  pepper: ['black pepper', 'white pepper', 'cayenne pepper', 'chili pepper', 'chilli pepper', 'pepper flake'],
  sugar: ['sugar snap'],
  beef: ['beef tomato'],
  salt: ['salt cod'],
};

/** Does a recipe's ingredient count as something the person has? Whole words only ("egg" isn't "eggplant"). */
export function usesIngredient(ingredient: string, have: string): boolean {
  const name = normalizeIngredient(ingredient);
  const term = normalizeIngredient(have);
  if (!name || !term || !` ${name} `.includes(` ${term} `)) return false;
  const words = name.split(' ');
  const last = words[words.length - 1];
  const typed = term.split(' ');
  if (DIFFERENT[term]?.some(other => ` ${name} `.includes(` ${other} `))) return false;
  // "chicken stock" for "chicken": a different product, unless they asked for that product.
  if ((last === 'juice' || last === 'zest') && FRUIT.has(term)) return true;
  return !(PRODUCTS.has(last) && !typed.includes(last));
}

export interface IngredientMatch<T> {
  recipe: T;
  /** What the person has that it uses, as shopping names ("Onion", "Rice"). */
  have: string[];
  /** What else it needs, staples (salt, oil, water) left out. */
  missing: string[];
  /** How many of the person's ingredients it uses. */
  uses: number;
}

/**
 * Recipes that use at least one of `haves`, best first: the most of what they have, then
 * the least left to buy. `ingredientsOf` gives a recipe's ingredient names (US names).
 */
export function matchRecipes<T extends { id: number }>(recipes: readonly T[], ingredientsOf: (r: T) => readonly string[], haves: readonly string[], limit = 40): Array<IngredientMatch<T>> {
  const terms = [...new Set(haves.map(normalizeIngredient).filter(Boolean))];
  if (!terms.length) return [];
  const out: Array<IngredientMatch<T>> = [];
  for (const recipe of recipes) {
    const usedTerms = new Set<string>();
    const have = new Map<string, string>();
    const missing = new Map<string, string>();
    for (const ingredient of ingredientsOf(recipe)) {
      const key = itemKey(ingredient);
      // Salt, pepper, oil and water are in every kitchen: never what someone "has" to use up, never "missing".
      if (!key || isStaple(key)) continue;
      const hit = terms.filter(t => usesIngredient(ingredient, t));
      if (hit.length) {
        hit.forEach(t => usedTerms.add(t));
        if (!have.has(key)) have.set(key, shoppingName(ingredient));
      } else if (!isStaple(key) && !missing.has(key)) {
        missing.set(key, shoppingName(ingredient));
      }
    }
    // A thing both had and needed under another spelling counts as had.
    for (const key of have.keys()) missing.delete(key);
    if (usedTerms.size) out.push({ recipe, have: [...have.values()], missing: [...missing.values()], uses: usedTerms.size });
  }
  return out
    .sort((a, b) => b.uses - a.uses || a.missing.length - b.missing.length || a.recipe.id - b.recipe.id)
    .slice(0, limit);
}
