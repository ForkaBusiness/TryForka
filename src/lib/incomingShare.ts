import type { IncomingShare } from './shareRoute';
export { handleIncomingShare, type IncomingShare } from './shareRoute';

// Recipes shared into Forka from other apps. Every way in ends at handleIncomingShare():
//   Android, installed app   the manifest's share_target posts to /app/share-target; the
//                            service worker (public/share-sw.js) keeps what was shared and
//                            opens /app/?share=<id>; readPendingShare() picks it up.
//   iOS (later)              a native share extension can open /app/?share=... the same way,
//                            or call handleIncomingShare() with what it received.
// What's shared becomes the import screen, already started: photos are imported as photos,
// a link (in the URL or anywhere in the text) as a link, other text as recipe text.

const SHARE_CACHE = 'forka-share-v1';
const PENDING_KEY = 'forka_pending_share';

/**
 * Called once at startup: a share the service worker received is noted before anything
 * else, so it survives a trip to the log-in page. The id is taken out of the address bar.
 */
export function notePendingShare(): void {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('share');
  if (!id) return;
  try { localStorage.setItem(PENDING_KEY, id); } catch { /* read straight from the address below */ }
  params.delete('share');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  (window as unknown as { __forkaShare?: string }).__forkaShare = id;
}

/** What was shared, if a share is waiting. Read once: it's cleared as it's read. */
export async function readPendingShare(): Promise<IncomingShare | 'failed' | null> {
  let id: string | null = null;
  try { id = localStorage.getItem(PENDING_KEY); localStorage.removeItem(PENDING_KEY); } catch { /* fall back below */ }
  id ??= (window as unknown as { __forkaShare?: string }).__forkaShare ?? null;
  if (!id) return null;
  if (id === 'failed') return 'failed';
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(`/share/${id}/meta`);
    if (!metaRes) return null;
    const meta = await metaRes.json() as { title: string; text: string; url: string; files: Array<{ key: string; name: string; type: string }> };
    const files: File[] = [];
    for (const f of meta.files) {
      const res = await cache.match(f.key);
      if (res) files.push(new File([await res.blob()], f.name, { type: f.type }));
      await cache.delete(f.key);
    }
    await cache.delete(`/share/${id}/meta`);
    return { title: meta.title, text: meta.text, url: meta.url, files };
  } catch {
    return 'failed';
  }
}

/** Registers the share worker (only what share_target needs; it caches nothing else). */
export function registerShareWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}share-sw.js`, { scope: import.meta.env.BASE_URL }).catch(err => console.error('[share] worker not registered:', err));
}
