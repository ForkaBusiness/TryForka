import { supabase } from './supabase';
import { canonicalAllergy } from './recipeFilter';
import type { UnitSystem } from '../../supabase/functions/_shared/catalog/units.ts';

// The household's food settings (user_preferences) and profile (users). Onboarding and
// Settings write the same fields; safe_recipes() and the recipe filter read them.

export type DietChoice = 'none' | 'vegetarian' | 'vegan' | 'pescatarian';

export interface Preferences {
  diet: DietChoice;
  /** Allergen keys ("tree_nut") or normalized ingredient names ("mustard"). */
  allergies: string[];
  /** Dislikes set to "never show". */
  skip_ingredients: string[];
  /** Dislikes set to "avoid if possible": still shown, but last. */
  avoid_ingredients: string[];
  plan_breakfast: boolean;
  plan_lunch: boolean;
  plan_dinner: boolean;
  /** Max minutes for Monday-Friday dinners; null = no limit. */
  max_weeknight_minutes: number | null;
  units: UnitSystem;
  onboarded_at: string | null;
}

export const DEFAULT_PREFERENCES: Preferences = {
  diet: 'none', allergies: [], skip_ingredients: [], avoid_ingredients: [], plan_breakfast: false, plan_lunch: false, plan_dinner: true,
  max_weeknight_minutes: null, units: 'us', onboarded_at: null,
};

const COLUMNS = 'diet, allergies, skip_ingredients, avoid_ingredients, plan_breakfast, plan_lunch, plan_dinner, max_weeknight_minutes, units, onboarded_at';

export async function fetchPreferences(userId: string): Promise<Preferences> {
  const { data, error } = await supabase.from('user_preferences').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ...DEFAULT_PREFERENCES };
  return {
    ...DEFAULT_PREFERENCES,
    ...data,
    allergies: [...new Set(((data.allergies as string[]) ?? []).map(canonicalAllergy))],
  } as Preferences;
}

export async function savePreferences(userId: string, updates: Partial<Preferences>): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export interface Profile {
  full_name: string;
  household_name: string;
  household_size: number;
}

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('users').select('full_name, household_name, household_size').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return { full_name: data?.full_name ?? '', household_name: data?.household_name ?? '', household_size: data?.household_size ?? 1 };
}

export async function saveProfile(userId: string, email: string | undefined, updates: Partial<Profile>): Promise<void> {
  const { error } = await supabase.from('users').upsert({ id: userId, email, ...updates }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  if (updates.full_name !== undefined) await supabase.auth.updateUser({ data: { full_name: updates.full_name } });
}
