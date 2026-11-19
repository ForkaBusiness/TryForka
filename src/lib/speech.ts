// Read aloud in cooking mode: the words to say for a step, with amounts spoken the way a
// person says them ("one and a half cups", not "1 1/2 c"), and the best voice for the
// device's language. Pure, tested in tests/speech.test.ts; useReadAloud does the speaking.

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** 1-20 as words; larger numbers read fine as digits. */
const numberWord = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 20 ? SMALL[n] : String(n));

// A fraction as said on its own ("a quarter") and after a whole number ("and a quarter").
const FRACTIONS: Record<string, { alone: string; plural: boolean }> = {
  '1/2': { alone: 'half', plural: false }, '1/3': { alone: 'a third', plural: false }, '2/3': { alone: 'two thirds', plural: true },
  '1/4': { alone: 'a quarter', plural: false }, '3/4': { alone: 'three quarters', plural: true }, '1/8': { alone: 'an eighth', plural: false },
  '3/8': { alone: 'three eighths', plural: true }, '5/8': { alone: 'five eighths', plural: true }, '7/8': { alone: 'seven eighths', plural: true },
};
const GLYPHS: Record<string, string> = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
const DECIMALS: Record<string, string> = { '.5': '1/2', '.25': '1/4', '.75': '3/4' };

// Units after a number, as said (singular, plural).
const UNITS: Array<[RegExp, string, string]> = [
  [/^(?:fl\.?\s?oz|fluid ounces?)$/i, 'fluid ounce', 'fluid ounces'],
  [/^(?:cups?|c)$/, 'cup', 'cups'],
  [/^(?:tbsps?|tbs|tbl|tblsp|T|Tbsp|tablespoons?)$/, 'tablespoon', 'tablespoons'],
  [/^(?:tsps?|t|teaspoons?)$/, 'teaspoon', 'teaspoons'],
  [/^(?:oz|ounces?)$/i, 'ounce', 'ounces'],
  [/^(?:lbs?|pounds?)$/i, 'pound', 'pounds'],
  [/^(?:g|gr|grams?)$/i, 'gram', 'grams'],
  [/^(?:kgs?|kilos?|kilograms?)$/i, 'kilogram', 'kilograms'],
  [/^(?:ml|millilit(?:er|re)s?)$/i, 'milliliter', 'milliliters'],
  [/^(?:l|lit(?:er|re)s?)$/, 'liter', 'liters'],
  [/^(?:qts?|quarts?)$/i, 'quart', 'quarts'],
  [/^(?:pts?|pints?)$/i, 'pint', 'pints'],
  [/^(?:mins?|minutes?)$/i, 'minute', 'minutes'],
  [/^(?:hrs?|hours?)$/i, 'hour', 'hours'],
  [/^(?:secs?|seconds?)$/i, 'second', 'seconds'],
  [/^(?:cm|centimet(?:er|re)s?)$/i, 'centimeter', 'centimeters'],
  [/^(?:mm|millimet(?:er|re)s?)$/i, 'millimeter', 'millimeters'],
  [/^(?:inch|inches)$/i, 'inch', 'inches'],
];
const UNIT_WORDS = String.raw`fl\.?\s?oz|fluid ounces?|cups?|c|tbsps?|tbs|tbl|tblsp|T|Tbsp|tablespoons?|tsps?|t|teaspoons?|oz|ounces?|lbs?|pounds?|g|gr|grams?|kgs?|kilos?|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|qts?|quarts?|pts?|pints?|mins?|minutes?|hrs?|hours?|secs?|seconds?|cm|centimet(?:er|re)s?|mm|millimet(?:er|re)s?|inch|inches`;
const NUM = String.raw`\d+\s+\d\/\d|\d+\/\d+|\d*\s?[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?`;
const AMOUNT = new RegExp(String.raw`(?<![\w/.])(${NUM})(?:\s*(?:-|–|to)\s*(${NUM}))?(?:\s*(${UNIT_WORDS})(?![\w]))?`, 'g');

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

interface Spoken { words: string; plural: boolean; fractionOnly: string | null }

/** One written number as words: "1 1/2" -> "one and a half", "½" -> "half". */
function sayNumber(raw: string): Spoken {
  let s = raw.trim().replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, g => ` ${GLYPHS[g]}`).replace(/\s+/g, ' ').trim();
  const dec = s.match(/^(\d+)(\.\d+)$/);
  if (dec && DECIMALS[dec[2]]) s = `${dec[1]} ${DECIMALS[dec[2]]}`;
  const mixed = s.match(/^(\d+) (\d\/\d)$/);
  if (mixed && FRACTIONS[mixed[2]]) {
    const whole = Number(mixed[1]);
    const frac = FRACTIONS[mixed[2]].alone.replace(/^half$/, 'a half');
    return whole === 0 ? { words: FRACTIONS[mixed[2]].alone, plural: FRACTIONS[mixed[2]].plural, fractionOnly: mixed[2] }
      : { words: `${numberWord(whole)} and ${frac}`, plural: true, fractionOnly: null };
  }
  if (FRACTIONS[s]) return { words: FRACTIONS[s].alone, plural: FRACTIONS[s].plural, fractionOnly: s };
  const n = Number(s);
  if (Number.isFinite(n)) return { words: numberWord(n), plural: n !== 1, fractionOnly: null };
  return { words: raw, plural: true, fractionOnly: null };
}

