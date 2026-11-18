import { AppError, claimRequest, serve, serviceClient, userClient } from '../_shared/http.ts';
import { canonicalUrl, type DraftSource, type SocialPlatform } from '../_shared/imports/draft.ts';
import { draftFromModel, draftUsable, flaggedFields } from '../_shared/imports/modelDraft.ts';
import { countsAsImport, host, importLink, importText, type ImportDeps, type ImportResult } from '../_shared/imports/pipeline.ts';
import { safeFetch, safeFetchBytes } from '../_shared/imports/safeFetch.ts';
import { detectPlatform } from '../_shared/imports/social.ts';
import { readPhotos, readText, type Photo } from '../_shared/imports/extract.ts';

// Import: a link, pasted text, or photos -> a draft recipe for the review screen. Nothing
// is saved here; the household saves from the review screen.
//   { kind: 'link', url, allowDuplicate? }     website or social post
//   { kind: 'text', text, source? }            pasted recipe or caption (source keeps a post's credit)
//   { kind: 'photos', paths: string[] }        up to 6 photos already uploaded to recipe-photos/<user>/imports/
// -> { status: 'ok' | 'partial', draft, message? }
//  | { status: 'duplicate', duplicate: { id, title } }      this link is already in the Library
//  | { status: 'no_recipe', message, source?, caption? }   nothing to import; the app offers other ways in
//  | { status: 'failed', message }
//  | { status: 'capped', message }                          today's imports are used up
//
// Every attempt counts toward a daily cap per user (claim_request, kind 'import'), so a bot
// can't run up the bill. Every successful import counts as a smart import (record_usage).
// Each outcome is logged in import_events: source type, result, method, site name, model and
// which fields were flagged. Never the recipe, the caption or the full URL.

const RATE_LIMIT = { kind: 'import', perMinute: 8, perDay: 50, noun: 'imports' };
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 20_000;
const PLATFORMS: SocialPlatform[] = ['tiktok', 'instagram', 'youtube', 'pinterest', 'facebook'];

const resolve = async (hostname: string): Promise<string[]> => [
  ...(await Deno.resolveDns(hostname, 'A').catch(() => [] as string[])),
  ...(await Deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[])),
];

const deps: ImportDeps = {
  fetchPage: url => safeFetch(url, { resolve, fetch }),
  readText: text => readText(text),
};

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const mediaTypeOf = (path: string, type: string): Photo['mediaType'] =>
  /png/.test(type) || /\.png$/i.test(path) ? 'image/png' : /webp/.test(type) || /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';

