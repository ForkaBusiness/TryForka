// Recipe pages -> the recipe on them, from schema.org Recipe JSON-LD. Pure TypeScript
// (Deno, Vite, Node). Most recipe sites publish this for search engines, so it is the most
// accurate source there is; the model is only asked when it's missing or unusable.
//
// Ingredient lines come back as written ("2 cups flour, sifted"): the editor's line parser
// turns them into structured ingredients, the same way pasted text is.

export interface PageMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  canonical: string | null;
  /** og:type ("article", "video.other"). */
  type: string | null;
}

export interface ParsedRecipe {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  ingredientLines: string[];
  steps: string[];
  notes: string;
  image_url: string | null;
  site_name: string | null;
  author: string | null;
  canonical: string | null;
}

export interface ParsedPage {
  recipe: ParsedRecipe | null;
  meta: PageMeta;
  /** At least two ingredients and one step: good enough to skip the model. */
  usable: boolean;
  reason?: 'no_recipe' | 'incomplete';
}

// deno-lint-ignore no-explicit-any -- JSON-LD is untyped
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-LD is untyped
type Json = any;

// ── Text ───────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', frac18: '⅛', deg: '°', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', times: '×',
  reg: '®', copy: '©', trade: '™', bull: '•', middot: '·', iacute: 'í', aacute: 'á', oacute: 'ó', uacute: 'ú',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try { return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole; } catch { return whole; }
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** Inline tags (<b>, <a>, <span>) vanish without a gap: "the <b>flour</b>." stays "the flour." */
const INLINE_TAG = /<\/?(?:b|strong|i|em|u|a|span|small|sup|sub|mark|abbr)\b[^>]*>/gi;

/** Tags out, entities decoded (twice: some sites double-encode), whitespace collapsed. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return typeof value === 'number' ? String(value) : '';
  const strip = (t: string) => t.replace(/<br\s*\/?>/gi, ' ').replace(INLINE_TAG, '').replace(/<[^>]*>/g, ' ');
  const s = strip(decodeEntities(decodeEntities(strip(value))));
  return s.replace(/[\s\u00a0]+/g, ' ').trim();
}

// ── Finding the JSON-LD ────────────────────────────────────────────────────

/** Raw control characters inside strings make JSON.parse fail; many sites emit them. */
function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === '\\') { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += ' '; continue; }
      if (ch.charCodeAt(0) < 0x20) continue;
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseJson(text: string): Json | undefined {
  const body = text.trim()
    .replace(/^<!--/, '').replace(/-->$/, '')
    .replace(/^\/\/\s*<!\[CDATA\[/, '').replace(/\/\/\s*\]\]>$/, '')
    .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    .trim();
  if (!body) return undefined;
  try { return JSON.parse(body); } catch { /* try a repair */ }
  try { return JSON.parse(repairJson(body)); } catch { return undefined; }
}

export function jsonLdBlocks(html: string): Json[] {
  const blocks: Json[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(m[1])) continue;
    const parsed = parseJson(m[2]);
    if (parsed !== undefined) blocks.push(parsed);
  }
  return blocks;
}

const typeNames = (node: Json): string[] => {
  const t = node?.['@type'];
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.filter((x: unknown) => typeof x === 'string').map((x: string) => x.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase());
};

/** Every Recipe object anywhere in the blocks: arrays, @graph, mainEntity and the like. */
export function findRecipes(blocks: Json[]): Json[] {
  const found: Json[] = [];
  const seen = new Set<Json>();
  const visit = (node: Json, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) visit(n, depth + 1); return; }
    if (typeNames(node).includes('recipe')) found.push(node);
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'hasPart', 'about', 'item']) {
      if (node[key] && typeof node[key] === 'object') visit(node[key], depth + 1);
    }
  };
  for (const b of blocks) visit(b, 0);
  return found;
}

// ── Fields ─────────────────────────────────────────────────────────────────

