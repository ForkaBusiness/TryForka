// What the model is asked for when a recipe has no structured data (a page without
// schema.org markup, a caption, pasted text, a photo), and how its answer becomes a draft.
// The model only transcribes: every line as written, plus what it couldn't read. Amounts
// and units are then read by the same parser as everything else (ingredientLine.ts), and
// for text sources every number in a line must appear in the source, so an amount the
// source doesn't have can't slip in. What's uncertain is flagged for the review screen,
// never filled in. Pure TypeScript (Deno, Vite, Node).

import { NUMBER_RE, parseNumber } from '../catalog/units.ts';
import { emptyDraft, type DraftFlag, type DraftSource, type ImportDraft } from './draft.ts';
import { cleanLine, parseIngredientLine } from './ingredientLine.ts';

export const UNSURE = ['none', 'amount_unreadable', 'amount_missing', 'text_unreadable'] as const;
export type Unsure = typeof UNSURE[number];

export interface ModelLine { text: string; unsure: Unsure }
export interface ModelRecipe {
  is_recipe: boolean;
  title: string;
  title_unsure: boolean;
  servings: string;
  servings_unsure: boolean;
  prep_time: string;
  cook_time: string;
  total_time: string;
  ingredients: ModelLine[];
  steps: ModelLine[];
  notes: string;
  /** Every separate recipe the source shows, by title, in reading order (more than one: the household picks). */
  recipes_seen: Array<{ title: string; has_method: boolean }>;
  /** Ingredients the steps use that the ingredient list leaves out, as the steps word them. */
  only_in_steps: string[];
}

const line = {
  type: 'object',
  properties: { text: { type: 'string' }, unsure: { type: 'string', enum: [...UNSURE] } },
  required: ['text', 'unsure'],
  additionalProperties: false,
};

/** Structured-output schema for the extraction call. */
export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    is_recipe: { type: 'boolean' },
    title: { type: 'string' },
    title_unsure: { type: 'boolean' },
    servings: { type: 'string' },
    servings_unsure: { type: 'boolean' },
    prep_time: { type: 'string' },
    cook_time: { type: 'string' },
    total_time: { type: 'string' },
    ingredients: { type: 'array', items: line },
    steps: { type: 'array', items: line },
    notes: { type: 'string' },
    recipes_seen: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, has_method: { type: 'boolean' } }, required: ['title', 'has_method'], additionalProperties: false },
    },
    only_in_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['is_recipe', 'title', 'title_unsure', 'servings', 'servings_unsure', 'prep_time', 'cook_time', 'total_time', 'ingredients', 'steps', 'notes', 'recipes_seen', 'only_in_steps'],
  additionalProperties: false,
};

const RULES = `Rules:
- Copy, don't write. Each ingredient line exactly as the source has it, amount and unit included ("2 cups flour, sifted"). Each step as the source words it, one instruction per entry, in order. Keep the source's language and units.
- Never add an amount, unit, time or serving count that isn't in the source. If an ingredient that needs an amount has none, copy the line without one and set unsure to "amount_missing". If an amount is there but you can't read it with confidence, leave that amount out of the text and set unsure to "amount_unreadable". If words are hard to read, give your best reading and set unsure to "text_unreadable". Otherwise unsure is "none". "Salt to taste" and "for serving" lines need no amount.
- Section headings ("For the sauce") are not ingredients or steps; leave them out. Leave out ads, stories, comments, nutrition panels and links.
- servings, prep_time, cook_time and total_time: copy as written ("Serves 4", "20 min"), or "" if the source doesn't say. title: the recipe's name as written, or a plain name for the dish if it has none (then title_unsure is true).
- notes: tips, substitutions or a short story the source gives about this recipe (a headnote like "My gran used to make this"), copied briefly; "" if none. Never put these in the steps.
- If the same ingredient line appears twice, copy it twice: the household decides whether it's a repeat.
- recipes_seen: every separate recipe you can see, each by its title as written, in reading order, with has_method true if it has steps or a method. If there is more than one and you weren't told which to copy, copy the first one.
- only_in_steps: ingredients the steps use that the ingredient list leaves out, worded as in the steps ("demerara sugar" from "sprinkle with demerara sugar"); [] if none. Not equipment, not water.
- If there is no recipe (no ingredient list with steps or a method), set is_recipe to false and leave the rest empty.`;

