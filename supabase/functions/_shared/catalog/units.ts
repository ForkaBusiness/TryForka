// Quantities and units for TheMealDB data. Pure TypeScript with no runtime-specific
// imports: used by the sync-recipes Edge Function (Deno), the web app (Vite) and the
// Node unit tests.
//
// TheMealDB measures are free text written mostly in British metric ("200g", "1 tbs",
// "2 x 400g tins", "Juice of 1", "to taste"). parseMeasure turns one into a number, a
// canonical unit and the leftover words; formatMeasure renders it in US or metric
// units, optionally scaled. Anything that doesn't parse is shown as written.

export type UnitSystem = 'us' | 'metric';

export interface Measure {
  /** Parsed amount (lower bound of a range), or null when the measure has no number. */
  quantity: number | null;
  /** Upper bound of a range ("1-2 tbsp"), else null. */
  quantityMax: number | null;
  /** Canonical unit ("g", "tbsp", "clove") or '' for a bare count ("2 large"). */
  unit: string;
  /** Words after the unit ("chopped", "(400g)") or the whole measure when unparsed. */
  note: string;
}

// ── Units ──────────────────────────────────────────────────────────────────

/** Grams per unit. */
export const MASS: Record<string, number> = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
/** Millilitres per unit. Spoons and cups use the rounded kitchen values. */
export const VOLUME: Record<string, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240, 'fl oz': 30, pint: 568, quart: 946 };
/** Countable units, keyed by every spelling we've seen in TheMealDB. */
export const COUNT_UNITS: Record<string, string> = {
  clove: 'clove', cloves: 'clove', can: 'can', cans: 'can', tin: 'can', tins: 'can', slice: 'slice', slices: 'slice',
  sprig: 'sprig', sprigs: 'sprig', bunch: 'bunch', bunches: 'bunch', handful: 'handful', handfuls: 'handful', handfull: 'handful',
  head: 'head', heads: 'head', bulb: 'bulb', bulbs: 'bulb', stick: 'stick', sticks: 'stick', packet: 'packet', packets: 'packet',
  pack: 'packet', packs: 'packet', bag: 'bag', bags: 'bag', jar: 'jar', jars: 'jar', pod: 'pod', pods: 'pod', leaf: 'leaf', leaves: 'leaf',
  knob: 'knob', knobs: 'knob', pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash', sheet: 'sheet', sheets: 'sheet',
  fillet: 'fillet', fillets: 'fillet', piece: 'piece', pieces: 'piece', stalk: 'stalk', stalks: 'stalk', tub: 'tub', tubs: 'tub',
  pot: 'pot', pots: 'pot', strip: 'strip', strips: 'strip', bottle: 'bottle', bottles: 'bottle', ball: 'ball', balls: 'ball',
  cube: 'cube', cubes: 'cube', rasher: 'slice', rashers: 'slice', thigh: 'thigh', thighs: 'thigh', breast: 'breast', breasts: 'breast',
  splash: 'splash', drop: 'drop', drops: 'drop', scoop: 'scoop', scoops: 'scoop', box: 'box', boxes: 'box', carton: 'carton', cartons: 'carton',
};
const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', cl: 'cl', dl: 'dl',
  l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', t: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbls: 'tbsp', tblsp: 'tbsp', tblsps: 'tbsp', tbl: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup', pint: 'pint', pints: 'pint', pt: 'pint', quart: 'quart', quarts: 'quart', qt: 'quart',
};
// Words after a number that describe the thing, not a unit: "2 large", "3 chopped".
export const COUNT_WORDS = new Set(['large', 'medium', 'small', 'whole', 'chopped', 'sliced', 'diced', 'beaten', 'finely', 'grated', 'thinly',
  'fresh', 'ripe', 'peeled', 'cut', 'crushed', 'minced', 'halved', 'skinned', 'boiled', 'steamed', 'ground', 'big', 'extra',
  'free-range', 'thin', 'thick', 'to', 'shredded', 'cubed', 'quartered', 'deseeded', 'trimmed', 'roughly', 'cooked', 'hard-boiled',
  'softened', 'melted', 'mashed', 'juiced', 'zested', 'pitted', 'stoned', 'washed', 'dried', 'frozen', 'cold', 'warm', 'hot', 'mixed', 'jumbo']);

