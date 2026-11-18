// Ingredient lines as people write them ("2 cups all-purpose flour, sifted") -> the
// structured parts the grocery list, scaling, cooking mode and nutrition read: amount,
// unit, item and preparation note. And a pasted block of text -> one line per ingredient
// or step. Pure TypeScript (Deno, Vite, Node). Amounts and units come from the catalog's
// own parser (catalog/units.ts), so an imported "1 1/2 cups" behaves exactly like a
// catalog one.

import { COUNT_UNITS, NUMBER_RE, parseMeasure } from '../catalog/units.ts';
import { splitSteps } from '../catalog/steps.ts';
import type { DraftIngredient } from './draft.ts';

// Bullets, checkboxes and list numbers in front of a line. A list number needs a "." or
// ")" so "1 onion" keeps its amount.
const BULLET = /^\s*(?:[-–—•*·●○◦▪▫■□▢☐☑✓✔>]+|\d{1,2}[.)](?=\s+\S))\s*/;

// Words that describe the item but can stand before a comma without ending it:
// "boneless, skinless chicken thighs" is one item.
const DESCRIPTORS = new Set(['boneless', 'skinless', 'skin-on', 'bone-in', 'large', 'small', 'medium', 'fresh', 'ripe', 'firm',
  'unsalted', 'salted', 'low-sodium', 'reduced-sodium', 'organic', 'raw', 'cooked', 'frozen', 'thawed', 'whole', 'peeled', 'seedless',
  'extra-large', 'extra', 'lean', 'hot', 'cold', 'warm', 'sweet', 'mild', 'dry', 'dried', 'plain', 'heaping', 'level', 'packed', 'loosely']);

// Endings that are preparation or usage, not part of the item's name.
const TRAILING_NOTE = /\s+(to taste|for (?:garnish(?:ing)?|serving|frying|greasing|dusting|drizzling|the pan|topping)|optional|as needed|if needed|or to taste|plus more(?:\s.*)?|divided|at room temperature|room temperature)$/i;

// "a pinch of salt", "a handful of spinach": one of a countable unit, written in words.
const ONE_UNIT = new RegExp(`^(?:a|an|one)\\s+(${Object.keys(COUNT_UNITS).join('|')})\\s+(?:of\\s+)?`, 'i');
// "pinch of salt", "dash hot sauce": units that are written without a number mean one.
const BARE_UNIT = /^(pinch|dash|splash|handful|knob|sprig|bunch)(?:es)?\s+(?:of\s+)?/i;
// Units people write after the item: "2 celery stalks", "3 garlic cloves".
const TRAILING_UNIT: Record<string, string> = { clove: 'clove', cloves: 'clove', stalk: 'stalk', stalks: 'stalk', sprig: 'sprig', sprigs: 'sprig', stick: 'stick', sticks: 'stick' };

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').replace(/\(\s+/g, '(').trim();

/** One level of brackets: "((optional))" -> "(optional)", "(cold (keep chilled))" -> "(cold keep chilled)". Unmatched ones are closed or dropped. */
function flattenBrackets(s: string): string {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') { out += depth === 0 ? '(' : ' '; depth++; } else if (ch === ')') {
      if (depth === 0) continue;
      depth--;
      out += depth === 0 ? ')' : ' ';
    } else out += ch;
  }
  return depth > 0 ? `${out})` : out;
}

