// Import from a link or from text: what happens between "the household pasted something"
// and "here is a draft to check". Pure TypeScript with the network and the model passed in,
// so the edge function runs it with safeFetch and Claude, and Node runs it against real
// recipe sites (tests/importSites) or fakes (tests).
//
//   website  fetch the page safely -> schema.org Recipe JSON-LD -> draft
//            no usable JSON-LD -> the page's text to the model -> draft
//   social   public post text only (oEmbed or page metadata; never the video)
//            caption has a recipe -> the model reads the caption
//            caption links to a recipe page -> that page, through the website path
//            neither -> no_recipe, and the household is offered: paste the caption, or add screenshots
//   text     pasted text -> the model -> draft

import { canonicalUrl, emptyDraft, type DraftFlag, type DraftSource, type ImportDraft, type SocialPlatform } from './draft.ts';
import { parseIngredientLine } from './ingredientLine.ts';
import { pageText, parseRecipePage, type ParsedRecipe } from './jsonld.ts';
import { draftFromModel, draftUsable, flaggedFields, type ModelRecipe } from './modelDraft.ts';
import { FetchBlocked } from './safeFetch.ts';
import { captionLooksLikeRecipe, detectPlatform, fromOembed, fromPageMeta, oembedUrl, pinterestOutboundLink, platformName, recipeLinks, type PostText } from './social.ts';

export interface ImportDeps {
  /** Fetches a page through safeFetch (private addresses, redirects, size and time limits). */
  fetchPage(url: string): Promise<{ url: string; body: string; contentType: string }>;
  /** Asks the model to copy a recipe out of text. Absent: no model fallback. */
  readText?(text: string): Promise<{ recipe: ModelRecipe; model: string }>;
}

export type Method = 'json_ld' | 'model' | 'caption' | 'caption_link' | 'pinterest_link' | 'text';

export type ImportResult =
  | { status: 'ok' | 'partial'; draft: ImportDraft; method: Method; site: string | null; model?: string; message?: string }
  | { status: 'no_recipe'; method?: Method; site: string | null; message: string; source?: DraftSource; caption?: string; model?: string }
  | { status: 'failed'; code: string; site: string | null; message: string };

export const host = (url: string | null | undefined) => { try { return new URL(url!).hostname.replace(/^www\./, ''); } catch { return null; } };

const FAILED: Record<string, string> = {
  bad_url: "That doesn't look like a link. Check it and try again.",
  blocked: "That link can't be opened from Forka.",
  too_many_redirects: "That link keeps redirecting, so it couldn't be opened.",
  too_large: 'That page is too large to read.',
  timeout: 'That page took too long to answer. Try again in a moment.',
  not_html: "That link isn't a recipe page. Try the link to the recipe itself.",
  not_found: "That page couldn't be found. Check the link and try again.",
  refused: "That site didn't let Forka read the page. Try again later, or add the recipe with screenshots.",
  unreachable: "Couldn't reach that site. Check the link and try again.",
};

/** A fetch error as a result the household can act on. */
export function fetchFailure(err: unknown, url: string): ImportResult {
  const site = host(url);
  if (err instanceof FetchBlocked) {
    const code = err.code === 'http_error' ? (err.status === 404 || err.status === 410 ? 'not_found' : 'refused') : err.code;
    return { status: 'failed', code: err.code === 'http_error' ? `http_${err.status}` : err.code, site, message: FAILED[code] ?? FAILED.unreachable };
  }
  return { status: 'failed', code: 'unreachable', site, message: FAILED.unreachable };
}

/** "The Best Chewy Cookies Recipe by Tasty" -> "The Best Chewy Cookies". */
export const cleanTitle = (t: string) => t.replace(/\s*[|:–—-]?\s*recipe(?:\s+(?:by|from)\s+.+)?$/i, '').trim() || t.trim();

/** The draft a page's JSON-LD gives. Lines without an item are flagged; nothing is invented. */
export function draftFromJsonLd(r: ParsedRecipe, source: DraftSource, image: string | null): ImportDraft {
  const draft = emptyDraft(source.kind);
  draft.source = source;
  draft.title = cleanTitle(r.title);
  draft.servings = r.servings;
  draft.prep_minutes = r.prep_minutes;
  draft.cook_minutes = r.cook_minutes;
  draft.total_minutes = r.total_minutes;
  draft.ingredients = r.ingredientLines.map(parseIngredientLine).filter(i => i.item || i.quantity !== null);
  draft.steps = r.steps;
  draft.image_url = image;
  const flags: DraftFlag[] = [];
  if (!draft.title) flags.push({ field: 'title', reason: 'Add a name.' });
  draft.ingredients.forEach((ing, index) => { if (!ing.item) flags.push({ field: 'ingredients', index, part: 'item', reason: 'Check this line.' }); });
  draft.flags = flags;
  return draft;
}

