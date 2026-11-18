// The one shape every import produces and the recipe editor reads: a recipe the household
// hasn't saved yet. Website, photo, social and typed-in recipes all become an ImportDraft,
// land on the review screen, and are only turned into a `recipes` row when saved
// (structure.ts). Pure TypeScript (Deno, Vite, Node).

export type SourceKind = 'manual' | 'website' | 'photo' | 'social';
export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'facebook';

export interface DraftIngredient {
  /** Lower bound of the amount, or null when there is none ("salt to taste") or it couldn't be read. */
  quantity: number | null;
  /** Upper bound of a range ("2-3 cloves"), else null. */
  quantity_max: number | null;
  /** Canonical unit ("cup", "g", "clove") or '' for a bare count or no amount. */
  unit: string;
  /** What to buy: "all-purpose flour". */
  item: string;
  /** Preparation and anything else after the item: "sifted", "to taste", "(14 oz)". */
  note: string;
}

export interface DraftSource {
  kind: SourceKind;
  /** The page or post the recipe came from (canonical form, see canonicalUrl). */
  url: string | null;
  /** "Serious Eats", "Budget Bytes", or the platform name for social posts. */
  site_name: string | null;
  platform?: SocialPlatform | null;
  /** Creator handle without the @, for social posts. */
  handle?: string | null;
}

/** A part of the draft the household should check before saving, and why. */
export interface DraftFlag {
  field: 'title' | 'servings' | 'prep_minutes' | 'cook_minutes' | 'ingredients' | 'steps' | 'notes';
  /** For ingredients and steps: which line (0-based). */
  index?: number;
  /** For ingredients: which part of the line. */
  part?: 'quantity' | 'unit' | 'item';
  reason: string;
  /** For an ingredient the steps use but the list leaves out: the line to add if the household agrees. */
  add?: string;
}

export interface ImportDraft {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  /** Total time when the source gives one (it can be more than prep + cook). */
  total_minutes: number | null;
  ingredients: DraftIngredient[];
  /** Ordered, one instruction per entry. Section headings are folded into the step text. */
  steps: string[];
  notes: string;
  /** The recipe's photo: a web URL, or a storage reference (see photoRef in the app). */
  image_url: string | null;
  source: DraftSource;
  flags: DraftFlag[];
}

export function emptyDraft(kind: SourceKind = 'manual'): ImportDraft {
  return {
    title: '', servings: null, prep_minutes: null, cook_minutes: null, total_minutes: null,
    ingredients: [], steps: [], notes: '', image_url: null,
    source: { kind, url: null, site_name: null, platform: null, handle: null },
    flags: [],
  };
}

const TRACKING = /^(utm_|fbclid$|gclid$|igsh$|igshid$|mc_cid$|mc_eid$|_ga$|ref$|ref_src$|si$|share_id$|is_from_webapp$|sender_device$|sender_web_id$)/i;

/**
 * One spelling per page, so the same recipe saved twice is recognized: https, no "www.",
 * no tracking parameters, no #fragment, no trailing slash. Null for anything that isn't an
 * http(s) URL.
 */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  url.hash = '';
  url.port = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const text = url.toString();
  return url.pathname !== '/' && text.endsWith('/') ? text.slice(0, -1) : text.replace(/\/(\?|$)/, '$1');
}
