// The family's settings as the recipe filter reads them. Pure (no network), so the
// allergy tests can use exactly what the app uses.

import { allergyLabel, canonicalAllergy } from '../../supabase/functions/_shared/catalog/recipeFilter.ts';

export type MemberKind = 'adult' | 'kid';

export interface FamilyMember {
  id: string;
  name: string;
  kind: MemberKind;
  likes: string[];
  dislikes: string[];
  allergies: string[];
  position: number;
  /** Pro: a packed school lunch on weekdays (children). */
  school_lunch?: boolean;
  /** Pro: an optional goal (portions.ts). Children only ever have general goals. */
  goal?: 'none' | 'calories' | 'protein' | 'more_protein' | 'lighter' | 'growing_kid';
  goal_calories?: number | null;
  goal_protein?: number | null;
}

/** Every allergy in the house: the household's plus each person's. */
export function allAllergies(household: readonly string[], members: readonly Pick<FamilyMember, 'allergies'>[]): string[] {
  return [...new Set([...household, ...members.flatMap(m => m.allergies)].map(canonicalAllergy))];
}

/**
 * The settings every recipe is filtered with: the saved household settings, with each
 * person's allergies added. Screens read these; only Settings edits the saved ones.
 */
export function withFamilyAllergies<P extends { allergies: string[] }>(prefs: P, members: readonly Pick<FamilyMember, 'allergies'>[]): P {
  return members.some(m => m.allergies.length) ? { ...prefs, allergies: allAllergies(prefs.allergies, members) } : prefs;
}

const words = (items: string[]) => items.map(i => i.toLowerCase()).join(', ');

/** "Kid. Allergic to peanut. Likes rice." */
export function memberSummary(m: Pick<FamilyMember, 'kind' | 'allergies' | 'likes' | 'dislikes'>): string {
  return [
    m.kind === 'kid' ? 'Kid' : 'Adult',
    m.allergies.length ? `Allergic to ${words(m.allergies.map(allergyLabel))}` : '',
    m.likes.length ? `Likes ${words(m.likes)}` : '',
    m.dislikes.length ? `Doesn't like ${words(m.dislikes)}` : '',
  ].filter(Boolean).join('. ') + '.';
}

/** The one line shown wherever recipes are hidden for an allergy. */
export const CHECK_INGREDIENTS = 'Always check the ingredients yourself.';

/** "Recipes with peanut and egg are hidden. Always check the ingredients yourself." */
export function allergyReminder(allergies: readonly string[]): string | null {
  if (!allergies.length) return null;
  const names = allergies.map(a => allergyLabel(a).toLowerCase());
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Recipes with ${list} are hidden. ${CHECK_INGREDIENTS}`;
}
