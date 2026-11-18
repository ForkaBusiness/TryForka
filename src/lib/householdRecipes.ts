import { deleteHouseholdRecipe, householdRecipeFrom, insertHouseholdRecipe, updateHouseholdRecipe } from './catalog';
import { recipeChecker, type FoodPrefs } from './recipeFilter';
import { fetchGroceryList, saveCustomItems, type CustomItem } from './groceries';
import { formatMeasure, type UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';
import { draftToRow, filledIngredients, filledSteps, structureIngredient } from '../../supabase/functions/_shared/imports/structure.ts';
import { canonicalUrl, type DraftFlag, type ImportDraft } from '../../supabase/functions/_shared/imports/draft.ts';

// The household's own recipes: saving a draft from the editor (typed in or imported),
// checking it against the family's settings before it's saved, spotting a link that's
// already in the library, and putting a recipe's ingredients on the grocery list. Every
// saved recipe is shown through the gate like any other (catalog.ts).

export { rowToDraft } from '../../supabase/functions/_shared/imports/structure.ts';
export { emptyDraft, type ImportDraft, type DraftFlag, type DraftIngredient } from '../../supabase/functions/_shared/imports/draft.ts';

/** What would stop this draft from being shown to the family once saved ("Tree nut", "not vegetarian"). Empty when nothing would. */
export function draftBlockedBy(draft: ImportDraft, prefs: FoodPrefs): string[] {
  return recipeChecker(prefs)({ id: 0, ...draftToRow(draft) } as never).blockedBy;
}

/** What a draft needs before it can be saved, in plain words; null when it's ready. */
export function draftProblem(draft: ImportDraft): string | null {
  if (!draft.title.trim()) return 'Give the recipe a name.';
  if (!filledIngredients(draft.ingredients).length) return 'Add at least one ingredient.';
  if (!filledSteps(draft.steps).length) return 'Add at least one step.';
  return null;
}

/** Saves the draft as a new recipe, or over the household's recipe `id`. Returns its id. */
export async function saveDraft(userId: string, draft: ImportDraft, id?: number): Promise<number> {
  const row = draftToRow({ ...draft, source: { ...draft.source, url: canonicalUrl(draft.source.url) } });
  if (id) {
    await updateHouseholdRecipe(userId, id, { ...row });
    return id;
  }
  return insertHouseholdRecipe(userId, { ...row });
}

export const deleteRecipe = deleteHouseholdRecipe;

/** The recipe the household already saved from this link, if any. */
export async function alreadySaved(userId: string, url: string | null | undefined): Promise<{ id: number; title: string } | null> {
  const canonical = canonicalUrl(url);
  return canonical ? householdRecipeFrom(userId, canonical) : null;
}

/** One grocery line per ingredient: "Flour, 2 cups". */
export function groceryLines(draft: ImportDraft, units: UnitSystem): string[] {
  return filledIngredients(draft.ingredients).map(ing => {
    const s = structureIngredient(ing);
    const amount = formatMeasure({ quantity: s.quantity, quantityMax: s.quantity_max, unit: s.unit, note: '' }, units);
    return amount ? `${s.name_us}, ${amount}` : s.name_us;
  });
}

/**
 * Adds a recipe's ingredients to the grocery list as items of their own (the list built
 * from the week plan is left as it is). Lines already on the list aren't added twice.
 * Returns how many were added.
 */
export async function addToGroceryList(userId: string, lines: string[]): Promise<number> {
  const list = await fetchGroceryList(userId);
  const custom: CustomItem[] = list?.custom ?? [];
  const have = new Set(custom.map(c => c.name.toLowerCase()));
  const stamp = Date.now().toString(36);
  const added = lines.filter(l => !have.has(l.toLowerCase())).map((name, i) => ({ key: `custom:${stamp}${i}`, name }));
  if (added.length) await saveCustomItems(userId, [...custom, ...added], list?.checked ?? []);
  return added.length;
}

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const plural = (n: number, one: string, many: string) => (n === 1 ? `the ${one}` : `the ${WORDS[n] ?? n} ${many}`);

/** "Got it. Check the two highlighted amounts before saving." */
export function reviewNote(flags: DraftFlag[]): string {
  if (!flags.length) return 'Got it. Look it over, then save.';
  const amounts = flags.filter(f => f.field === 'ingredients' && f.part === 'quantity').length;
  if (amounts === flags.length) return `Got it. Check ${plural(amounts, 'highlighted amount', 'highlighted amounts')} before saving.`;
  return `Got it. Check ${plural(flags.length, 'highlighted part', 'highlighted parts')} before saving.`;
}

