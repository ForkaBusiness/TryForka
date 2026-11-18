import type { Screen } from '../app/AppContext';

// Pure helpers for what's shared or pasted into Forka (tested in tests/shareRoute.test.ts).

export const MAX_IMPORT_PHOTOS = 6;

export interface IncomingShare { title?: string; text?: string; url?: string; files?: File[] }

/** The first http(s) link in some text: what a share sheet or the clipboard usually holds. */
export function findLink(text: string | null | undefined): string | null {
  const m = (text ?? '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,;!?]+$/, '') : null;
}

/**
 * The one entry for anything shared into Forka (Android share target today, an iOS share
 * extension later): which screen opens with it. Photos are imported as photos, a link
 * (in the URL field or anywhere in the text) as a link, other text as recipe text. Null
 * when there's nothing to import.
 */
export function handleIncomingShare(share: IncomingShare): Screen | null {
  const files = (share.files ?? []).filter(f => f.size > 0 && (/^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name))).slice(0, MAX_IMPORT_PHOTOS);
  if (files.length) return { name: 'import', files };
  const url = findLink(share.url) ?? findLink(share.text) ?? findLink(share.title);
  if (url) return { name: 'import', url };
  const text = [share.title, share.text].filter(Boolean).join('\n').trim();
  return text.length >= 20 ? { name: 'import', text } : null;
}
