import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { cookedRecently } from '../lib/cooked';
import { DAYS, todayKey, type Day, type SavedWeekPlan } from '../lib/plan';
import type { CheckinResponse } from '../lib/planner';
import { answeredDinners, localDate, logPlanEvents, type CheckinAnswer } from '../lib/signals';
import { Button, Card, cx } from './ds';

// The after-dinner check-in: "Did everyone eat it?", one tap per person. It shows on the
// home screen once tonight's dinner is marked cooked, or late enough that dinner is over,
// and the next day for last night's dinner if it wasn't answered. "Not now" tonight is a
// snooze: the question comes back once, the next day. Answering is what teaches the plan;
// skipping it costs nothing.

/** Minutes after midnight when dinner is taken to be over if nobody marked it cooked: 7:30 pm. */
const AFTER_DINNER = 19 * 60 + 30;
/** A plan made after this hour yesterday didn't decide yesterday's dinner. */
const DINNER_DECIDED_HOUR = 17;
const RECHECK_MS = 5 * 60_000;
const SKIPPED_KEY = 'forka_checkin_skipped';
const OPTIONS: Array<{ value: CheckinResponse; label: string }> = [
  { value: 'loved', label: 'Loved it' },
  { value: 'fine', label: 'It was fine' },
  { value: 'skipped', label: "Didn't eat it" },
];

interface Dinner { recipeId: number; title: string; date: string; day: Day; tonight: boolean }

const dinnerKey = (d: Pick<Dinner, 'date' | 'recipeId'>) => `${d.date}|${d.recipeId}`;
/** Skipping tonight's question and skipping last night's are remembered apart. */
const skipKey = (d: Dinner) => `${dinnerKey(d)}|${d.tonight ? 'tonight' : 'after'}`;

