import { callFunction } from './plan';
import { IMPORT_PHOTO, PhotoError, preparePhoto } from './photo';
import { uploadPhoto } from './recipePhotos';
import type { DraftSource, ImportDraft } from '../../supabase/functions/_shared/imports/draft.ts';

// Import from the app's side: links, pasted text and photos go to the import-recipe
// function, which answers with a draft to check (or why there isn't one). Nothing is saved
// until the household saves from the review screen.

import { MAX_IMPORT_PHOTOS } from './shareRoute';
export { findLink, MAX_IMPORT_PHOTOS } from './shareRoute';

export type ImportAnswer =
  | { status: 'ok' | 'partial'; draft: ImportDraft; message: string | null; duplicate: { id: number; title: string } | null }
  | { status: 'duplicate'; duplicate: { id: number; title: string } }
  | { status: 'no_recipe'; message: string; source: DraftSource | null; caption: string | null }
  | { status: 'failed'; message: string }
  | { status: 'capped'; message: string }
  /** Free's smart imports are used up (everything imported stays). */
  | { status: 'limit'; message: string }
  /** The photos show several recipes: the household picks one (importPickedRecipe). */
  | { status: 'choose'; recipes: Array<{ title: string; has_method: boolean }>; paths: string[] };

async function ask(body: Record<string, unknown>): Promise<ImportAnswer> {
  try {
    return await callFunction<ImportAnswer>('import-recipe', body);
  } catch (err) {
    return { status: 'failed', message: err instanceof Error ? err.message : 'Something went wrong. Try again.' };
  }
}

/** A link: a recipe page, or a TikTok, Instagram, YouTube, Pinterest or Facebook post. */
export const importFromLink = (url: string, opts: { allowDuplicate?: boolean } = {}) => ask({ kind: 'link', url: url.trim(), allowDuplicate: !!opts.allowDuplicate });

/** Pasted text. `source` keeps the credit of the post it came from. */
export const importFromText = (text: string, source?: DraftSource | null) => ask({ kind: 'text', text, source: source ?? undefined });

export type PhotoStep = { step: 'preparing'; done: number; total: number } | { step: 'uploading'; done: number; total: number } | { step: 'reading' };

/**
 * Photos of one recipe (pages, screenshots, a handwritten card): shrunk on the device
 * (HEIC converted), uploaded to the household's private folder, then read. `onStep`
 * reports each real step, for honest progress.
 */
export async function importFromPhotos(userId: string, files: File[], onStep: (s: PhotoStep) => void): Promise<ImportAnswer> {
  if (!files.length) return { status: 'failed', message: 'Add a photo of the recipe.' };
  if (files.length > MAX_IMPORT_PHOTOS) return { status: 'failed', message: `Add up to ${MAX_IMPORT_PHOTOS} photos for one recipe.` };
  const blobs: Blob[] = [];
  try {
    for (const [i, file] of files.entries()) {
      onStep({ step: 'preparing', done: i, total: files.length });
      blobs.push((await preparePhoto(file, IMPORT_PHOTO)).blob);
    }
  } catch (err) {
    return { status: 'failed', message: err instanceof PhotoError ? err.message : "Couldn't open one of the photos. Try a different one." };
  }
  const paths: string[] = [];
  try {
    for (const [i, blob] of blobs.entries()) {
      onStep({ step: 'uploading', done: i, total: blobs.length });
      paths.push((await uploadPhoto(userId, blob, 'imports')).path);
    }
  } catch {
    return { status: 'failed', message: "Couldn't upload the photos. Check your connection and try again." };
  }
  onStep({ step: 'reading' });
  return ask({ kind: 'photos', paths });
}

/** The recipe the household picked from photos that show several: read again from the same uploads. */
export const importPickedRecipe = (paths: string[], title: string) => ask({ kind: 'photos', paths, pick: title });