/** A copy of a post's cover in the household's private folder, as a photo reference. The web link if that fails. */
async function keepCover(url: string, userId: string, db: ReturnType<typeof userClient>): Promise<string> {
  try {
    const { bytes, contentType } = await safeFetchBytes(url, { resolve, fetch, maxBytes: 6_000_000 });
    if (!/^image\/(jpeg|png|webp)/.test(contentType)) return url;
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const path = `${userId}/imports/cover-${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from('recipe-photos').upload(path, bytes, { contentType: contentType.split(';')[0], upsert: false });
    return error ? url : `storage:recipe-photos/${path}`;
  } catch {
    return url;
  }
}

serve(async (body, req) => {
  const started = Date.now();
  const db = userClient(req);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  const user = auth.user;
  if (!user) throw new AppError('Sign in again to continue.', 401);

  const kind = body.kind === 'link' || body.kind === 'text' || body.kind === 'photos' ? body.kind : null;
  if (!kind) throw new AppError('Nothing to import.', 400);

  const admin = serviceClient();
  const sourceKind = kind === 'photos' ? 'photo' : kind === 'text' ? 'text' : null;
  const log = async (e: { source_kind: string; outcome: string; method?: string | null; error_code?: string | null; site?: string | null; platform?: string | null; model?: string | null; image_count?: number; flagged_fields?: string[] }) => {
    const { error } = await admin.from('import_events').insert({ user_id: user.id, duration_ms: Date.now() - started, ...e });
    if (error) console.error('[import] log failed:', error.message);
  };

  // ── What was sent ──
  let url: string | null = null;
  /** The link as pasted (fetched as is); `url` is its canonical form, for duplicates and storage. */
  let pasted: string | null = null;
  let text = '';
  let paths: string[] = [];
  let textSource: DraftSource | undefined;
  if (kind === 'link') {
    const raw = typeof body.url === 'string' ? body.url.trim().slice(0, 2048) : '';
    url = canonicalUrl(raw);
    pasted = url ? new URL(raw).toString() : null;
    if (!url || !pasted) {
      await log({ source_kind: 'website', outcome: 'failed', error_code: 'bad_url' });
      return { status: 'failed', message: "That doesn't look like a link. Check it and try again." };
    }
  } else if (kind === 'text') {
    text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
    if (text.length < 20) return { status: 'failed', message: 'Paste the whole recipe: the ingredients and the steps.' };
    const s = (body.source ?? null) as Record<string, unknown> | null;
    const postUrl = canonicalUrl(typeof s?.url === 'string' ? s.url : '');
    const platform = PLATFORMS.find(p => p === s?.platform) ?? (postUrl ? detectPlatform(postUrl) : null);
    if (postUrl && platform) {
      const handle = typeof s?.handle === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(s.handle) ? s.handle : null;
      textSource = { kind: 'social', url: postUrl, site_name: null, platform, handle };
    }
  } else {
    paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === 'string') : [];
    if (!paths.length || paths.length > MAX_PHOTOS || paths.some(p => !p.startsWith(`${user.id}/imports/`) || p.includes('..'))) {
      throw new AppError(`Add between 1 and ${MAX_PHOTOS} photos.`, 400);
    }
  }
  const linkKind = url ? (detectPlatform(url) ? 'social' : 'website') : null;
  const logKind = linkKind ?? sourceKind!;

  // ── Already in the Library? (before the cap: checking costs nothing) ──
  const findSaved = async (sourceUrl: string | null) => {
    if (!sourceUrl) return null;
    const { data } = await db.from('recipes').select('id, name, display_name').eq('owner_id', user.id).eq('source_url', sourceUrl).limit(1);
    const row = (data ?? [])[0];
    return row ? { id: row.id as number, title: (row.display_name as string) || (row.name as string) } : null;
  };
  // The household can import a link again on purpose ("Import again anyway").
  const saved = body.allowDuplicate === true ? null : await findSaved(url);
  if (saved) {
    await log({ source_kind: logKind, outcome: 'duplicate', site: host(url) });
    return { status: 'duplicate', duplicate: saved };
  }

  // ── Today's cap ──
  try {
    await claimRequest(db, RATE_LIMIT);
  } catch (err) {
    if (err instanceof AppError && err.status === 429) {
      await log({ source_kind: logKind, outcome: 'capped', site: host(url) });
      const hours = err.retryAfter && err.retryAfter > 60 ? Math.ceil(err.retryAfter / 3600) : null;
      return {
        status: 'capped',
        message: hours
          ? `That's today's ${RATE_LIMIT.perDay} imports. You can import more in about ${hours} hour${hours === 1 ? '' : 's'}. You can still add a recipe by hand.`
          : 'Lots of imports at once. Wait a minute, then try again.',
      };
    }
    throw err;
  }

  // ── Import ──
  let result: ImportResult;
  let model: string | null = null;
  try {
    if (kind === 'link') {
      result = await importLink(pasted!, deps);
    } else if (kind === 'text') {
      result = await importText(text, deps, textSource);
    } else {
      const photos: Photo[] = [];
      for (const path of paths) {
        const { data, error } = await db.storage.from('recipe-photos').download(path);
        if (error || !data) throw new AppError("Couldn't open one of the photos. Add it again and try once more.", 400);
        if (data.size > MAX_PHOTO_BYTES) throw new AppError('One of the photos is too large. Try a smaller one.', 413);
        photos.push({ base64: toBase64(new Uint8Array(await data.arrayBuffer())), mediaType: mediaTypeOf(path, data.type) });
      }
      // One read by the photo model; what it couldn't read is flagged for the household to check.
      const read = await readPhotos(photos);
      model = read.model;
      const draft = draftFromModel(read.recipe, { kind: 'photo', url: null, site_name: null, platform: null, handle: null });
      result = read.recipe.is_recipe && draftUsable(draft)
        ? { status: 'ok', draft, method: 'model', site: null, model }
        : read.recipe.is_recipe && (draft.ingredients.length || draft.steps.length)
          ? { status: 'partial', draft, method: 'model', site: null, model, message: draft.steps.length ? 'Got the steps, but not the ingredients. Add them below, or try a clearer photo.' : 'Got the ingredients, but not the steps. Add them below, or add a photo of the method.' }
          : { status: 'no_recipe', method: 'model', site: null, model, message: "Couldn't read a recipe in that photo. Try again in good light, with the whole page in the frame and the text in focus." };
    }
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Something went wrong. Try again.';
    await log({ source_kind: logKind, outcome: 'failed', error_code: err instanceof AppError ? `app_${err.status}` : 'error', site: host(url), image_count: paths.length || undefined });
    if (!(err instanceof AppError)) console.error('[import] failed:', err);
    return { status: 'failed', message };
  }
  model = model ?? ('model' in result ? result.model ?? null : null);
  const platform = url ? detectPlatform(url) : textSource?.platform ?? null;

  if (result.status === 'ok' || result.status === 'partial') {
    // Social covers are signed links that stop working after a while: keep a private copy.
    if (result.draft.source.kind === 'social' && result.draft.image_url?.startsWith('http')) {
      result.draft.image_url = await keepCover(result.draft.image_url, user.id, db);
    }
    // The page the link led to may be one the household already saved under its own address.
    const duplicate = result.draft.source.url !== url && body.allowDuplicate !== true ? await findSaved(result.draft.source.url) : null;
    if (countsAsImport(result.status)) {
      const { error } = await db.rpc('record_usage', { p_kind: 'smart_imports' });
      if (error) console.error('[import] usage not counted:', error.message);
    }
    await log({
      source_kind: logKind, outcome: result.status === 'ok' ? 'success' : 'partial', method: result.method, site: result.site ?? host(url), platform,
      model, image_count: paths.length || undefined, flagged_fields: flaggedFields(result.draft.flags),
    });
    return { status: result.status, draft: result.draft, message: result.message ?? null, duplicate };
  }
  if (result.status === 'no_recipe') {
    await log({ source_kind: logKind, outcome: 'no_recipe', method: result.method ?? null, site: result.site ?? host(url), platform, model, image_count: paths.length || undefined });
    return { status: 'no_recipe', message: result.message, source: result.source ?? null, caption: result.caption ?? null };
  }
  await log({ source_kind: logKind, outcome: 'failed', error_code: 'code' in result ? result.code : 'failed', site: result.site ?? host(url), platform });
  return { status: 'failed', message: result.message };
});
