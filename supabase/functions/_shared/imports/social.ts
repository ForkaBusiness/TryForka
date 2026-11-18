// Social posts (TikTok, Instagram, YouTube, Pinterest, Facebook): which platform a link is
// on, and the public text around a post (caption, description, title, creator, thumbnail)
// from oEmbed or the page's metadata. The video itself is never downloaded, scraped or
// transcribed. Pure TypeScript (Deno, Vite, Node).

import type { SocialPlatform } from './draft.ts';

const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', pinterest: 'Pinterest', facebook: 'Facebook',
};

export const platformName = (platform: SocialPlatform) => PLATFORM_NAMES[platform];

/** "From @handle on TikTok", or "From TikTok" when the creator isn't known. */
export function creditLine(platform: SocialPlatform, handle: string | null | undefined): string {
  const h = (handle ?? '').trim().replace(/^@/, '');
  return h ? `From @${h} on ${platformName(platform)}` : `From ${platformName(platform)}`;
}

function hostOf(url: string): { host: string; path: string; params: URLSearchParams } | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname, params: u.searchParams };
  } catch {
    return null;
  }
}

const isPinterestHost = (host: string) => host === 'pin.it' || /(^|\.)pinterest\.[a-z.]+$/.test(host);

/** The platform a post link is on, or null for any other page. */
export function detectPlatform(url: string): SocialPlatform | null {
  const u = hostOf(url);
  if (!u) return null;
  const { host, path, params } = u;
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') {
    return /^\/(?:[^/]+\/)?(p|reel|reels|tv)\//.test(path) ? 'instagram' : null;
  }
  if (host === 'youtu.be') return 'youtube';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    return (path === '/watch' && params.has('v')) || /^\/(shorts|live)\//.test(path) ? 'youtube' : null;
  }
  if (isPinterestHost(host)) return 'pinterest';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'fb.com') return 'facebook';
  return null;
}

/** The public oEmbed endpoint for a post, or null where oEmbed needs an app token (Instagram, Facebook). */
export function oembedUrl(platform: SocialPlatform, postUrl: string): string | null {
  const url = encodeURIComponent(postUrl);
  switch (platform) {
    case 'tiktok': return `https://www.tiktok.com/oembed?url=${url}`;
    case 'youtube': return `https://www.youtube.com/oembed?format=json&url=${url}`;
    case 'pinterest': return `https://www.pinterest.com/oembed.json?url=${url}`;
    default: return null;
  }
}

