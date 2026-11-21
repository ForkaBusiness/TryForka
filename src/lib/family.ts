import { supabase } from './supabase';
import { canonicalAllergy } from './recipeFilter';
import type { FamilyMember } from './familyPrefs';

export { allAllergies, memberSummary, withFamilyAllergies, type FamilyMember, type MemberKind } from './familyPrefs';

// The people at the table (family_members). The household settings in user_preferences
// apply to everyone; each person adds their own allergies (hard filters, like the
// household's) and their likes and dislikes (which only move recipes up or down).

export type MemberDraft = Omit<FamilyMember, 'id' | 'position'> & { id?: string };

const COLUMNS = 'id, name, kind, likes, dislikes, allergies, position, school_lunch, goal, goal_calories, goal_protein';

/** True when the table isn't there yet (the app is ahead of the database). */
const missingTable = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message ?? '');

/**
 * The family, in the order it was added. `available` is false when the database doesn't
 * have the family tables yet: the app then leaves the family features out instead of
 * offering something that can't be saved. Any other failure is thrown: a person's
 * allergies must never quietly drop out of the filter because a request failed.
 */
export async function fetchMembers(userId: string): Promise<{ members: FamilyMember[]; available: boolean }> {
  const { data, error } = await supabase.from('family_members').select(COLUMNS).eq('user_id', userId).order('position').order('created_at');
  if (error) {
    if (missingTable(error)) return { members: [], available: false };
    throw new Error(error.message);
  }
  return { members: ((data ?? []) as FamilyMember[]).map(m => ({ ...m, allergies: [...new Set((m.allergies ?? []).map(canonicalAllergy))] })), available: true };
}

export async function saveMember(userId: string, draft: MemberDraft, position: number): Promise<FamilyMember> {
  const row = {
    user_id: userId, name: draft.name.trim(), kind: draft.kind, likes: draft.likes, dislikes: draft.dislikes,
    allergies: [...new Set(draft.allergies.map(canonicalAllergy))], updated_at: new Date().toISOString(),
    // Pro settings: only sent when set (a child can't have numbers; the database checks too).
    ...(draft.school_lunch !== undefined ? { school_lunch: draft.kind === 'kid' && draft.school_lunch } : {}),
    ...(draft.goal !== undefined ? { goal: draft.goal, goal_calories: draft.goal_calories ?? null, goal_protein: draft.goal_protein ?? null } : {}),
  };
  const query = draft.id
    ? supabase.from('family_members').update(row).eq('id', draft.id).eq('user_id', userId)
    : supabase.from('family_members').insert({ ...row, position });
  const { data, error } = await query.select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as FamilyMember;
}

export async function removeMember(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('family_members').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}