function skipped(): string[] {
  try { return JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function rememberSkipped(key: string) {
  try { localStorage.setItem(SKIPPED_KEY, JSON.stringify([...skipped(), key].slice(-14))); } catch { /* asks again next time */ }
}

/** Tonight's dinner and last night's, when the plan has them. */
function dinners(saved: SavedWeekPlan, now: Date): { tonight: Dinner | null; lastNight: Dinner | null } {
  const today = todayKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const decidedBy = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, DINNER_DECIDED_HOUR);
  const at = (day: Day, date: Date, tonight: boolean): Dinner | null => {
    const entry = saved.plan[day].dinner;
    return entry ? { recipeId: entry.id, title: entry.title, date: localDate(date), day, tonight } : null;
  };
  return {
    tonight: at(today, now, true),
    // Only a plan that was already there before yesterday's dinner had a "last night".
    lastNight: new Date(saved.createdAt) < decidedBy ? at(DAYS[(DAYS.indexOf(today) + 6) % 7], yesterday, false) : null,
  };
}

function AnswerRow({ name, value, onChange }: { name: string | null; value: CheckinResponse | null; onChange: (v: CheckinResponse) => void }) {
  return (
    <div className="sm:flex sm:items-center sm:gap-4">
      {name && <p className="mb-1.5 truncate text-small font-semibold text-ink sm:mb-0 sm:w-28 sm:shrink-0">{name}</p>}
      <div role="radiogroup" aria-label={name ?? 'Everyone'} className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
        {OPTIONS.map(o => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cx(
                'h-11 cursor-pointer rounded-full border px-1 text-small font-semibold whitespace-nowrap transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-98',
                selected ? 'border-green bg-green-soft text-green' : 'border-line bg-surface text-ink hover:border-ink-muted',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CheckIn() {
  const { userId, weekPlan, members, submitCheckin } = useApp();
  const [dinner, setDinner] = useState<Dinner | null>(null);
  const [answers, setAnswers] = useState<Record<string, CheckinResponse>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);

  // The home screen can sit open across dinner time or midnight: look at the clock again now and then.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClock(c => c + 1), RECHECK_MS);
    return () => window.clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `clock` is the reason to recompute
  const options = useMemo(() => (weekPlan ? dinners(weekPlan, new Date()) : null), [weekPlan, clock]);
  const tonightId = options?.tonight?.recipeId;
  const tonightDate = options?.tonight?.date;
  const lastNightKey = options?.lastNight ? dinnerKey(options.lastNight) : null;

  useEffect(() => {
    if (!options) { setDinner(null); return; }
    let cancelled = false;
    (async () => {
      const { tonight, lastNight } = options;
      const dates = [tonight?.date, lastNight?.date].filter((d): d is string => !!d);
      if (!dates.length) return null;
      const [answered, cooked] = await Promise.all([
        answeredDinners(userId, dates),
        tonight ? cookedRecently(userId, tonight.recipeId).catch(() => null) : null,
      ]);
      const open = (d: Dinner | null) => !!d && !answered.has(dinnerKey(d)) && !skipped().includes(skipKey(d));
      const time = new Date();
      // Once tonight's dinner is cooked or dinner time has passed, last night's is behind us.
      if (tonight && (cooked || time.getHours() * 60 + time.getMinutes() >= AFTER_DINNER)) return open(tonight) ? tonight : null;
      return open(lastNight) ? lastNight : null;
    })().then(d => {
      if (cancelled) return;
      // The same dinner asked about again (a clock tick) keeps the answers already tapped.
      setDinner(prev => { if (!d || !prev || skipKey(prev) !== skipKey(d)) setAnswers({}); return d; });
    }).catch(() => { if (!cancelled) setDinner(null); });
    return () => { cancelled = true; };
    // The plan's other days don't matter here: only which dinners could be asked about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tonightId, tonightDate, lastNightKey, clock]);

  if (thanks) return <p role="status" className="mb-4 px-1 text-small text-ink-muted">{thanks}</p>;
  if (!dinner) return null;

  const save = async (list: CheckinAnswer[]) => {
    setSaving(true);
    setError(false);
    try {
      const changed = await submitCheckin(dinner.recipeId, dinner.date, list);
      // When the plan changed, the note about it says everything.
      setThanks(changed ? '' : 'Noted. The rest of the week still fits.');
      setDinner(null);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  const skip = () => { rememberSkipped(skipKey(dinner)); setDinner(null); };
  // Not making it settles the question for good, tonight and tomorrow.
  const notCooked = () => {
    logPlanEvents(userId, [{ recipeId: dinner.recipeId, kind: 'not_cooked', day: dinner.day }]);
    rememberSkipped(skipKey({ ...dinner, tonight: true }));
    rememberSkipped(skipKey({ ...dinner, tonight: false }));
    setDinner(null);
  };

  const everyone = members.length > 0 && members.every(m => answers[m.id] === answers[members[0].id]) ? answers[members[0].id] ?? null : null;
  const answered = members.filter(m => answers[m.id]);

  return (
    <Card role="group" aria-label="Dinner check-in" className="mb-4 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="label">{dinner.tonight ? "Tonight's dinner" : "Last night's dinner"}</p>
          <h2 className="mt-1 text-heading text-ink">Did everyone eat it?</h2>
          <p className="truncate text-small text-ink-muted">{dinner.title}</p>
        </div>
        <Button variant="ghost" size="sm" className="-mt-1 -mr-2" onClick={skip}>Not now</Button>
      </div>

      <div className={cx('mt-4 grid gap-3', saving && 'pointer-events-none opacity-60')}>
        {members.length === 0 ? (
          // No family set up yet: one tap answers for the household.
          <AnswerRow name={null} value={null} onChange={v => void save([{ memberId: null, response: v }])} />
        ) : (
          <>
            {members.length > 1 && (
              <AnswerRow name="Everyone" value={everyone} onChange={v => setAnswers(Object.fromEntries(members.map(m => [m.id, v])))} />
            )}
            {members.map(m => <AnswerRow key={m.id} name={m.name} value={answers[m.id] ?? null} onChange={v => setAnswers(a => ({ ...a, [m.id]: v }))} />)}
          </>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-small text-terracotta-deep">Couldn't save that. Check your connection and try again.</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" onClick={notCooked} className="min-h-9 cursor-pointer text-small font-semibold text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          We didn't make it
        </button>
        {members.length > 0 && (
          <Button variant="secondary" size="sm" loading={saving} disabled={!answered.length}
            onClick={() => void save(answered.map(m => ({ memberId: m.id, response: answers[m.id] })))}>
            Done
          </Button>
        )}
      </div>
    </Card>
  );
}
