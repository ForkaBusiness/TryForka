// Text for the recipe PDF, written with the characters its embedded fonts have
// (public/fonts/pdf, subset by scripts/make-pdf-fonts.py). A character the font lacks would
// print as nothing, so the few that turn up in recipes are spelled out instead. Pure,
// tested in tests/pdfText.test.ts.

const SPELLED: Record<string, string> = {
  '℉': '°F', '℃': '°C',
  '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
};
const SPELL = /[℃℉⅐-⅒⅕-⅚ﬀ-ﬄ]/g;
// Pictographs and symbols no recipe font has (emoji, dingbats): left out rather than shown as gaps.
const PICTOGRAPHS = /[☀-➿\u{1F000}-\u{1FAFF}]/gu;
/** Emoji joiners and variation selectors, left behind once the pictographs are gone. */
const JOINERS = /️|‍/g;

/** One string, ready for the PDF: accents composed, missing characters spelled out. */
export function pdfText(s: string): string {
  return s.normalize('NFC').replace(SPELL, ch => SPELLED[ch] ?? ch).replace(PICTOGRAPHS, '').replace(JOINERS, '').replace(/ {2,}/g, ' ');
}

/** Every string in a value (the recipe's print data), ready for the PDF. */
export function pdfData<T>(value: T): T {
  if (typeof value === 'string') return pdfText(value) as T;
  if (Array.isArray(value)) return value.map(pdfData) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pdfData(v)])) as T;
  return value;
}
