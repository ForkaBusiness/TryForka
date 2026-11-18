import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// The household's own photos (a dish photo for a recipe, pages and screenshots sent to
// import) live in the private recipe-photos bucket, in a folder named by the user's id;
// row level security lets each household read and write only its own folder. A recipe
// stores a reference ("storage:recipe-photos/<user>/<file>.jpg"), and screens show it
// through a signed URL that expires, never a public link.

export const PHOTO_BUCKET = 'recipe-photos';
const PREFIX = `storage:${PHOTO_BUCKET}/`;
const SIGNED_FOR_SECONDS = 60 * 60;

export const isPhotoRef = (src: string | null | undefined): src is string => !!src && src.startsWith(PREFIX);
export const photoPath = (ref: string) => ref.slice(PREFIX.length);
export const photoRef = (path: string) => `${PREFIX}${path}`;

/** Uploads a JPEG into the household's folder. Returns the storage path (for import) and the reference (for a recipe). */
export async function uploadPhoto(userId: string, blob: Blob, folder: 'dishes' | 'imports'): Promise<{ path: string; ref: string }> {
  const path = `${userId}/${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return { path, ref: photoRef(path) };
}

export async function removePhotos(refsOrPaths: string[]): Promise<void> {
  const paths = refsOrPaths.map(p => (isPhotoRef(p) ? photoPath(p) : p)).filter(Boolean);
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}

// Signed URLs, cached until shortly before they expire and asked for in batches: a
// library grid of household recipes is one request, not one per card.
const cache = new Map<string, { url: string; until: number }>();
let pending: Map<string, Array<(url: string) => void>> | null = null;

function flush() {
  const batch = pending!;
  pending = null;
  const paths = [...batch.keys()];
  supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_FOR_SECONDS).then(({ data }) => {
    const until = Date.now() + (SIGNED_FOR_SECONDS - 300) * 1000;
    const found = new Map((data ?? []).filter(d => d.signedUrl && d.path).map(d => [d.path!, d.signedUrl]));
    for (const [path, waiting] of batch) {
      const url = found.get(path) ?? '';
      if (url) cache.set(path, { url, until });
      for (const done of waiting) done(url);
    }
  }, () => { for (const waiting of batch.values()) for (const done of waiting) done(''); });
}

/** A signed URL for a stored photo ('' when it can't be read). */
export function signedPhotoUrl(ref: string): Promise<string> {
  const path = photoPath(ref);
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise(resolve => {
    if (!pending) { pending = new Map(); setTimeout(flush, 0); }
    pending.set(path, [...(pending.get(path) ?? []), resolve]);
  });
}

/** What an <img> can show for a recipe photo: web URLs as they are, stored photos through a signed URL. */
export function usePhotoSrc(src: string | null | undefined): string {
  const stored = isPhotoRef(src);
  const cached = stored ? cache.get(photoPath(src)) : undefined;
  const [signed, setSigned] = useState<{ ref: string; url: string } | null>(null);
  useEffect(() => {
    if (!stored || (cached && cached.until > Date.now())) return;
    let cancelled = false;
    signedPhotoUrl(src).then(url => { if (!cancelled) setSigned({ ref: src, url }); });
    return () => { cancelled = true; };
  }, [src, stored, cached]);
  if (!src) return '';
  if (!stored) return src;
  if (cached && cached.until > Date.now()) return cached.url;
  return signed?.ref === src ? signed.url : '';
}
