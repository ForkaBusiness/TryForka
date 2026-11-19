// Where the cook is in each recipe: the step they're on and the ingredients they've ticked
// off. Kept on this device for a cooking session (12 hours since they last moved), so
// leaving cooking mode, locking the phone or closing the app picks up at the same step.
// Finishing the recipe clears it. Pure, tested in tests/cookSession.test.ts.

export interface CookSession {
  step: number;
  /** Ingredient indexes ticked off in the checklist. */
  checked: number[];
  /** When it last changed (ms since epoch). */
  at: number;
}

export const SESSION_MS = 12 * 60 * 60 * 1000;
const KEY = 'forka_cook_sessions_v1';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

function readAll(storage: Store): Record<string, CookSession> {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function writeAll(storage: Store, all: Record<string, CookSession>, now: number): void {
  // Old sessions are dropped whenever anything is saved.
  const fresh = Object.fromEntries(Object.entries(all).filter(([, s]) => now - s.at < SESSION_MS));
  try { storage?.setItem(KEY, JSON.stringify(fresh)); } catch { /* this visit only */ }
}

const valid = (s: unknown): s is CookSession => !!s && typeof s === 'object'
  && Number.isInteger((s as CookSession).step) && Array.isArray((s as CookSession).checked) && typeof (s as CookSession).at === 'number';

/** This recipe's session if one is still running, with the step kept inside the recipe. */
export function loadSession(storage: Store, recipeId: number, stepCount: number, now = Date.now()): CookSession | null {
  const s = readAll(storage)[recipeId];
  if (!valid(s) || now - s.at >= SESSION_MS || stepCount <= 0) return null;
  return {
    step: Math.min(Math.max(0, s.step), stepCount - 1),
    checked: s.checked.filter(i => Number.isInteger(i) && i >= 0),
    at: s.at,
  };
}

export function saveSession(storage: Store, recipeId: number, session: Omit<CookSession, 'at'>, now = Date.now()): void {
  const all = readAll(storage);
  all[recipeId] = { step: session.step, checked: [...new Set(session.checked)].sort((a, b) => a - b), at: now };
  writeAll(storage, all, now);
}

export function clearSession(storage: Store, recipeId: number, now = Date.now()): void {
  const all = readAll(storage);
  delete all[recipeId];
  writeAll(storage, all, now);
}
