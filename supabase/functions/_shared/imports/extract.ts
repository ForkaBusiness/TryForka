import { askJson } from '../claude.ts';
import { IMAGE_SYSTEM, RECIPE_SCHEMA, TEXT_SYSTEM, type ModelRecipe } from './modelDraft.ts';

// The model calls behind Smart import (Deno only). Photos and text are both read by
// Claude Haiku 5.5: on the photo test set (docs/imports/photo-eval.md) it read as well as
// Sonnet 5.5 at about 1/18 of the cost. What it can't read with confidence is flagged on
// the review screen; nothing is filled in. Each can be changed with a secret, no deploy:
//   IMPORT_TEXT_MODEL    pages without structured data, captions, pasted text
//   IMPORT_PHOTO_MODEL   photos and screenshots

export const TEXT_MODEL = Deno.env.get('IMPORT_TEXT_MODEL') || 'claude-haiku-5-5';
export const PHOTO_MODEL = Deno.env.get('IMPORT_PHOTO_MODEL') || 'claude-haiku-5-5';

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

/**
 * Reads the recipe in the photos. When they show more than one recipe, `pick` names the one
 * the household chose (from the first read's recipes_seen); the others are left out.
 */
export async function readPhotos(photos: Photo[], model = PHOTO_MODEL, pick?: string): Promise<{ recipe: ModelRecipe; model: string; usage?: Usage }> {
  let usage: Usage | undefined;
  const recipe = await askJson<ModelRecipe>({
    system: IMAGE_SYSTEM,
    content: [
      ...photos.flatMap((p, i) => [
        { type: 'text' as const, text: `Photo ${i + 1} of ${photos.length}:` },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mediaType, data: p.base64 } },
      ]),
      { type: 'text' as const, text: pick ? `Copy only the recipe titled "${pick.replace(/"/g, "'")}". Leave out any other recipe in the photos.` : 'Copy the recipe from these photos.' },
    ],
    schema: RECIPE_SCHEMA,
    maxTokens: 16_000,
    effort: 'low',
    model,
    label: `import-photos x${photos.length}`,
    onUsage: u => { usage = u; },
  });
  return { recipe, model, usage };
}
