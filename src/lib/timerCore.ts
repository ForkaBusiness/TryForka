// Cooking timers, the arithmetic only: each timer is an end time, never a countdown, so it
// keeps correct time while the page sleeps (the phone locks, the cook switches apps) and
// shows as finished the moment the page looks again. Every function takes `now`, so
// tests/timerCore.test.ts can lock the "screen" for as long as it likes.
// timers.ts keeps the list, plays the alerts and saves it on the device.

export interface Timer {
  id: string;
  /** From the step's wording: "Simmer 10 min", "Bake 25-30 min". */
  label: string;
  recipeId: number | null;
  recipeTitle: string;
  /** The step it came from (1-based), or null. */
  step?: number | null;
  /** The written range when the step gives one ("25-30 min"); the timer counts the lower end. */
  range?: string | null;
  /** Running: when it ends (ms since epoch). Null while paused or done. */
  endAt: number | null;
  /** Paused: ms left. */
  pausedLeft: number;
  /** Full length, including any minutes added. */
  totalMs: number;
  /** Finished and not yet dismissed. */
  done: boolean;
  /** When it finished (ms since epoch), for "finished 3 min ago". */
  doneAt?: number | null;
}

export interface NewTimer {
  label: string;
  seconds: number;
  recipeId: number | null;
  recipeTitle: string;
  step?: number | null;
  range?: string | null;
}

export function createTimer(opts: NewTimer, now: number, id: string): Timer {
  const ms = Math.max(1, Math.round(opts.seconds)) * 1000;
  return {
    id, label: opts.label, recipeId: opts.recipeId, recipeTitle: opts.recipeTitle,
    step: opts.step ?? null, range: opts.range ?? null,
    endAt: now + ms, pausedLeft: 0, totalMs: ms, done: false, doneAt: null,
  };
}

/** Milliseconds left (0 when done), never more than the timer's length (a clock read a moment early). */
export function remainingMs(t: Timer, now: number): number {
  if (t.done) return 0;
  return t.endAt === null ? t.pausedLeft : Math.max(0, Math.min(t.totalMs, t.endAt - now));
}

/**
 * Marks every timer whose end time has passed as done, however long the page was asleep.
 * `finished` lists the ones that just finished (each is reported once, for the alert).
 */
export function settle(list: readonly Timer[], now: number): { list: Timer[]; finished: Timer[] } {
  const finished: Timer[] = [];
  const next = list.map(t => {
    if (t.done || t.endAt === null || t.endAt > now) return t;
    const doneTimer = { ...t, done: true, endAt: null, pausedLeft: 0, doneAt: t.endAt };
    finished.push(doneTimer);
    return doneTimer;
  });
  return { list: finished.length ? next : [...list], finished };
}

export function pause(t: Timer, now: number): Timer {
  return t.endAt !== null && !t.done ? { ...t, pausedLeft: Math.max(0, t.endAt - now), endAt: null } : t;
}

export function resume(t: Timer, now: number): Timer {
  return t.endAt === null && !t.done ? { ...t, endAt: now + t.pausedLeft, pausedLeft: 0 } : t;
}

/** One more minute; a finished timer starts again for that minute. */
export function addMinute(t: Timer, now: number): Timer {
  if (t.done) return { ...t, done: false, doneAt: null, endAt: now + 60_000, pausedLeft: 0, totalMs: 60_000 };
  return t.endAt === null
    ? { ...t, pausedLeft: t.pausedLeft + 60_000, totalMs: t.totalMs + 60_000 }
    : { ...t, endAt: t.endAt + 60_000, totalMs: t.totalMs + 60_000 };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "Simmer 10 min" -> "Simmer": the action, for a running timer that shows its own clock. */
export function timerAction(label: string): string {
  return label.replace(/\s[\d-]+\s?(min|hr|sec)\b.*$/, '').trim() || label;
}

/** The line under a timer's name: its step and recipe, and for a range, what to do when it ends. */
export function timerDetail(t: Timer): string {
  const where = [t.step ? `Step ${t.step}` : null, t.recipeTitle || null].filter(Boolean).join(' · ');
  if (t.range && t.done) return `Check it now. The recipe says ${t.range}.`;
  if (t.range) return where ? `${where} · ${t.range}` : t.range;
  return where;
}