export const TEXT_SYSTEM = `You copy recipes out of text for a family meal planner: a web page, a social media caption, or text someone pasted. ${RULES}`;
export const IMAGE_SYSTEM = `You copy recipes out of photos for a family meal planner: cookbook pages, screenshots, printed or handwritten recipe cards. The photos are in order and may be pages of one recipe. ${RULES}
- Read handwriting carefully. Fractions like 1/2 and ½ and abbreviations like T (tablespoon), t or tsp (teaspoon), c (cup) are common; copy them as written.
- Words cut off at the edge of a page or hidden by a finger: copy only what you can see and set unsure to "text_unreadable". Don't complete them.`;

/** "Serves 4-6", "4 servings", "Makes 12" -> 4 / 4 / 12. Null when there's no sensible number. */
export function servingsFrom(text: string): number | null {
  const m = text.match(new RegExp(NUMBER_RE));
  if (!m) return null;
  const n = Math.round(parseNumber(m[0]));
  return n >= 1 && n <= 100 ? n : null;
}

/** "1 hr 20 min", "45 minutes", "1 1/2 hours", "PT30M" -> minutes. Null when there's no time. */
export function minutesFrom(text: string): number | null {
  const t = text.toLowerCase();
  const iso = t.match(/^p(?:t)?(?:(\d+)h)?(?:(\d+)m)?/);
  if (iso && (iso[1] || iso[2])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) || null;
  let total = 0;
  let found = false;
  for (const m of t.matchAll(new RegExp(`(${NUMBER_RE})\\s*(?:-\\s*${NUMBER_RE}\\s*)?(hours?|hrs?|h\\b|minutes?|mins?|m\\b)`, 'g'))) {
    const n = parseNumber(m[1]);
    if (!Number.isFinite(n)) continue;
    total += m[2].startsWith('h') ? n * 60 : n;
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}

const numbersIn = (s: string) => [...s.matchAll(new RegExp(NUMBER_RE, 'g'))].map(m => parseNumber(m[0])).filter(Number.isFinite);

/** True when every number in `line` appears somewhere in `source` (as a number). */
export function numbersFromSource(line: string, source: string): boolean {
  const have = new Set(numbersIn(source).map(n => +n.toFixed(3)));
  return numbersIn(line).every(n => have.has(+n.toFixed(3)));
}

const REASON: Record<Exclude<Unsure, 'none'>, { part?: DraftFlag['part']; text: string }> = {
  amount_unreadable: { part: 'quantity', text: 'Amount hard to read. Add it if you know it.' },
  amount_missing: { part: 'quantity', text: 'No amount given. Add one if you know it.' },
  text_unreadable: { part: 'item', text: 'Hard to read. Check this line.' },
};

/**
 * The model's answer as a draft. `sourceText` is given for text sources: a line with a
 * number the source doesn't have loses that amount and is flagged.
 */
export function draftFromModel(m: ModelRecipe, source: DraftSource, opts: { sourceText?: string; image_url?: string | null; photo?: boolean } = {}): ImportDraft {
  const draft = emptyDraft(source.kind);
  const flags: DraftFlag[] = [];
  draft.source = source;
  draft.image_url = opts.image_url ?? null;
  draft.title = titleCase(cleanLine(m.title ?? ''));
  if (m.title_unsure || !draft.title) flags.push({ field: 'title', reason: 'Check the name.' });
  draft.servings = servingsFrom(m.servings ?? '');
  if (m.servings_unsure && m.servings) flags.push({ field: 'servings', reason: 'Check the servings.' });
  draft.prep_minutes = minutesFrom(m.prep_time ?? '');
  draft.cook_minutes = minutesFrom(m.cook_time ?? '');
  draft.total_minutes = minutesFrom(m.total_time ?? '');
  for (const l of (m.ingredients ?? []).filter(l => cleanLine(l?.text ?? ''))) {
    const text = cleanLine(l.text);
    let ing = parseIngredientLine(text);
    let unsure: Unsure = UNSURE.includes(l.unsure) ? l.unsure : 'none';
    if (opts.sourceText && !numbersFromSource(text, opts.sourceText)) {
      // An amount the source doesn't have: drop it rather than keep a guess.
      ing = { ...ing, quantity: null, quantity_max: null, unit: '' };
      unsure = 'amount_missing';
    }
    const index = draft.ingredients.length;
    draft.ingredients.push(ing);
    if (unsure !== 'none') {
      if (unsure === 'amount_missing' && ing.quantity !== null) continue; // it does have one
      flags.push({ field: 'ingredients', index, part: REASON[unsure].part, reason: REASON[unsure].text });
    }
  }
  for (const s of (m.steps ?? []).filter(s => cleanLine(s?.text ?? ''))) {
    const index = draft.steps.length;
    draft.steps.push(cleanLine(s.text));
    if (s.unsure && s.unsure !== 'none') flags.push({ field: 'steps', index, reason: 'Hard to read. Check this step.' });
  }
  draft.notes = (m.notes ?? '').trim();
  // A photo the model found hard overall: every amount gets checked, not only the lines it
  // marked. Blurry photos can be misread with confidence on the lines that look clear.
  if (opts.photo) {
    const lines = [...(m.ingredients ?? []), ...(m.steps ?? [])];
    const unsure = lines.filter(l => l.unsure && l.unsure !== 'none' && l.unsure !== 'amount_missing').length;
    if (lines.length && unsure / lines.length > HARD_PHOTO) {
      draft.ingredients.forEach((ing, index) => {
        if (ing.quantity !== null && !flags.some(f => f.field === 'ingredients' && f.index === index)) {
          flags.push({ field: 'ingredients', index, part: 'quantity', reason: 'This photo is hard to read. Check this amount.' });
        }
      });
    }
  }
  draft.flags = [...flags, ...reviewChecks(draft, m.only_in_steps ?? [])];
  return draft;
}

/** More than this share of lines marked unsure: the photo is hard to read, and every amount is flagged. */
export const HARD_PHOTO = 0.3;

/** "DORSET APPLE CAKE" -> "Dorset apple cake"; other titles stay as written. */
export function titleCase(title: string): string {
  if (!/[A-Z]{3}/.test(title) || /[a-z]/.test(title)) return title;
  const lower = title.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/(es|s)$/, ''));

