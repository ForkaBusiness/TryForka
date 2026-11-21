import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { DAYS, SLOT_LABEL, todayKey, type Day, type SavedWeekPlan, type Slot } from '../lib/plan';
import type { CheckinResponse } from '../lib/planner';
import { answeredDinners, localDate } from '../lib/signals';
import { Button, Card, cx } from './ds';

// The lighter check-in for Pro's other meals (breakfast, school lunch, lunch, snack): one
// tap per meal for the whole household, no per-person rows. It shows in the evening for
// today's meals and the next morning for yesterday's, and teaches the plan the same way
// the dinner check-in does. "Not now" puts it away for that day.

const EVENING = 19 * 60 + 30;
const SKIPPED_KEY = 'forka_meals_checkin_skipped';
const OTHER: Slot[] = ['breakfast', 'school_lunch', 'lunch', 'snack'];
const OPTIONS: Array<{ value: CheckinResponse; label: string }> = [
  { value: 'loved', label: 'Loved' },
  { value: 'fine', label: 'Fine' },
  { value: 'skipped', label: 'Not eaten' },
];

interface Meal { slot: Slot; recipeId: number; title: string }
interface Asked { date: string; today: boolean; meals: Meal[] }

function skippedDates(): string[] {
  try { return JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function rememberSkipped(date: string) {
  try { localStorage.setItem(SKIPPED_KEY, JSON.stringify([...skippedDates(), date].slice(-14))); } catch { /* asks again next time */ }
}

/** The day whose other meals to ask about: today once it's evening, otherwise yesterday. */
function askedDay(saved: SavedWeekPlan, now: Date): Asked | null {
  const evening = now.getHours() * 60 + now.getMinutes() >= EVENING;
  const date = evening ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const day: Day = evening ? todayKey(now) : DAYS[(DAYS.indexOf(todayKey(now)) + 6) % 7];
  // A plan made after that day's meals were eaten didn't decide them.
  if (new Date(saved.createdAt) > new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7)) return null;
  const meals = OTHER.flatMap(slot => {
    const e = saved.plan[day][slot];
    return e && !e.leftoverOf ? [{ slot, recipeId: e.id, title: e.title }] : [];
  });
  return meals.length ? { date: localDate(date), today: evening, meals } : null;
}

export function MealsCheckIn() {
  const { userId, weekPlan, submitCheckin, billing } = useApp();
  const asked = useMemo(() => (weekPlan && billing.plan === 'pro' ? askedDay(weekPlan, new Date()) : null), [weekPlan, billing.plan]);
  const [open, setOpen] = useState<Meal[] | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!asked || skippedDates().includes(asked.date)) { setOpen(null); return; }
    let cancelled = false;
    answeredDinners(userId, [asked.date])
      .then(done => { if (!cancelled) setOpen(asked.meals.filter(m => !done.has(`${asked.date}|${m.recipeId}`))); })
      .catch(() => { if (!cancelled) setOpen(null); });
    return () => { cancelled = true; };
  }, [asked, userId]);

  if (!asked || !open?.length) return null;

  const answer = async (meal: Meal, response: CheckinResponse) => {
    setSaving(meal.recipeId); setError(false);
    try {
      await submitCheckin(meal.recipeId, asked.date, [{ memberId: null, response }]);
      setOpen(list => list?.filter(m => m !== meal) ?? null);
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card role="group" aria-label="Other meals check-in" className="mb-4 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="label">{asked.today ? "Today's other meals" : "Yesterday's other meals"}</p>
          <h2 className="mt-1 text-heading text-ink">How did they go?</h2>
        </div>
        <Button variant="ghost" size="sm" className="-mt-1 -mr-2" onClick={() => { rememberSkipped(asked.date); setOpen(null); }}>Not now</Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {open.map(m => (
          <li key={`${m.slot}-${m.recipeId}`} className={cx('py-3 sm:flex sm:items-center sm:gap-4', saving === m.recipeId && 'pointer-events-none opacity-60')}>
            <p className="mb-2 min-w-0 sm:mb-0 sm:flex-1">
              <span className="block text-caption font-semibold text-ink-muted">{SLOT_LABEL[m.slot]}</span>
              <span className="block truncate text-small font-medium text-ink">{m.title}</span>
            </p>
            <div role="radiogroup" aria-label={`${SLOT_LABEL[m.slot]}: ${m.title}`} className="grid grid-cols-3 gap-1.5 sm:w-72 sm:shrink-0">
              {OPTIONS.map(o => (
                <button key={o.value} type="button" role="radio" aria-checked={false} onClick={() => void answer(m, o.value)}
                  className="h-10 cursor-pointer rounded-full border border-line bg-surface px-1 text-small font-semibold whitespace-nowrap text-ink transition-[transform,border-color] duration-150 ease-spring hover:border-ink-muted active:scale-98">
                  {o.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-small text-terracotta-deep">Couldn't save that. Check your connection and try again.</p>}
    </Card>
  );
}
