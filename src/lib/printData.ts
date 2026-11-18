// What a printed or PDF recipe shows, worked out once for both: title, servings and times,
// ingredients at the servings chosen and in the family's units, steps, notes and the source
// credit. Pure, so it's tested in tests/printData.test.ts.

import { formatMeasure, type UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';
import type { RecipeIngredient, RecipeStep } from '../../supabase/functions/_shared/catalog/derive.ts';
import type { SocialPlatform, SourceKind } from '../../supabase/functions/_shared/imports/draft.ts';

export interface PrintableRecipe {
  name: string;
  display_name?: string | null;
  thumb_url: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  total_minutes: number | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  notes?: string | null;
  owner_id?: string | null;
  source_url: string | null;
  source_name?: string | null;
  source_kind?: SourceKind | null;
  source_platform?: SocialPlatform | null;
  source_handle?: string | null;
}

export interface PrintData {
  title: string;
  /** "Serves 4", "Prep 10 min", "Cook 25 min", "Total 35 min". */
  facts: string[];
  photo: string | null;
  ingredients: Array<{ amount: string; name: string }>;
  steps: string[];
  notes: string | null;
  /** "From Serious Eats", "From @handle on TikTok", "Recipe from TheMealDB". */
  credit: string;
  creditUrl: string | null;
}

/** Catalog recipes are written to serve this many (see nutrition.ts BASE_SERVINGS). */
const CATALOG_SERVINGS = 4;
const PLATFORM: Record<SocialPlatform, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', pinterest: 'Pinterest', facebook: 'Facebook' };

const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const host = (url: string | null) => { try { return new URL(url!).hostname.replace(/^www\./, ''); } catch { return null; } };

export function printData(r: PrintableRecipe, servings: number, units: UnitSystem): PrintData {
  const own = !!r.owner_id;
  const base = r.servings ?? CATALOG_SERVINGS;
  const scale = servings / base;
  const facts = [`Serves ${servings}`];
  if (r.prep_minutes) facts.push(`Prep ${minutes(r.prep_minutes)}`);
  if (r.cook_minutes) facts.push(`Cook ${minutes(r.cook_minutes)}`);
  if (r.total_minutes && !(r.prep_minutes && r.cook_minutes && r.prep_minutes + r.cook_minutes === r.total_minutes)) facts.push(`${own ? 'Total' : 'About'} ${minutes(r.total_minutes)}`);
  let credit: string;
  let creditUrl: string | null = r.source_url;
  if (!own) { credit = 'Recipe from TheMealDB'; creditUrl = r.source_url || 'https://www.themealdb.com'; }
  else if (r.source_kind === 'social' && r.source_platform) credit = r.source_handle ? `From @${r.source_handle} on ${PLATFORM[r.source_platform]}` : `From ${PLATFORM[r.source_platform]}`;
  else if (r.source_name || host(r.source_url)) credit = `From ${r.source_name || host(r.source_url)}`;
  else credit = 'A family recipe, saved in Forka';
  return {
    title: r.display_name || r.name,
    facts,
    photo: r.thumb_url,
    // The amount on its own ("1/2 cup"), the note after the name ("Unsalted butter, melted").
    ingredients: r.ingredients.map(i => ({
      amount: formatMeasure({ quantity: i.quantity, quantityMax: i.quantity_max, unit: i.unit, note: '' }, units, scale),
      name: i.note ? `${i.name_us}, ${i.note}` : i.name_us,
    })),
    steps: r.steps.map(s => (units === 'metric' ? s.text_metric : s.text_us)),
    notes: own && r.notes?.trim() ? r.notes.trim() : null,
    credit,
    creditUrl,
  };
}

/** "lemon-ricotta-pancakes.pdf". */
export const pdfName = (title: string) => `${title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'recipe'}.pdf`;