function unitWords(unit: string, number: string): [string, string] | null {
  // A capital C after a number of 100 or more is an oven temperature, not cups.
  if (unit === 'C' && Number(number) >= 100) return null;
  const hit = UNITS.find(([re]) => re.test(unit.trim()));
  return hit ? [hit[1], hit[2]] : null;
}

/** "1 1/2 c" -> "one and a half cups"; "½ tsp" -> "half a teaspoon"; "1-2 tbsp" -> "one to two tablespoons". */
function sayAmount(lo: string, hi: string | undefined, unit: string | undefined): string {
  const a = sayNumber(lo);
  const u = unit ? unitWords(unit, lo) : null;
  if (hi) {
    const b = sayNumber(hi);
    const words = `${a.words} to ${b.words}`;
    return u ? `${words} ${u[1]}` : unit ? `${words} ${unit}` : words;
  }
  if (!u) return unit ? `${a.words} ${unit}` : a.words;
  if (a.fractionOnly) {
    // "half a cup", "a quarter of a cup", "three quarters of an ounce".
    return a.fractionOnly === '1/2' ? `half ${article(u[0])} ${u[0]}` : `${a.words} of ${article(u[0])} ${u[0]}`;
  }
  return `${a.words} ${a.plural ? u[1] : u[0]}`;
}

/** Amounts, temperatures and abbreviations in a line of recipe text, as they're said aloud. */
export function speakable(text: string): string {
  return text
    // Temperatures: "425°F", "200 °C", "180C".
    .replace(/(\d{2,3})\s*(?:°|º|˚|degrees?)\s*([CF])\b/g, (_, n, u) => `${n} degrees ${u === 'F' ? 'Fahrenheit' : 'Celsius'}`)
    .replace(/(\d{3})([CF])\b/g, (_, n, u) => `${n} degrees ${u === 'F' ? 'Fahrenheit' : 'Celsius'}`)
    .replace(/(\d+)\s*(?:"|”|-inch\b)/g, (_, n) => `${numberWord(Number(n))} inch`)
    .replace(AMOUNT, (m, lo: string, hi: string | undefined, unit: string | undefined) => {
      // Leave years, times of day and long numbers alone.
      if (!unit && !hi && /^\d{3,}$/.test(lo.trim())) return m;
      return sayAmount(lo, hi, unit);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SpokenIngredient { name: string; amount: string }

/** What read aloud says for a step: its number, its text, and the amounts it needs. */
export function stepScript(step: number, total: number, text: string, ingredients: readonly SpokenIngredient[]): string {
  const parts = [`Step ${step} of ${total}.`, speakable(text)];
  if (ingredients.length) {
    const list = ingredients.map(i => {
      const amount = i.amount.trim();
      if (!amount) return i.name.toLowerCase();
      // "to taste", "for frying": after the name. A number: before it.
      return /^[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(amount) ? `${speakable(amount)} ${i.name.toLowerCase()}` : `${i.name.toLowerCase()}, ${speakable(amount)}`;
    });
    parts.push(`You'll need ${list.join('; ')}.`);
  }
  return parts.join(' ').replace(/\.\./g, '.');
}

/** A script cut into sentences, each spoken on its own (pausing and long steps work better). */
export function sentences(script: string): string[] {
  return script.split(/(?<=[.!?;])\s+(?=[A-Z0-9a-z])/).map(s => s.trim()).filter(Boolean);
}

// ── Voices ─────────────────────────────────────────────────────────────────

export interface VoiceLike { name: string; lang: string; localService: boolean; default: boolean; voiceURI?: string }

// Apple's character voices: fun, but not for reading a recipe.
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Deranged|Hysterical|Pipe Organ)\b/i;

const norm = (lang: string) => lang.replace('_', '-').toLowerCase();

/**
 * The best voice for the device's language: the same language and region first, then the
 * same language; among those, enhanced or natural voices, then ones on the device (they
 * start at once and work offline), then the device's default. Null when none speaks it.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  const want = norm(lang || 'en-US');
  const base = want.split('-')[0];
  let best: V | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const l = norm(v.lang);
    // The right region always beats a better voice for another region.
    const match = l === want ? 10 : l.split('-')[0] === base ? 5 : 0;
    if (!match) continue;
    let score = match;
    if (/(enhanced|premium|neural|natural)/i.test(v.name)) score += 2;
    if (v.localService) score += 1;
    if (v.default) score += 0.5;
    if (NOVELTY.test(v.name)) score -= 10;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}