/** "  • 2 cups flour  " -> "2 cups flour". */
export function cleanLine(raw: string): string {
  return tidy(flattenBrackets(raw.replace(BULLET, '').replace(/\u00a0/g, ' '))
    // Recipe plugins write notes as "((optional))" and "(, sliced)"; footnote marks ("tempeh*") aren't part of the name.
    .replace(/(\w)\*+/g, '$1').replace(/\s\*+(?=[\s(]|$)/g, ' ')).replace(/\(\s*[,;]\s*/g, '(');
}

/** Splits the words after the amount into the item and its note: "flour, sifted" -> flour / sifted. */
function splitItem(rest: string): { item: string; note: string } {
  const notes: string[] = [];
  // "plus 2 tablespoons sugar", "minus 2 tbsp flour": the extra is a note on the amount.
  const extra = rest.match(new RegExp(`^(plus|minus|\\+)\\s+${NUMBER_RE}\\s*[a-z.]+\\s+`, 'i'));
  if (extra) { notes.push(extra[0].trim()); rest = rest.slice(extra[0].length); }
  // Every bracketed part is a note: "(14 oz)", "(about 3 cups)".
  let text = rest.replace(/\(([^)]*)\)/g, (_m, inner: string) => { if (inner.trim()) notes.push(`(${inner.trim()})`); return ' '; });
  text = tidy(text).replace(/^of\s+/i, '');
  // The first comma or spaced dash that ends the name (not one inside "boneless, skinless").
  const parts = text.split(/\s*(?:,|\s[-–—]\s)\s*/);
  let cut = 1;
  while (cut < parts.length && parts.slice(0, cut).join(' ').split(' ').every(w => DESCRIPTORS.has(w.toLowerCase()))) cut++;
  let item = parts.slice(0, cut).join(', ');
  const after = parts.slice(cut).join(', ');
  if (after) notes.unshift(after);
  const trailing = item.match(TRAILING_NOTE);
  if (trailing && trailing.index! > 0) {
    notes.unshift(trailing[1]);
    item = item.slice(0, trailing.index);
  }
  return { item: tidy(item).replace(/[.;:,]+$/, ''), note: tidy(notes.join(' ')).replace(/^[,;]\s*/, '') };
}

/** One ingredient line -> amount, unit, item and note. Never throws; unparsed text becomes the item. */
export function parseIngredientLine(raw: string): DraftIngredient {
  const line = cleanLine(raw);
  if (!line) return { quantity: null, quantity_max: null, unit: '', item: '', note: '' };
  // "Optional: 1 to 2 tomatoes": the label goes to the note, so the amount is read.
  const label = line.match(/^(optional|to serve|for serving|for garnish)\s*:\s*/i);
  if (label) {
    const p = parseIngredientLine(line.slice(label[0].length));
    return { ...p, note: [p.note, label[1].toLowerCase()].filter(Boolean).join(', ') };
  }
  const bare = line.match(BARE_UNIT);
  if (bare && !/^\s*(?:to taste|$)/i.test(line.slice(bare[0].length))) {
    const { item, note } = splitItem(line.slice(bare[0].length));
    return { quantity: 1, quantity_max: null, unit: COUNT_UNITS[bare[1].toLowerCase()], item, note };
  }
  const one = line.match(ONE_UNIT);
  if (one) {
    const { item, note } = splitItem(line.slice(one[0].length));
    return { quantity: 1, quantity_max: null, unit: COUNT_UNITS[one[1].toLowerCase()], item, note };
  }
  // "1/3 scant tsp salt": the qualifier goes to the note, so the unit is read.
  const qualifier = line.match(new RegExp(`^(${NUMBER_RE}(?:\\s*(?:-|–|to)\\s*${NUMBER_RE})?)\\s+(scant|heaping|heaped|generous|level|rounded|good)\\s+`, 'i'));
  if (qualifier) {
    const p = parseIngredientLine(`${qualifier[1]} ${line.slice(qualifier[0].length)}`);
    return { ...p, note: [qualifier[2].toLowerCase(), p.note].filter(Boolean).join(', ') };
  }
  // On recipe cards a capital T is a tablespoon and a small t a teaspoon; parseMeasure
  // lowercases before it reads the unit, so the capital is read here first.
  const bigT = line.match(new RegExp(`^(${NUMBER_RE}(?:\\s*(?:-|–|to)\\s*${NUMBER_RE})?)\\s*(?:T|Tb|TB|TBS)\\.?(?=\\s|$)`));
  if (bigT) return parseIngredientLine(`${bigT[1]} tbsp${line.slice(bigT[0].length)}`);
  const m = parseMeasure(line);
  if (m.quantity === null) {
    const { item, note } = splitItem(line);
    return { quantity: null, quantity_max: null, unit: '', item, note };
  }
  // parseMeasure lowercases; take the same words from the line as written, so names keep
  // their capitals ("San Marzano tomatoes").
  const restLower = m.note.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let rest = m.note;
  const at = restLower ? line.toLowerCase().lastIndexOf(restLower) : -1;
  // Bracketed parts as written where the line has them ("(or DIY)"); parseMeasure's own ("(400g)") otherwise.
  const asWritten = (p: string) => { const i = line.toLowerCase().indexOf(p); return i >= 0 ? line.slice(i, i + p.length) : p; };
  if (at >= 0) rest = line.slice(at, at + restLower.length) + (m.note.match(/\([^)]*\)/g) ?? []).map(p => ` ${asWritten(p)}`).join('');
  const { item, note } = splitItem(rest);
  // "2 celery stalks", "3 garlic cloves": the unit came after the item. Read it as "2 stalks
  // celery", so the grocery list adds it to "3 cloves garlic" from another recipe.
  const last = item.match(/^(.+?)\s+([A-Za-z]+)$/);
  if (!m.unit && last && TRAILING_UNIT[last[2].toLowerCase()]) {
    return { quantity: m.quantity, quantity_max: m.quantityMax, unit: TRAILING_UNIT[last[2].toLowerCase()], item: last[1], note };
  }
  return { quantity: m.quantity, quantity_max: m.quantityMax, unit: m.unit, item, note };
}

// Lines that head a list rather than belong to it.
const HEADING = /^(?:ingredients?|for the [^:]{1,40}|method|directions|instructions|preparation|steps|you(?:'ll)? need|what you need)\s*:?$/i;
const SECTION = /^[^\d:]{1,40}:$/;

/**
 * A pasted block of ingredients -> one line each, without headings ("Ingredients",
 * "For the sauce:"). Text on one line separated by bullets or semicolons is split too.
 */
export function splitIngredientBlock(text: string): string[] {
  return text
    .split(/\r?\n|\s*[•·●▪]\s+|;\s+(?=\d)/)
    .map(cleanLine)
    .filter(l => l && !HEADING.test(l) && !SECTION.test(l));
}

/**
 * A pasted block of steps -> one step each. Uses the catalog's step splitter (line breaks,
 * "Step 1" labels, list numbers), and also splits "1. Mix. 2. Bake." written on one line.
 */
export function splitStepBlock(text: string): string[] {
  const inline = new RegExp(String.raw`\s+(?=(?:step\s*)?\d{1,2}[.):]\s+[A-Za-z])`, 'i');
  const lines = text.split(/\r?\n/).flatMap(line => {
    const marks = line.match(new RegExp(String.raw`(?:^|\s)(?:step\s*)?\d{1,2}[.):]\s+[A-Za-z]`, 'gi')) ?? [];
    return marks.length >= 2 ? line.split(inline) : [line];
  });
  return splitSteps(lines.join('\n'));
}

/** True when a line has a number in it, for flagging lines whose amount couldn't be read. */
export const hasNumber = (s: string) => new RegExp(NUMBER_RE).test(s);
