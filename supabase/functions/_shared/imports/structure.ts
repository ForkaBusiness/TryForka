// A draft the household saves -> the columns of a `recipes` row, in exactly the shape the
// catalog uses: structured ingredients with allergens, steps with US and metric text and
// timers, ingredient names, recipe allergens and diets. So the allergy gate, the grocery
// list, scaling, cooking mode, hands-free and nutrition treat an imported recipe like any
// other. Pure TypeScript (Deno, Vite, Node).

import { classifyRecipe, ingredientAllergens, type Allergen, type Diet } from '../catalog/allergens.ts';
import type { RecipeIngredient, RecipeStep } from '../catalog/derive.ts';
import { sentenceCaseName, usIngredientName } from '../catalog/names.ts';
import { stepTimers } from '../catalog/steps.ts';
import { convertTemperatures, convertTextUnits, formatNumber, unitLabel } from '../catalog/units.ts';
import type { DraftIngredient, ImportDraft, SourceKind, SocialPlatform } from './draft.ts';

/** The columns a saved household recipe writes (owner_id and id are added by the caller). */
export interface UserRecipeRow {
  name: string;
  display_name: string;
  thumb_url: string | null;
  instructions_raw: string;
  steps: RecipeStep[];
  ingredients: RecipeIngredient[];
  ingredient_names: string[];
  allergens: Allergen[];
  diets: Diet[];
  total_minutes: number | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  notes: string | null;
  source_url: string | null;
  source_name: string | null;
  source_kind: SourceKind;
  source_platform: SocialPlatform | null;
  source_handle: string | null;
}

const MAX_TITLE = 120;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const minutes = (n: number | null | undefined) => (n && Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 7 * 24 * 60) : null);

/** The amount as written, for the grocery list's notes: "2 cups", "1-2 tbsp", "" when none. */
export function amountText(ing: Pick<DraftIngredient, 'quantity' | 'quantity_max' | 'unit'>): string {
  if (ing.quantity === null) return '';
  const qty = ing.quantity_max && ing.quantity_max > ing.quantity ? `${formatNumber(ing.quantity)}-${formatNumber(ing.quantity_max)}` : formatNumber(ing.quantity);
  const unit = unitLabel(ing.unit, ing.quantity_max ?? ing.quantity);
  return unit ? `${qty} ${unit}` : qty;
}

/** A draft line as one line of text again: "2 cups flour, sifted". Parsing it gives the same parts back. */
export function ingredientText(ing: DraftIngredient): string {
  const amount = amountText(ing);
  const item = clean(ing.item);
  const note = clean(ing.note);
  return [amount, item].filter(Boolean).join(' ') + (note ? `${item || amount ? ', ' : ''}${note}` : '');
}

/** One draft line -> a catalog-shaped ingredient with its allergens. */
export function structureIngredient(ing: DraftIngredient): RecipeIngredient {
  const item = clean(ing.item);
  const note = clean(ing.note);
  const measure = [amountText(ing), note].filter(Boolean).join(' ');
  const nameUs = sentenceCaseName(usIngredientName(item, measure)) || item;
  return {
    name: item,
    name_us: nameUs,
    measure_raw: measure,
    quantity: ing.quantity,
    quantity_max: ing.quantity_max,
    unit: ing.unit,
    note,
    // The note counts too: "butter (or vegan butter)" and "pesto, store-bought" both say what's in it.
    allergens: [...new Set([...ingredientAllergens(item), ...ingredientAllergens(nameUs), ...ingredientAllergens(note)])],
  };
}

export function structureStep(text: string): RecipeStep {
  const t = clean(text);
  return { text_us: convertTextUnits(t, 'us'), text_metric: convertTemperatures(t, 'metric'), timers: stepTimers(t) };
}

/** Lines the household left empty don't become part of the recipe. */
export const filledIngredients = (list: readonly DraftIngredient[]) => list.filter(i => clean(i.item) || i.quantity !== null);
export const filledSteps = (list: readonly string[]) => list.map(clean).filter(Boolean);

/** The draft as the columns of a `recipes` row. */
export function draftToRow(draft: ImportDraft): UserRecipeRow {
  const title = clean(draft.title).slice(0, MAX_TITLE) || 'Untitled recipe';
  const ingredients = filledIngredients(draft.ingredients).map(structureIngredient);
  const stepTexts = filledSteps(draft.steps);
  const steps = stepTexts.map(structureStep);
  const ingredientNames = [...new Set(ingredients.flatMap(i => [i.name, i.name_us, i.note ? `${i.name} ${i.note}` : '']).map(n => n.toLowerCase()).filter(Boolean))];
  const { allergens, diets } = classifyRecipe({
    name: title,
    category: '',
    ingredientNames: ingredients.flatMap(i => [i.name, i.name_us, i.note]).filter(Boolean),
    instructions: stepTexts.join('\n'),
  });
  // The recipe's allergens include every line's: a line can name one the recipe-level pass reads differently.
  const all = [...new Set([...allergens, ...ingredients.flatMap(i => i.allergens)])];
  const prep = minutes(draft.prep_minutes);
  const cook = minutes(draft.cook_minutes);
  return {
    name: title,
    display_name: title,
    thumb_url: draft.image_url || null,
    instructions_raw: stepTexts.join('\n'),
    steps,
    ingredients,
    ingredient_names: ingredientNames,
    allergens: all,
    // A recipe that names an allergen can't keep a diet that excludes it.
    diets: diets.filter(d => !(d === 'vegan' && (all.includes('dairy') || all.includes('egg')))),
    total_minutes: minutes(draft.total_minutes) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
    servings: draft.servings && draft.servings > 0 ? Math.min(Math.round(draft.servings), 100) : null,
    prep_minutes: prep,
    cook_minutes: cook,
    notes: clean(draft.notes) ? draft.notes.trim() : null,
    source_url: draft.source.url,
    source_name: draft.source.site_name,
    source_kind: draft.source.kind,
    source_platform: draft.source.platform ?? null,
    source_handle: draft.source.handle ?? null,
  };
}

/** A saved recipe back into a draft, for editing. Steps come from the text as written. */
export function rowToDraft(row: Partial<UserRecipeRow> & { name: string; display_name?: string | null; ingredients: RecipeIngredient[]; steps: RecipeStep[] }): ImportDraft {
  const raw = clean(row.instructions_raw) ? row.instructions_raw!.split('\n') : row.steps.map(s => s.text_us);
  return {
    title: row.display_name || row.name,
    servings: row.servings ?? null,
    prep_minutes: row.prep_minutes ?? null,
    cook_minutes: row.cook_minutes ?? null,
    total_minutes: row.prep_minutes || row.cook_minutes ? null : row.total_minutes ?? null,
    ingredients: row.ingredients.map(i => ({ quantity: i.quantity, quantity_max: i.quantity_max, unit: i.unit, item: i.name, note: i.note })),
    steps: raw.filter(s => s.trim()),
    notes: row.notes ?? '',
    image_url: row.thumb_url ?? null,
    source: {
      kind: row.source_kind ?? 'manual', url: row.source_url ?? null, site_name: row.source_name ?? null,
      platform: row.source_platform ?? null, handle: row.source_handle ?? null,
    },
    flags: [],
  };
}
