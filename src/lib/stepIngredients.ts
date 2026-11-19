import { normalizeIngredient } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';

// Which of a recipe's ingredients a step uses, read from the step's wording, so cooking
// mode can show their amounts beside the step. Pure, tested in tests/stepIngredients.test.ts.
//
// Each ingredient is known by its full name ("dry white wine") and the shorter ways a
// step refers to it: the ends of its name ("white wine", "wine") and its other words that
// name a food on their own ("chicken" for "chicken thighs"). Longer names are matched first and claim their words,
// so "red pepper" in a step goes to the red pepper and not also the black pepper. A short
// name two ingredients share ("pepper" for black and red pepper) is ambiguous and left
// out, unless it is one ingredient's whole name.

export interface NamedIngredient { name: string; name_us?: string | null }

/** Words that say little on their own when cut from a longer name ("soy sauce" -> "sauce"). */
const WEAK = new Set(['sauce', 'powder', 'juice', 'paste', 'leaf', 'seed', 'flake', 'mix', 'mixture', 'extract', 'zest', 'water', 'fresh',
  'dried', 'ground', 'large', 'small', 'medium', 'whole', 'chopped', 'sliced', 'diced', 'minced', 'grated', 'red', 'green', 'yellow', 'white',
  'black', 'dark', 'light', 'dry', 'sweet', 'hot', 'cold', 'warm', 'plain', 'all', 'purpose', 'extra', 'virgin', 'boneless', 'skinless',
  'unsalted', 'salted', 'free', 'range', 'baby', 'can', 'canned', 'tin', 'tinned', 'frozen', 'raw', 'cooked', 'and', 'or', 'of', 'to', 'taste', 'for']);

interface Candidate { words: string[]; index: number; full: boolean }

const words = (text: string) => normalizeIngredient(text).split(' ').filter(Boolean);

function candidates(ingredients: readonly NamedIngredient[]): Candidate[] {
  const out: Candidate[] = [];
  ingredients.forEach((ing, index) => {
    const names = new Set([ing.name, ing.name_us ?? ''].map(n => n.trim()).filter(Boolean));
    for (const name of [...names]) {
      // "Salt and pepper" is two things a step can name on its own.
      for (const part of name.split(/\s+(?:and|or|&)\s+|\s*,\s*/i)) if (part && part !== name) names.add(part);
    }
    for (const name of names) {
      const w = words(name);
      if (!w.length) continue;
      out.push({ words: w, index, full: true });
      for (let i = 1; i < w.length; i++) {
        const tail = w.slice(i);
        if (tail.length > 1 || !WEAK.has(tail[0])) out.push({ words: tail, index, full: false });
      }
      // Any single word that names a food on its own: "chicken" (chicken thighs), "fish" (white fish fillets).
      for (let i = 0; i < w.length - 1; i++) if (!WEAK.has(w[i])) out.push({ words: [w[i]], index, full: false });
    }
  });
  return out;
}

/** The indexes of the ingredients this step uses, in the recipe's order. */
export function stepIngredients(stepText: string, ingredients: readonly NamedIngredient[]): number[] {
  const text = words(stepText);
  if (!text.length || !ingredients.length) return [];
  const all = candidates(ingredients);
  // Who each phrase could mean. A full name beats shortened ones; a shortened phrase two
  // ingredients share means neither.
  const byPhrase = new Map<string, Candidate[]>();
  for (const c of all) {
    const key = c.words.join(' ');
    byPhrase.set(key, [...(byPhrase.get(key) ?? []), c]);
  }
  const usable: Candidate[] = [];
  for (const group of byPhrase.values()) {
    const owners = new Set(group.map(c => c.index));
    if (owners.size === 1) { usable.push(group[0]); continue; }
    // Whole names win; a recipe that lists the same thing twice ("Lamb", "Lamb") uses both.
    const seen = new Set<number>();
    for (const c of group) if (c.full && !seen.has(c.index)) { seen.add(c.index); usable.push(c); }
  }
  usable.sort((a, b) => b.words.length - a.words.length || Number(b.full) - Number(a.full));

  const claimed = new Array<boolean>(text.length).fill(false);
  // The phrase that claimed each word: the same phrase can still match there for another ingredient of that name.
  const claimedBy = new Array<string>(text.length).fill('');
  const found = new Set<number>();
  for (const c of usable) {
    const n = c.words.length;
    for (let i = 0; i + n <= text.length; i++) {
      let hit = true;
      for (let j = 0; j < n; j++) if ((claimed[i + j] && claimedBy[i + j] !== c.words.join(' ')) || text[i + j] !== c.words[j]) { hit = false; break; }
      if (!hit) continue;
      for (let j = 0; j < n; j++) { claimed[i + j] = true; claimedBy[i + j] = c.words.join(' '); }
      found.add(c.index);
    }
  }
  return [...found].sort((a, b) => a - b);
}
