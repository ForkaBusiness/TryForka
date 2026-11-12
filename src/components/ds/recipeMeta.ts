import type { RecipeCard } from '../../lib/catalog';

// Short forms for tags on recipe cards and photos.

/** "25 min" or "1.5 hr". */
export const shortMinutes = (m: number | null | undefined) => (m ? (m >= 90 ? `${+(m / 60).toFixed(1)} hr` : `${m} min`) : '');

/** Cuisine and diet, each as its own short tag. */
export function recipeTags(r: Pick<RecipeCard, 'area' | 'diets'>): string[] {
  const diet = r.diets.includes('vegan') ? 'Vegan' : r.diets.includes('vegetarian') ? 'Vegetarian' : '';
  const area = r.area && r.area !== 'Unknown' ? r.area : '';
  return [area, diet].filter(Boolean);
}