export interface PostText {
  /** The post's own words: caption or description. */
  caption: string;
  title: string;
  /** Creator handle without the @. */
  handle: string | null;
  author_url: string | null;
  thumbnail: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "/@handle" in a profile URL. */
function handleFromUrl(url: string): string | null {
  const m = /\/@([A-Za-z0-9._-]+)/.exec(url);
  return m ? m[1] : null;
}

export function fromOembed(platform: SocialPlatform, json: Record<string, unknown>): PostText {
  const title = str(json.title);
  const authorUrl = str(json.author_url) || null;
  const thumbnail = str(json.thumbnail_url) || null;
  let handle: string | null = null;
  let caption = title;
  switch (platform) {
    case 'tiktok':
      handle = str(json.author_unique_id) || (authorUrl ? handleFromUrl(authorUrl) : null) || null;
      break;
    case 'youtube':
      handle = (authorUrl ? handleFromUrl(authorUrl) : null) || str(json.author_name) || null;
      break;
    case 'pinterest':
      caption = str(json.description) || title;
      handle = str(json.author_name) || null;
      break;
    default:
      handle = str(json.author_name) || null;
  }
  return { caption, title, handle, author_url: authorUrl, thumbnail };
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const unescapeHtml = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+|#39);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m);

/** A JSON string literal's contents ("a\nb", "&") as text. */
function jsonString(raw: string): string {
  try { return JSON.parse(`"${raw}"`) as string; } catch { return raw; }
}

/** The text between the outermost quotes after "...: " in an Instagram og field. */
function quotedCaption(text: string): string | null {
  const m = /:\s*["“]([\s\S]*)["”]\s*\.?\s*$/.exec(text);
  return m ? m[1].trim() : null;
}

/** The post's text from page metadata, for posts without public oEmbed (and YouTube's full description). */
export function fromPageMeta(platform: SocialPlatform, meta: { title?: string | null; description?: string | null; image?: string | null }, html?: string): PostText {
  const title = unescapeHtml(str(meta.title));
  const description = unescapeHtml(str(meta.description));
  const thumbnail = str(meta.image) || null;
  let caption = description || title;
  let handle: string | null = null;
  let authorUrl: string | null = null;
  switch (platform) {
    case 'instagram': {
      // og:description: `123 likes, 4 comments - handle on May 1, 2025: "caption"`
      const d = /^[\d,.\s]*[KMk]?\s*likes?,\s*[\d,.\s]*[KMk]?\s*comments?\s*-\s*([A-Za-z0-9._]+)\s+on\s+[^:]+:\s*/.exec(description);
      if (d) handle = d[1];
      const fromDescription = quotedCaption(description);
      const fromTitle = quotedCaption(title);
      caption = fromDescription ?? fromTitle ?? description;
      if (!handle) {
        const t = /\(@([A-Za-z0-9._]+)\)/.exec(title) ?? /@([A-Za-z0-9._]+)/.exec(description);
        if (t) handle = t[1];
      }
      if (handle) authorUrl = `https://www.instagram.com/${handle}/`;
      break;
    }
    case 'youtube': {
      if (html) {
        const d = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html);
        if (d) caption = jsonString(d[1]);
        const h = /"ownerProfileUrl":"https?:\/\/(?:www\.)?youtube\.com\/@([^"/?]+)"/.exec(html) ?? /"canonicalBaseUrl":"\/@([^"/?]+)"/.exec(html);
        if (h) { handle = decodeURIComponent(h[1]); authorUrl = `https://www.youtube.com/@${handle}`; }
      }
      break;
    }
    case 'facebook':
    case 'pinterest':
    case 'tiktok':
      caption = description || title;
      break;
  }
  return { caption: caption.trim(), title, handle, author_url: authorUrl, thumbnail };
}

/** The page a pin was saved from: og:see_also, the page JSON's "link", or the outbound anchor. */
export function pinterestOutboundLink(html: string): string | null {
  const ok = (raw: string | undefined | null): string | null => {
    if (!raw) return null;
    const url = jsonString(unescapeHtml(raw));
    const u = hostOf(url);
    if (!u || isPinterestHost(u.host)) return null;
    return url;
  };
  const candidates = [
    /<meta[^>]+(?:property|name)=["']og:see_also["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1],
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:see_also["']/i.exec(html)?.[1],
    /"link":"(https?:[^"]+)"/.exec(html)?.[1],
    /<a[^>]+rel=["'][^"']*nofollow[^"']*["'][^>]*href=["'](https?:[^"']+)["']/i.exec(html)?.[1],
    /<a[^>]+href=["'](https?:[^"']+)["'][^>]*rel=["'][^"']*nofollow[^"']*["']/i.exec(html)?.[1],
  ];
  for (const c of candidates) {
    const link = ok(c);
    if (link) return link;
  }
  return null;
}

// ── Captions ───────────────────────────────────────────────────────────────

const SOCIAL_HOSTS = /(^|\.)(tiktok\.com|instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.watch|youtube\.com|youtu\.be|twitter\.com|x\.com|threads\.net|snapchat\.com|pinterest\.[a-z.]+|pin\.it)$/;
const LINK_IN_BIO = /(^|\.)(linktr\.ee|beacons\.ai|stan\.store|lnk\.bio|linkin\.bio|tap\.bio|campsite\.bio|solo\.to)$/;

const trimUrl = (u: string) => u.replace(/[)\].,;:!?'"”’>]+$/, '');

/** Recipe page links in a caption: http(s) URLs and "recipe: example.com/..." style bare links. Social and link-in-bio pages are left out. */
export function recipeLinks(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) found.push(trimUrl(m[0]));
  const bare = /\b(?:recipe|full recipe(?: is)?(?: at| on| here)?|link|get it at|at)\b\s*[:\-–]?\s*((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?)/gi;
  for (const m of text.matchAll(bare)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
    if (/https?:\/\/\S*$/.test(before)) continue;
    if (/^[a-z0-9-]+\.(?:jpg|png|gif)$/i.test(m[1])) continue;
    found.push(`https://${trimUrl(m[1])}`);
  }
  const out: string[] = [];
  for (const raw of found) {
    const u = hostOf(raw);
    if (!u || !u.host.includes('.')) continue;
    if (SOCIAL_HOSTS.test(u.host) || LINK_IN_BIO.test(u.host)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

const QUANTITY_LINE = /^\s*(?:[-•*▢✓✔·–]\s*)?(?:\d+(?:[.,/]\d+)?(?:\s+\d\/\d)?|[½¼¾⅓⅔⅛]|a\s+(?:pinch|handful|cup|few))\s*(?:[-–]\s*\d+\s*)?(?:cups?|tbsp|tbs|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|cloves?|cans?|pinch|handful|slices?|large|medium|small|whole|sticks?)?\b/i;
const BULLET_LINE = /^\s*[-•*▢✓✔·]\s*\S/;
const COOKING_VERBS = /\b(bake|baking|mix|stir|cook|add|heat|simmer|whisk|combine|preheat|fry|saute|sauté|boil|roast|chop|season|serve|blend|pour|marinate|grill|toss|fold)\b/gi;

/** Whether a caption holds a recipe (ingredients and a method), not just a dish name and hashtags. */
export function captionLooksLikeRecipe(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < 80) return false;
  const withoutTags = t.replace(/[#@][\p{L}\p{N}_.]+/gu, '').replace(/\s+/g, ' ').trim();
  if (withoutTags.length < 40) return false;
  const lines = t.split(/\r?\n|(?<=\S)\s+(?=[-•▢✓✔]\s)/).map(l => l.trim()).filter(Boolean);
  const quantityLines = lines.filter(l => QUANTITY_LINE.test(l) && /[a-z]{3,}/i.test(l)).length;
  const bulletLines = lines.filter(l => BULLET_LINE.test(l)).length;
  // Inline lists ("2 cups flour, 1 tsp salt, 3 eggs") count too.
  const inlineAmounts = (t.match(/\b\d+(?:[./]\d+)?\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|g|grams?|ml|lbs?|cloves?)\b/gi) ?? []).length;
  const ingredients = /\bingredients?\b/i.test(t) || quantityLines >= 3 || inlineAmounts >= 3 || (bulletLines >= 4 && quantityLines >= 2);
  if (!ingredients) return false;
  const numbered = lines.filter(l => /^\s*(?:step\s*)?\d+\s*[.):-]\s+\p{L}/iu.test(l)).length;
  const verbs = new Set((t.match(COOKING_VERBS) ?? []).map(v => v.toLowerCase())).size;
  return /\b(instructions|method|steps|directions|how to make)\b/i.test(t) || numbered >= 2 || verbs >= 2;
}