/** "Got the ingredients, but not the steps." for a draft that's missing a part. */
function partialMessage(d: ImportDraft): string {
  if (!d.steps.length) return 'Got the ingredients, but not the steps. Add them below, or check the original.';
  return 'Got the steps, but not the ingredients. Add them below, or check the original.';
}

const hasSomething = (d: ImportDraft) => d.ingredients.length > 0 || d.steps.length > 0;

/** A recipe web page. `source` overrides the credit (a social post that linked here). */
export async function importWebsite(url: string, deps: ImportDeps, source?: DraftSource): Promise<ImportResult> {
  let page;
  try { page = await deps.fetchPage(url); } catch (err) { return fetchFailure(err, url); }
  const site = host(page.url);
  if (!/html|xml/i.test(page.contentType)) return { status: 'failed', code: 'not_html', site, message: FAILED.not_html };
  const parsed = parseRecipePage(page.body, page.url);
  const canonical = canonicalUrl(sameSite(parsed.meta.canonical, page.url) ? parsed.meta.canonical : page.url);
  const siteName = parsed.recipe?.site_name || parsed.meta.site_name || site;
  const credit: DraftSource = source ?? { kind: 'website', url: canonical, site_name: siteName, platform: null, handle: null };
  const image = absolute(parsed.recipe?.image_url || parsed.meta.image, page.url);

  if (parsed.recipe && parsed.usable) {
    return { status: 'ok', draft: withLinkNote(draftFromJsonLd(parsed.recipe, credit, image), source, canonical, siteName), method: 'json_ld', site };
  }
  if (deps.readText) {
    const text = pageText(page.body);
    if (text.length >= 200) {
      const { recipe, model } = await deps.readText(`Page title: ${parsed.meta.title ?? ''}\n\n${text}`);
      const draft = withLinkNote(draftFromModel(recipe, credit, { sourceText: text, image_url: image }), source, canonical, siteName);
      if (recipe.is_recipe && draftUsable(draft)) return { status: 'ok', draft, method: 'model', site, model };
      if (recipe.is_recipe && hasSomething(draft)) return { status: 'partial', draft, method: 'model', site, model, message: partialMessage(draft) };
      return noRecipe(site, 'model', model);
    }
  }
  // Structured data with only part of a recipe still beats nothing.
  if (parsed.recipe && (parsed.recipe.ingredientLines.length || parsed.recipe.steps.length)) {
    const draft = withLinkNote(draftFromJsonLd(parsed.recipe, credit, image), source, canonical, siteName);
    return { status: 'partial', draft, method: 'json_ld', site, message: partialMessage(draft) };
  }
  return noRecipe(site, 'json_ld');
}

const noRecipe = (site: string | null, method: Method, model?: string): ImportResult =>
  ({ status: 'no_recipe', method, site, model, message: "There's no recipe on that page. Try the link to the recipe itself, or add screenshots." });