/** ISO 8601 duration ("PT1H30M", "P0DT0H20M", "PT90M") or a plain number of minutes. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value === 'number') return value > 0 && value < 10_000 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return durationMinutes(Number(s));
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return null;
  const [, , , w, d, h, min, sec] = m.map(x => (x ? Number(x) : 0));
  const total = (w as number) * 7 * 1440 + (d as number) * 1440 + (h as number) * 60 + (min as number) + (sec as number) / 60;
  const rounded = Math.round(total);
  return rounded > 0 && rounded < 10_000 ? rounded : null;
}

/** recipeYield -> servings: 4, "4 servings", "Serves 4-6" (4), ["4", "4 servings"]. Null outside 1-100. */
export function yieldServings(value: unknown): number | null {
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    if (typeof v === 'number') { if (v >= 1 && v <= 100) return Math.round(v); continue; }
    if (typeof v !== 'string') continue;
    const text = cleanText(v);
    // "2 1/2 dozen", "1½ dozen cookies": dozens are counted out.
    const dozen = text.match(/(\d+)?(?:\s*(\d)\/(\d)|\s*([½¼¾]))?\s*dozen/i);
    if (dozen && (dozen[1] || dozen[2] || dozen[4])) {
      const frac = dozen[2] ? Number(dozen[2]) / Number(dozen[3]) : dozen[4] ? ({ '½': 0.5, '¼': 0.25, '¾': 0.75 } as Record<string, number>)[dozen[4]] : 0;
      const n = Math.round((Number(dozen[1] ?? 0) + frac) * 12);
      if (n >= 1 && n <= 100) return n;
    }
    const m = text.match(/(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const n = Math.round(Number(m[1]));
    if (n >= 1 && n <= 100) return n;
  }
  return null;
}

function absolute(url: unknown, base: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(decodeEntities(url.trim()), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

function imageUrl(value: Json, base: string): string | null {
  if (!value) return null;
  if (typeof value === 'string') return absolute(value, base);
  if (Array.isArray(value)) {
    const options = value.map(v => ({ url: imageUrl(v, base), width: Number(v?.width?.['@value'] ?? v?.width) || 0 })).filter(o => o.url);
    if (!options.length) return null;
    const widest = options.reduce((a, b) => (b.width > a.width ? b : a));
    return (widest.width ? widest : options[0]).url;
  }
  if (typeof value === 'object') return absolute(value.url ?? value.contentUrl ?? value['@id'], base);
  return null;
}

function personName(value: Json): string | null {
  if (!value) return null;
  if (typeof value === 'string') return cleanText(value) || null;
  if (Array.isArray(value)) return personName(value[0]);
  if (typeof value === 'object') return cleanText(value.name) || null;
  return null;
}

function ingredientLines(recipe: Json): string[] {
  const raw = recipe.recipeIngredient ?? recipe.ingredients;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  return list.map((x: unknown) => cleanText(typeof x === 'object' && x ? (x as Json).name ?? (x as Json).text : x)).filter(Boolean);
}

/** Splits one block of instruction text: by line, or by "1." markers in a single paragraph. */
function splitInstructionText(text: string): string[] {
  const withBreaks = text.replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, '\n');
  const lines = withBreaks.split(/\r?\n+/).map(cleanText).filter(Boolean);
  if (lines.length > 1) return lines.map(l => l.replace(/^(step\s*)?\d+[.):]\s+/i, ''));
  const one = lines[0] ?? '';
  const numbered = one.split(/\s(?=\d{1,2}[.)]\s+[A-Z])/);
  if (numbered.length > 1) return numbered.map(s => s.replace(/^\d{1,2}[.)]\s+/, '').trim()).filter(Boolean);
  return one ? [one.replace(/^(step\s*)?\d+[.):]\s+/i, '')] : [];
}

interface Section { name: string; steps: string[] }

function collectSteps(node: Json, into: Section[], current: Section, depth = 0): void {
  if (node == null || depth > 8) return;
  if (typeof node === 'string') { current.steps.push(...splitInstructionText(node)); return; }
  if (Array.isArray(node)) { for (const n of node) collectSteps(n, into, current, depth + 1); return; }
  if (typeof node !== 'object') return;
  const types = typeNames(node);
  if (types.includes('howtosection')) {
    const section: Section = { name: cleanText(node.name), steps: [] };
    into.push(section);
    collectSteps(node.itemListElement ?? node.steps ?? node.text, into, section, depth + 1);
    return;
  }
  if (types.includes('itemlist') || (!types.length && node.itemListElement)) {
    collectSteps(node.itemListElement, into, current, depth + 1);
    return;
  }
  // HowToStep, HowToDirection, ListItem, or a bare object.
  const name = cleanText(node.name);
  const textValue = node.text ?? node.description ?? (node.item && typeof node.item === 'object' ? node.item.text : undefined);
  if (typeof textValue === 'string' && textValue.trim()) {
    current.steps.push(...splitInstructionText(textValue));
  } else if (node.itemListElement) {
    collectSteps(node.itemListElement, into, current, depth + 1);
  } else if (name) {
    current.steps.push(name);
  }
}

