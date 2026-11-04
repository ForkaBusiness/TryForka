import { callFunction } from './plan';
import { recheckRecipes, type RecipeCard } from './catalog';
import type { FoodPrefs } from './recipeFilter';

// Photo prep for "Find meals like this": decode (converting HEIC when the browser
// can't), shrink to 1024px on the long edge, re-encode as JPEG ~0.8.

export const MAX_BYTES = 15 * 1024 * 1024;
const LONG_EDGE = 1024;
const ACCEPTED = /^image\/(jpeg|png|webp|heic|heif|gif)$/i;
const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

export class PhotoError extends Error {}

export function checkFile(file: File): void {
  if (!ACCEPTED.test(file.type) && !isHeic(file)) throw new PhotoError('Choose a JPEG, PNG, WebP or HEIC photo.');
  if (file.size > MAX_BYTES) throw new PhotoError('That photo is over 15 MB. Choose a smaller one.');
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File -> resized JPEG (data URL for the preview, base64 for the request). */
export async function preparePhoto(file: File): Promise<{ dataUrl: string; base64: string }> {
  checkFile(file);
  let source: Blob = file;
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decode(source);
  } catch {
    if (!isHeic(file)) throw new PhotoError("Couldn't open that photo. Try a different one.");
    // Chrome and Firefox can't read iPhone HEIC photos; convert them first.
    try {
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      source = Array.isArray(converted) ? converted[0] : converted;
      bitmap = await decode(source);
    } catch {
      throw new PhotoError("Couldn't open that HEIC photo here. Take a screenshot of it, or save it as JPEG, and try again.");
    }
  }
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, LONG_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError("Couldn't process that photo. Try a different one.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export async function findSimilar(base64: string, context: string, prefs: FoodPrefs): Promise<{ dish_name: string; recipes: RecipeCard[] }> {
  const { dish_name, recipes } = await callFunction<{ dish_name: string; recipes: RecipeCard[] }>('analyze-dish', { image: base64, mediaType: 'image/jpeg', context });
  return { dish_name, recipes: await recheckRecipes(recipes.map(r => r.id), prefs) };
}
