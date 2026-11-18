import { supabase } from './supabase';

// Use what you have: the ingredients the household wants used up, and when they said so.
// They count for a week; after that leftovers are gone or forgotten, and the plan stops
// leaning on them. Stored with the household's settings; on a database without those
// columns yet, on this device.

export interface OnHand { items: string[]; at: string | null }
export const NOTHING_ON_HAND: OnHand = { items: [], at: null };
export const ON_HAND_DAYS = 7;

/** The items that still count today. */
export function activeOnHand(onHand: OnHand, now = new Date()): string[] {
  if (!onHand.at || !onHand.items.length) return [];
  return now.getTime() - new Date(onHand.at).getTime() < ON_HAND_DAYS * 86_400_000 ? onHand.items : [];
}

let column = true;
const localKey = (userId: string) => `forka_on_hand:${userId}`;
const missingColumn = (error: { code?: string; message?: string }) => error.code === '42703' || error.code === 'PGRST204' || /on_hand/.test(error.message ?? '');

function local(userId: string): OnHand {
  try {
    const v = JSON.parse(localStorage.getItem(localKey(userId)) ?? 'null') as OnHand | null;
    return v && Array.isArray(v.items) ? { items: v.items.filter(i => typeof i === 'string'), at: typeof v.at === 'string' ? v.at : null } : NOTHING_ON_HAND;
  } catch { return NOTHING_ON_HAND; }
}

export async function fetchOnHand(userId: string): Promise<OnHand> {
  if (column) {
    const { data, error } = await supabase.from('user_preferences').select('on_hand, on_hand_at').eq('user_id', userId).maybeSingle();
    if (!error) return { items: (data?.on_hand as string[] | null) ?? [], at: (data?.on_hand_at as string | null) ?? null };
    if (!missingColumn(error)) throw new Error(error.message);
    column = false;
  }
  return local(userId);
}

export async function saveOnHand(userId: string, items: string[]): Promise<OnHand> {
  const value: OnHand = { items, at: items.length ? new Date().toISOString() : null };
  if (column) {
    const { error } = await supabase.from('user_preferences')
      .upsert({ user_id: userId, on_hand: value.items, on_hand_at: value.at, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (!error) return value;
    if (!missingColumn(error)) throw new Error(error.message);
    column = false;
  }
  try { localStorage.setItem(localKey(userId), JSON.stringify(value)); } catch { /* this visit only */ }
  return value;
}