function sameSite(a: string | null, b: string): boolean {
  const ha = host(a); const hb = host(b);
  return !!ha && !!hb && (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`));
}

function absolute(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  try { const u = new URL(url, base); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}

/** A recipe reached through a social post keeps the creator's credit; the page it came from goes in the notes. */
function withLinkNote(draft: ImportDraft, viaPost: DraftSource | undefined, pageUrl: string | null, siteName: string | null): ImportDraft {
  if (!viaPost || !pageUrl) return draft;
  return { ...draft, notes: [draft.notes, `Full recipe${siteName ? ` on ${siteName}` : ''}: ${pageUrl}`].filter(Boolean).join('\n\n') };
}

/** A social post's public text: oEmbed where the platform offers it, else the page's metadata. */
export async function postText(platform: SocialPlatform, url: string, deps: ImportDeps): Promise<{ post: PostText; html: string | null; finalUrl: string }> {
  let post: PostText = { caption: '', title: '', handle: null, author_url: null, thumbnail: null };
  let html: string | null = null;
  let finalUrl = url;
  const oembed = oembedUrl(platform, url);
  if (oembed) {
    try {
      const res = await deps.fetchPage(oembed);
      post = fromOembed(platform, JSON.parse(res.body) as Record<string, unknown>);
    } catch { /* fall back to the page */ }
  }
  // YouTube's oEmbed has no description and Pinterest's no outbound link: read the page too.
  if (!post.caption || platform === 'youtube' || platform === 'pinterest') {
    try {
      const page = await deps.fetchPage(url);
      html = page.body;
      finalUrl = page.url;
      const parsed = parseRecipePage(page.body, page.url);
      const fromPage = fromPageMeta(platform, parsed.meta, page.body);
      post = {
        caption: fromPage.caption.length > post.caption.length ? fromPage.caption : post.caption,
        title: post.title || fromPage.title,
        handle: post.handle || fromPage.handle,
        author_url: post.author_url || fromPage.author_url,
        thumbnail: post.thumbnail || fromPage.thumbnail,
      };
    } catch { /* what oEmbed gave, if anything */ }
  }
  return { post, html, finalUrl };
}

export const NO_CAPTION_RECIPE = "This post's caption doesn't include the recipe. Paste the recipe text if you have it, or add screenshots of it.";

/** A TikTok, Instagram, YouTube, Pinterest or Facebook post: its text and links only. */
export async function importSocial(platform: SocialPlatform, url: string, deps: ImportDeps): Promise<ImportResult> {
  const site = platformName(platform);
  const { post, html, finalUrl } = await postText(platform, url, deps);
  // A short link (vm.tiktok.com, pin.it) is credited and remembered as the post it opens.
  const postUrl = canonicalUrl(detectPlatform(finalUrl) === platform ? finalUrl : url);
  const source: DraftSource = { kind: 'social', url: postUrl, site_name: site, platform, handle: post.handle };
  const caption = [post.title !== post.caption ? post.title : '', post.caption].filter(Boolean).join('\n\n').trim();

  if (caption && captionLooksLikeRecipe(caption) && deps.readText) {
    const { recipe, model } = await deps.readText(caption);
    const draft = draftFromModel(recipe, source, { sourceText: caption, image_url: post.thumbnail });
    if (recipe.is_recipe && draftUsable(draft)) return { status: 'ok', draft, method: 'caption', site, model };
    if (recipe.is_recipe && hasSomething(draft)) return { status: 'partial', draft, method: 'caption', site, model, message: partialMessage(draft) };
  }
  // A link to the recipe: Pinterest pins point at the page they were saved from; creators link in the caption.
  const links = [...(platform === 'pinterest' && html ? [pinterestOutboundLink(html)] : []), ...recipeLinks(caption)].filter((l): l is string => !!l && !detectPlatform(l));
  for (const link of [...new Set(links)].slice(0, 2)) {
    const result = await importWebsite(link, deps, source);
    if (result.status === 'ok' || result.status === 'partial') {
      if (!result.draft.image_url && post.thumbnail) result.draft.image_url = post.thumbnail;
      return { ...result, method: platform === 'pinterest' ? 'pinterest_link' : 'caption_link', site };
    }
  }
  return { status: 'no_recipe', method: 'caption', site, source, caption, message: NO_CAPTION_RECIPE };
}

/** Text the household pasted (a caption, an email, a note). `source` keeps a post's credit when it came from one. */
export async function importText(text: string, deps: ImportDeps, source?: DraftSource): Promise<ImportResult> {
  const credit: DraftSource = source ?? { kind: 'manual', url: null, site_name: null, platform: null, handle: null };
  if (!deps.readText) return { status: 'failed', code: 'no_model', site: null, message: 'Smart import is unavailable right now. Try again in a minute.' };
  const { recipe, model } = await deps.readText(text);
  const draft = draftFromModel(recipe, credit, { sourceText: text });
  if (recipe.is_recipe && draftUsable(draft)) return { status: 'ok', draft, method: 'text', site: credit.site_name ?? null, model };
  if (recipe.is_recipe && hasSomething(draft)) return { status: 'partial', draft, method: 'text', site: credit.site_name ?? null, model, message: partialMessage(draft) };
  return { status: 'no_recipe', method: 'text', site: null, model, message: "That text doesn't have a recipe in it. Check you copied the ingredients and steps." };
}

/** One entry for links: social posts go the social way, everything else is a web page. */
export function importLink(url: string, deps: ImportDeps): Promise<ImportResult> {
  const platform = detectPlatform(url);
  return platform ? importSocial(platform, url, deps) : importWebsite(url, deps);
}

export { flaggedFields };