const PLURALS: Record<string, string> = {
  leaf: 'leaves', bunch: 'bunches', pinch: 'pinches', dash: 'dashes', box: 'boxes', splash: 'splashes', cup: 'cups', breast: 'breasts',
};
const NO_PLURAL = new Set(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'oz', 'lb', 'fl oz']);

export function unitLabel(unit: string, quantity: number | null): string {
  if (!unit) return '';
  if (NO_PLURAL.has(unit) || quantity === null || quantity <= 1) return unit;
  return PLURALS[unit] ?? `${unit}s`;
}

export function unitFamily(unit: string): 'mass' | 'volume' | 'count' {
  if (unit in MASS) return 'mass';
  if (unit in VOLUME) return 'volume';
  return 'count';
}

// ── Numbers ────────────────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');
/** A written number: "1", "1.5", "1/2", "1 1/2", "½", "1½", "1 ½". */
export const NUMBER_RE = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\s?[${FRACTION_CHARS}]|\d*\.?\d+)`;

export function parseNumber(raw: string): number {
  const s = raw.trim();
  const uni = s.match(new RegExp(`^(\\d*)\\s?([${FRACTION_CHARS}])$`));
  if (uni) return (uni[1] ? Number(uni[1]) : 0) + UNICODE_FRACTIONS[uni[2]];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
  return Number(s);
}

const DISPLAY_FRACTIONS: Array<[number, string]> = [[1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4']];

/** 0.75 -> "3/4", 1.5 -> "1 1/2", 2.4 -> "2.4", 12.3 -> "12". */
export function formatNumber(n: number): string {
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n);
  const rest = n - whole;
  if (rest < 0.04) return String(whole || (n > 0 ? +n.toFixed(2) : 0));
  if (rest > 0.96) return String(whole + 1);
  const frac = DISPLAY_FRACTIONS.find(([v]) => Math.abs(rest - v) < 0.04);
  if (frac) return whole ? `${whole} ${frac[1]}` : frac[1];
  return String(+n.toFixed(1));
}

/** Rounds to the nearest kitchen fraction (1/4, 1/3, 1/2, 2/3, 3/4). */
function kitchenRound(n: number): number {
  const whole = Math.floor(n);
  const steps = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
  const rest = n - whole;
  const best = steps.reduce((a, b) => (Math.abs(b - rest) < Math.abs(a - rest) ? b : a));
  return whole + best;
}

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

// ── Parsing ────────────────────────────────────────────────────────────────

const LEADING = new RegExp(String.raw`^(${NUMBER_RE})(?:\s*(?:-|–|to)\s*(${NUMBER_RE}))?\s*(.*)$`);

/** Free-text measure -> structured measure. Never throws; unparsed text lands in `note`. */
export function parseMeasure(raw: string | null | undefined): Measure {
  const original = (raw ?? '').replace(/\s+/g, ' ').trim();
  const none: Measure = { quantity: null, quantityMax: null, unit: '', note: original };
  if (!original) return none;
  let text = original.toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')                                   // "1,5 kg"
    .replace(new RegExp(`^(${NUMBER_RE}\\s*[a-z]+\\.?)\\s*/\\s*${NUMBER_RE}\\s*(?:fl\\.?\\s?)?[a-z]+\\.?`), '$1'); // "200g/7oz", "50ml/2fl oz" -> first
  // A parenthesised size stays as a note: "1 (400g) can" -> 1 can "(400g)".
  let paren = '';
  text = text.replace(/\(([^)]*)\)/, (_, inner: string) => { paren = `(${inner.trim()})`; return ' '; }).replace(/\s+/g, ' ').trim();

  const m = text.match(LEADING);
  if (!m) return none;
  const quantity = parseNumber(m[1]);
  if (!(quantity > 0) || !Number.isFinite(quantity)) return none;
  let quantityMax = m[2] ? parseNumber(m[2]) : null;
  let rest = m[3].trim();
  // "8-ounce can" / "1 – 14-ounce can": a hyphenated size, not a range.
  if (rest.startsWith('-')) {
    const size = rest.match(/^-\s*(ounce|oz|inch|in|pound|lb|cm|litre|liter)s?\b\s*(.*)$/);
    if (size && m[2]) {
      const unitWord = size[2].split(' ')[0] ?? '';
      const countUnit = COUNT_UNITS[unitWord] ?? '';
      quantityMax = null;
      const sizeNote = `(${m[2]} ${UNIT_ALIASES[size[1]] ?? size[1]})`;
      return { quantity, quantityMax: null, unit: countUnit, note: [sizeNote, countUnit ? size[2].slice(unitWord.length).trim() : size[2]].filter(Boolean).join(' ') };
    }
    rest = rest.replace(/^-\s*/, '');
  }
  // Lengths ("2cm piece") aren't amounts to scale: keep as written (converted on display).
  if (/^(cm|mm|inch|inches|in)\b/.test(rest)) return none;

  // "2 x 400g tins": two cans, each 400g.
  const multi = rest.match(new RegExp(`^x\\s*(${NUMBER_RE})\\s*([a-z]+)\\.?\\s*(.*)$`));
  if (multi) {
    const size = `${multi[1]}${multi[2]}`;
    const after = multi[3].trim();
    const word = after.split(' ')[0] ?? '';
    const unit = COUNT_UNITS[word] ?? '';
    const note = [`(${size})`, unit ? after.slice(word.length).trim() : after].filter(Boolean).join(' ');
    return { quantity, quantityMax, unit, note };
  }
  rest = rest.replace(/^x\s+/, '');

  const wordMatch = rest.match(/^([a-z]+(?:\s?oz)?)\.?(?=\s|$|[^a-z])/);
  let unit = '';
  let after = rest;
  if (wordMatch) {
    const word = wordMatch[1];
    if (word === 'fl oz' || word === 'floz' || (word === 'fl' && /^fl\.?\s*oz/.test(rest))) {
      unit = 'fl oz';
      after = rest.replace(/^fl\.?\s*oz\.?/, '');
    } else if (UNIT_ALIASES[word]) {
      unit = UNIT_ALIASES[word];
      after = rest.slice(wordMatch[0].length);
    } else if (COUNT_UNITS[word]) {
      unit = COUNT_UNITS[word];
      after = rest.slice(wordMatch[0].length);
    } else if (!COUNT_WORDS.has(word) && word !== 'of') {
      // "1 juice of", "2 for garnish": no reliable unit, keep it all as written.
      return { quantity, quantityMax, unit: '', note: [rest, paren].filter(Boolean).join(' ') };
    }
  }
  if (unit === 'cl') { return { quantity: quantity * 10, quantityMax: quantityMax && quantityMax * 10, unit: 'ml', note: [after.trim(), paren].filter(Boolean).join(' ') }; }
  if (unit === 'dl') { return { quantity: quantity * 100, quantityMax: quantityMax && quantityMax * 100, unit: 'ml', note: [after.trim(), paren].filter(Boolean).join(' ') }; }
  const note = [after.replace(/^\s*of\s+/, '').trim(), paren].filter(Boolean).join(' ');
  return { quantity, quantityMax, unit, note };
}

// ── Converting and formatting ──────────────────────────────────────────────

/** A mass in grams as US text: "7 oz", "2 lb", "1 1/4 lb". */
export function usMass(grams: number): string {
  const oz = grams / MASS.oz;
  if (oz < 2) return `${formatNumber(roundTo(oz, 0.25))} oz`;
  if (oz < 15.5) return `${formatNumber(roundTo(oz, oz < 6 ? 0.5 : 1))} oz`;
  return `${formatNumber(roundTo(grams / MASS.lb, 0.25))} lb`;
}

/** A volume in ml as US text: "2 tsp", "3 tbsp", "3/4 cup", "4 1/4 cups". */
export function usVolume(ml: number): string {
  if (ml < 14) { const tsp = roundTo(ml / VOLUME.tsp, 0.25); return `${formatNumber(tsp)} tsp`; }
  if (ml < 59) { const tbsp = roundTo(ml / VOLUME.tbsp, 0.5); return `${formatNumber(tbsp)} tbsp`; }
  const cups = kitchenRound(ml / VOLUME.cup);
  return `${formatNumber(cups)} ${cups > 1 ? 'cups' : 'cup'}`;
}

export function metricMass(grams: number): string {
  if (grams >= 1000) return `${+(grams / 1000).toFixed(2)} kg`;
  return `${roundTo(grams, grams < 20 ? 1 : 5)} g`;
}

export function metricVolume(ml: number): string {
  if (ml >= 1000) return `${+(ml / 1000).toFixed(2)} l`;
  return `${roundTo(ml, ml < 20 ? 1 : 5)} ml`;
}

const US_NATIVE = new Set(['tsp', 'tbsp', 'cup', 'oz', 'lb', 'fl oz', 'quart']);
const METRIC_NATIVE = new Set(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp']);

/** One amount in one unit, converted for the unit system: (500, "g", "us") -> "1 lb". */
export function formatAmount(quantity: number, unit: string, system: UnitSystem): string {
  const family = unitFamily(unit);
  if (family === 'count') {
    const n = formatNumber(quantity);
    return unit ? `${n} ${unitLabel(unit, quantity)}` : n;
  }
  const native = system === 'us' ? US_NATIVE : METRIC_NATIVE;
  if (native.has(unit)) return `${formatNumber(quantity)} ${unitLabel(unit, quantity)}`;
  if (family === 'mass') {
    const grams = quantity * MASS[unit];
    return system === 'us' ? usMass(grams) : metricMass(grams);
  }
  const ml = quantity * VOLUME[unit];
  return system === 'us' ? usVolume(ml) : metricVolume(ml);
}

/** A structured measure as display text, scaled by `multiplier`. Unparsed measures are returned as written. */
export function formatMeasure(m: Measure, system: UnitSystem, multiplier = 1): string {
  const note = convertTextUnits(m.note, system);
  if (m.quantity === null) return note;
  let amount: string;
  if (m.quantityMax !== null && m.quantityMax > m.quantity) {
    const lo = formatAmount(m.quantity * multiplier, m.unit, system);
    const hi = formatAmount(m.quantityMax * multiplier, m.unit, system);
    // "1-2 tbsp" rather than "1 tbsp-2 tbsp" when the unit text matches.
    const loParts = lo.split(' '); const hiParts = hi.split(' ');
    const loUnit = loParts.slice(1).join(' '); const hiUnit = hiParts.slice(1).join(' ');
    amount = loUnit && (loUnit === hiUnit || unitLabel(m.unit, 2) === hiUnit) ? `${loParts[0]}-${hi}` : `${lo}-${hi}`;
  } else {
    amount = formatAmount(m.quantity * multiplier, m.unit, system);
  }
  return note ? `${amount} ${note}` : amount;
}

// ── Converting free text (steps, notes) ────────────────────────────────────

const fahrenheitFromCelsius = (c: number) => Math.round((c * 9 / 5 + 32) / 25) * 25;
const GAS_MARK_F: Record<number, number> = { 1: 275, 2: 300, 3: 325, 4: 350, 5: 375, 6: 400, 7: 425, 8: 450, 9: 475 };
const DEG = String.raw`\s*(?:°|º|˚|degrees?|deg\.?)?\s*`;

interface TempToken { start: number; end: number; kind: 'C' | 'F' | 'gas'; value: number; fan: boolean }

function temperatureTokens(text: string): TempToken[] {
  const re = new RegExp(
    String.raw`(fan(?:\s+oven)?\s*)?(\d{2,3})${DEG}(c|celsius|centigrade|f|fahrenheit)\b(\s*\(?\s*fan(?:\s+oven)?\s*\)?)?` +
    String.raw`|gas\s*(?:mark\s*)?(\d)\b`, 'gi');
  const tokens: TempToken[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (m[5]) {
      tokens.push({ start, end: start + m[0].length, kind: 'gas', value: Number(m[5]), fan: false });
    } else {
      const kind = m[3].toLowerCase().startsWith('f') ? 'F' : 'C';
      tokens.push({ start, end: start + m[0].length, kind, value: Number(m[2]), fan: !!(m[1] || m[4]) });
    }
  }
  return tokens;
}

// Text allowed between temperatures that describe the same oven setting.
const TEMP_GLUE = /^[\s/,()]*(?:or|and)?[\s/,()]*(?:conventional|regular|convection|fan|(?:top and bottom heat))?[\s/,()]*(?:oven)?[\s/,()]*$/i;

/** "200C/180C fan/gas 6" -> "400°F" (US) or "200°C" (metric). Groups that name the same setting become one value. */
export function convertTemperatures(text: string, system: UnitSystem): string {
  const tokens = temperatureTokens(text);
  if (!tokens.length) return text;
  const groups: TempToken[][] = [];
  for (const t of tokens) {
    const last = groups.at(-1);
    if (last && TEMP_GLUE.test(text.slice(last.at(-1)!.end, t.start))) last.push(t);
    else groups.push([t]);
  }
  let out = '';
  let cursor = 0;
  for (const group of groups) {
    let start = group[0].start;
    let end = group.at(-1)!.end;
    // Swallow the parentheses that belonged to the group: "180°C (350°F)".
    const span = text.slice(start, end);
    const open = (span.match(/\(/g) ?? []).length - (span.match(/\)/g) ?? []).length;
    if (open > 0) { const close = text.indexOf(')', end); if (close >= 0 && /^\s*$/.test(text.slice(end, close))) end = close + 1; }
    if (open < 0 && text[start - 1] === '(') start -= 1;
    const f = group.find(t => t.kind === 'F');
    const c = group.find(t => t.kind === 'C' && !t.fan);
    const fanC = group.find(t => t.kind === 'C' && t.fan);
    const gas = group.find(t => t.kind === 'gas');
    let value: string;
    if (system === 'us') {
      const deg = f ? f.value : c ? fahrenheitFromCelsius(c.value) : fanC ? fahrenheitFromCelsius(fanC.value + 20) : GAS_MARK_F[gas!.value];
      value = `${deg}°F`;
    } else {
      const deg = c ? c.value : fanC ? fanC.value + 20 : f ? Math.round(((f.value - 32) * 5 / 9) / 10) * 10 : Math.round(((GAS_MARK_F[gas!.value] - 32) * 5 / 9) / 10) * 10;
      value = `${deg}°C`;
    }
    out += text.slice(cursor, start) + value;
    cursor = end;
  }
  return out + text.slice(cursor);
}

const INLINE_UNIT = String.raw`(kg|g|grams?|ml|millilitres?|milliliters?|l|litres?|liters?|cm|mm|oz|lbs?)`;

/**
 * Converts temperatures, weights, volumes and lengths written inside free text.
 * "Cut 900g potatoes into 2cm cubes" -> "Cut 2 lb potatoes into 3/4 inch cubes" (US).
 * Metric text is left as written apart from temperatures written only in Fahrenheit.
 */
export function convertTextUnits(text: string, system: UnitSystem): string {
  if (!text) return text;
  let out = convertTemperatures(text, system);
  if (system === 'metric') return out;
  // Pairs written both ways ("200g/7oz", "200g (7oz)", "2lb/900g", "50-55 g/ 1.7-1.9 oz",
  // "7-10 cm/ 3-4 inches"): keep the imperial half.
  const RANGE = String.raw`${NUMBER_RE}(?:\s*[-–]\s*${NUMBER_RE})?`;
  const IMPERIAL = String.raw`(oz|lbs?|fl\.?\s?oz|floz|cups?|inch(?:es)?)`;
  const METRIC = String.raw`(kg|g|ml|l|cm|mm)`;
  const tidy = (u: string) => u.toLowerCase().replace(/^lbs$/, 'lb').replace(/^fl\.?\s?oz$|^floz$/, 'fl oz');
  out = out.replace(new RegExp(String.raw`\b(${RANGE})\s*${METRIC}\b\s*(?:/|\()\s*(${RANGE})\s*${IMPERIAL}\b\)?`, 'gi'),
    (_m, _a, _u, b: string, u2: string) => `${b} ${tidy(u2)}`);
  out = out.replace(new RegExp(String.raw`\b(${RANGE})\s*${IMPERIAL}\s*/\s*(${RANGE})\s*${METRIC}\b`, 'gi'),
    (_m, a: string, u1: string) => `${a} ${tidy(u1)}`);
  out = out.replace(new RegExp(String.raw`(^|[^\w/.])(${NUMBER_RE})(?:\s*(?:-|–|to)\s*(${NUMBER_RE}))?\s?${INLINE_UNIT}\b(?!\s*\/\s*\d)`, 'gi'),
    (whole, lead: string, a: string, b: string | undefined, unitRaw: string) => {
      const unit = unitRaw.toLowerCase();
      if (unit === 'oz' || unit.startsWith('lb')) return whole;
      const one = (n: number): string => {
        if (unit === 'cm' || unit === 'mm') {
          const inches = (unit === 'mm' ? n / 10 : n) / 2.54;
          const r = inches < 1 ? roundTo(inches, 0.25) : inches < 6 ? roundTo(inches, 0.5) : Math.round(inches);
          return `${formatNumber(r)} inch`;
        }
        const canonical = UNIT_ALIASES[unit] ?? unit;
        return formatAmount(n, canonical, 'us');
      };
      const lo = parseNumber(a);
      if (!(lo > 0)) return whole;
      if (b) {
        const hi = parseNumber(b);
        const loText = one(lo); const hiText = one(hi);
        const loNum = loText.split(' ')[0]; const unitText = hiText.split(' ').slice(1).join(' ');
        return `${lead}${loText.split(' ').slice(1).join(' ') === unitText ? `${loNum}-${hiText}` : `${loText}-${hiText}`}`;
      }
      return `${lead}${one(lo)}`;
    });
  return out;
}

// ── Scaling helpers for the client ─────────────────────────────────────────

/** Converts a measure's amount to the family's base unit (g / ml) or the count itself. */
export function toBase(quantity: number, unit: string): { family: string; value: number } {
  const family = unitFamily(unit);
  if (family === 'mass') return { family: 'mass', value: quantity * MASS[unit] };
  if (family === 'volume') return { family: 'volume', value: quantity * VOLUME[unit] };
  return { family: `count:${unit}`, value: quantity };
}

/** A base-unit total as text: ("mass", 900, "us") -> "2 lb". */
export function formatBase(family: string, value: number, system: UnitSystem): string {
  if (family === 'mass') return system === 'us' ? usMass(value) : metricMass(value);
  if (family === 'volume') return system === 'us' ? usVolume(value) : metricVolume(value);
  const unit = family.slice('count:'.length);
  return formatAmount(value, unit, system);
}