export function instructionSteps(recipe: Json): string[] {
  const loose: Section = { name: '', steps: [] };
  const sections: Section[] = [loose];
  collectSteps(recipe.recipeInstructions ?? recipe.instructions, sections, loose);
  const named = sections.filter(s => s.name && s.steps.length);
  const out: string[] = [];
  for (const section of sections) {
    const steps = section.steps
      .map(s => s.trim())
      .filter(s => s && s.toLowerCase() !== section.name.toLowerCase());
    steps.forEach((s, i) => out.push(i === 0 && section.name && named.length > 1 ? `${section.name.replace(/:$/, '')}: ${s}` : s));
  }
  // Some sites list each step twice (name and text).
  return out.filter((s, i) => s !== out[i - 1]);
}

// ── Page metadata ──────────────────────────────────────────────────────────

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

export function pageMeta(html: string, pageUrl: string): PageMeta {
  const metas = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? attr(m[0], 'itemprop'))?.toLowerCase();
    const content = attr(m[0], 'content');
    if (key && content != null && !metas.has(key)) metas.set(key, cleanText(content));
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).find(t => /\brel\s*=\s*["']?canonical\b/i.test(t));
  const get = (...keys: string[]) => keys.map(k => metas.get(k)).find(v => v) ?? null;
  return {
    title: get('og:title', 'twitter:title') ?? (titleTag ? cleanText(titleTag[1]) || null : null),
    description: get('og:description', 'twitter:description', 'description'),
    image: absolute(get('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'), pageUrl),
    site_name: get('og:site_name', 'application-name'),
    canonical: absolute(canonicalTag ? attr(canonicalTag, 'href') : get('og:url'), pageUrl),
    type: get('og:type'),
  };
}

// ── The page ───────────────────────────────────────────────────────────────

function hostName(pageUrl: string): string | null {
  try { return new URL(pageUrl).hostname.replace(/^www\./, '') || null; } catch { return null; }
}

function toParsed(recipe: Json, meta: PageMeta, pageUrl: string): ParsedRecipe {
  return {
    title: cleanText(recipe.name ?? recipe.headline) || meta.title || '',
    servings: yieldServings(recipe.recipeYield ?? recipe.yield),
    prep_minutes: durationMinutes(recipe.prepTime),
    cook_minutes: durationMinutes(recipe.cookTime),
    total_minutes: durationMinutes(recipe.totalTime),
    ingredientLines: ingredientLines(recipe),
    steps: instructionSteps(recipe),
    notes: '',
    image_url: imageUrl(recipe.image, pageUrl) ?? meta.image,
    site_name: meta.site_name ?? personName(recipe.publisher) ?? hostName(pageUrl),
    author: personName(recipe.author),
    canonical: meta.canonical ?? absolute(typeof recipe.url === 'string' ? recipe.url : null, pageUrl),
  };
}

export function parseRecipePage(html: string, pageUrl: string): ParsedPage {
  const meta = pageMeta(html, pageUrl);
  const candidates = findRecipes(jsonLdBlocks(html)).map(r => toParsed(r, meta, pageUrl));
  if (!candidates.length) return { recipe: null, meta, usable: false, reason: 'no_recipe' };
  const recipe = candidates.reduce((a, b) => (b.ingredientLines.length + b.steps.length > a.ingredientLines.length + a.steps.length ? b : a));
  const usable = recipe.ingredientLines.length >= 2 && recipe.steps.length >= 1;
  return usable ? { recipe, meta, usable } : { recipe, meta, usable, reason: 'incomplete' };
}

// ── Plain text for the model fallback ──────────────────────────────────────

/** The page's readable text, without scripts, menus and footers, for when there's no JSON-LD. */
export function pageText(html: string, maxChars = 20000): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|nav|header|footer|aside|svg|noscript|form|iframe|template|button|select)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|li|ul|ol|div|section|article|tr|table|h[1-6]|blockquote|figure|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  const lines = s.split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim());
  const out: string[] = [];
  for (const line of lines) {
    if (!line && (!out.length || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  const text = out.join('\n').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
