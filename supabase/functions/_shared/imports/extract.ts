import { askJson } from '../claude.ts';
import { IMAGE_SYSTEM, RECIPE_SCHEMA, TEXT_SYSTEM, type ModelRecipe } from './modelDraft.ts';

// The model calls behind Smart import (Deno only). Which model reads what was chosen from
// measured results on the test set (docs/imports/accuracy.md); each can be changed with a
// secret without a deploy:
//   IMPORT_TEXT_MODEL        pages without structured data, captions, pasted text
//   IMPORT_PHOTO_MODEL       photos and screenshots: the first read
//   IMPORT_PHOTO_RETRY_MODEL a second, stronger read when the first finds the photos hard
//                            (handwriting, glare, blur), so only hard photos cost more

export const TEXT_MODEL = Deno.env.get('IMPORT_TEXT_MODEL') || 'claude-haiku-5-5';
export const PHOTO_MODEL = Deno.env.get('IMPORT_PHOTO_MODEL') || 'claude-haiku-5-5';
export const PHOTO_RETRY_MODEL = Deno.env.get('IMPORT_PHOTO_RETRY_MODEL') || 'claude-sonnet-5-5';

const MAX_TEXT = 24_000;

export interface Usage { model: string; input: number; output: number }

export async function readText(text: string, model = TEXT_MODEL): Promise<{ recipe: ModelRecipe; model: string; usage?: Usage }> {
  let usage: Usage | undefined;
  const recipe = await askJson<ModelRecipe>({
    system: TEXT_SYSTEM,
    content: `Copy the recipe from this text.\n\n<source>\n${text.slice(0, MAX_TEXT)}\n</source>`,
    schema: RECIPE_SCHEMA,
    maxTokens: 12_000,
    effort: 'low',
    model,
    label: 'import-text',
    onUsage: u => { usage = u; },
  });
  return { recipe, model, usage };
}

export interface Photo { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }

export async function readPhotos(photos: Photo[], model = PHOTO_MODEL, effort: 'low' | 'medium' = 'low'): Promise<{ recipe: ModelRecipe; model: string; usage?: Usage }> {
  let usage: Usage | undefined;
  const recipe = await askJson<ModelRecipe>({
    system: IMAGE_SYSTEM,
    content: [
      ...photos.flatMap((p, i) => [
        { type: 'text' as const, text: `Photo ${i + 1} of ${photos.length}:` },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mediaType, data: p.base64 } },
      ]),
      { type: 'text' as const, text: 'Copy the recipe from these photos.' },
    ],
    schema: RECIPE_SCHEMA,
    maxTokens: 16_000,
    effort,
    model,
    label: `import-photos x${photos.length}`,
    onUsage: u => { usage = u; },
  });
  return { recipe, model, usage };
}

/** Share of lines the model marked unsure: above this, the stronger model reads the photos again. */
export function unsureShare(r: ModelRecipe): number {
  const lines = [...(r.ingredients ?? []), ...(r.steps ?? [])];
  if (!lines.length) return 1;
  return lines.filter(l => l.unsure && l.unsure !== 'none' && l.unsure !== 'amount_missing').length / lines.length;
}