/**
 * What the review screen asks the household to look at, for any import: a line that appears
 * twice (flagged, not merged: it may be a repeat or two additions), and an ingredient the
 * steps use that the list leaves out (flagged with the line to add). A name the model gives
 * only counts if the steps really say it, so nothing is made up.
 */
export function reviewChecks(draft: ImportDraft, onlyInSteps: readonly string[] = []): DraftFlag[] {
  const flags: DraftFlag[] = [];
  const seen = new Map<string, number>();
  draft.ingredients.forEach((ing, index) => {
    const key = [ing.quantity, ing.quantity_max, ing.unit, keyOf(ing.item).join(' ')].join('|');
    if (!keyOf(ing.item).length) return;
    if (seen.has(key)) flags.push({ field: 'ingredients', index, reason: `This line appears twice (also line ${seen.get(key)! + 1}). Remove one if it's a repeat.` });
    else seen.set(key, index);
  });
  const stepWords = new Set(keyOf(draft.steps.join(' ')));
  const listed = draft.ingredients.map(i => new Set(keyOf(`${i.item} ${i.note}`)));
  for (const name of [...new Set(onlyInSteps.map(n => cleanLine(n)).filter(Boolean))]) {
    const words = keyOf(name);
    if (!words.length || !words.every(w => stepWords.has(w))) continue;        // not in the steps: ignore
    if (listed.some(l => words.every(w => l.has(w)))) continue;               // already on the list
    const shown = name.charAt(0).toUpperCase() + name.slice(1);
    flags.push({ field: 'ingredients', reason: `${shown} is in the steps but not the ingredient list.`, add: name });
  }
  return flags;
}

/** Usable as a recipe: a name or something to cook, ingredients and steps. */
export const draftUsable = (d: ImportDraft) => d.ingredients.length >= 2 && d.steps.length >= 1;

/** The flagged fields, as the import log records them ("ingredients.quantity", "steps"). */
export const flaggedFields = (flags: DraftFlag[]) => [...new Set(flags.map(f => (f.part ? `${f.field}.${f.part}` : f.field)))];
