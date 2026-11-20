import { useMemo, useState } from 'react';
import { ChefHat, Clock } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { callFunction, DAY_LONG, SLOT_LABEL, todayKey } from '../lib/plan';
import { schedulePrep, type PrepTask } from '../lib/prepSchedule';
import { defaultPicks, kitchenMinutes, MAX_PREP_RECIPES, prepCandidates, prepSteps, sessionSummary, WEEK, type Day } from '../lib/prepSession';
import { clearPrep, loadPrep, PREP_ID, savePrep, type SavedPrep } from '../lib/prepStore';
import { servingsFor, BASE_SERVINGS } from '../lib/nutrition';
import { Button, Card, Checkbox, EmptyState, PageContainer, ToggleChip } from '../components/ds';

// Meal prep (Forka Pro): pick a day and the week's meals to get ahead on, and Forka puts the
// work into one session of about an hour, overlapping oven and hob time with chopping and
// packing. The session runs in cooking mode with timers, read aloud and hands-free.

export function MealPrep() {
  const { weekPlan, prefs, back, go, billing } = useApp();
  const today = todayKey();
  const days = WEEK.slice(WEEK.indexOf(today as Day));
  const [day, setDay] = useState<Day>(() => { const d = loadPrep()?.day; return d && days.includes(d) ? d : days[0]; });
  const candidates = useMemo(() => (weekPlan ? prepCandidates(weekPlan.plan as never, day) : []), [weekPlan, day]);
  const [picked, setPicked] = useState<number[] | null>(null);
  const picks = picked ?? defaultPicks(candidates);
  const [saved, setSaved] = useState<SavedPrep | null>(() => loadPrep());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number, on: boolean) => {
    const next = on ? [...picks, id] : picks.filter(p => p !== id);
    setPicked(next.slice(0, MAX_PREP_RECIPES));
  };
  const chooseDay = (d: Day) => { setDay(d); setPicked(null); };

  const plan = async () => {
    setBusy(true); setError(null);
    try {
      const recipes = picks.map(id => ({ id, servings: servingsFor(id, BASE_SERVINGS) }));
      const out = await callFunction<{ tasks: PrepTask[]; skipped: string[] }>('meal-prep', { recipes, units: prefs.units });
      const schedule = schedulePrep(out.tasks);
      const session: SavedPrep = {
        at: Date.now(), day, picks, titles: candidates.filter(c => picks.includes(c.id)).map(c => c.title),
        plan: schedule, steps: prepSteps(schedule), skipped: out.skipped,
      };
      savePrep(session);
      setSaved(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/part of Pro/i.test(message)) { billing.upgrade('meal_prep'); return; }
      setError(message || "Couldn't plan the session. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    const steps = saved.plan.steps;
    return (
      <PageContainer title="Your prep session" onBack={back}
        intro={`${DAY_LONG[saved.day]}: ${saved.titles.join(', ')}.`}>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-green-soft text-green"><Clock size={22} strokeWidth={1.75} /></span>
            <p className="text-body font-semibold text-ink">{sessionSummary(saved.plan)}</p>
          </div>
          {/* Only when the cook's own part runs well past the hour. */}
          {saved.plan.note && kitchenMinutes(saved.plan) > 70 && <p className="mt-3 text-small text-ink-muted">{saved.plan.note}</p>}
          {saved.skipped.length > 0 && <p className="mt-3 text-small text-ink-muted">Some meals were left out because they don't fit your family's settings.</p>}
        </Card>
        <ol aria-label="Prep steps" className="mt-6 flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.task.id}>
              <Card className="p-4">
                <p className="text-small font-semibold text-ink-muted">{s.start === 0 ? 'To start' : `At ${s.start} min`}</p>
                <p className="mt-1 text-body text-ink">{saved.steps[i].text_us}</p>
              </Card>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" icon={ChefHat} onClick={() => go({ name: 'cooking', id: PREP_ID })}>Start prep</Button>
          <Button size="lg" variant="secondary" onClick={() => { clearPrep(); setSaved(null); setPicked(saved.picks); setDay(days.includes(saved.day) ? saved.day : days[0]); }}>Change meals</Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Meal prep" onBack={back} intro="Get ahead on the week in one session of about an hour. Pick the meals, and Forka puts the work in an order that keeps the oven and hob busy while you chop.">
      <fieldset>
        <legend className="mb-3 text-small font-semibold text-ink">Prep day</legend>
        <div role="radiogroup" aria-label="Prep day" className="flex flex-wrap gap-2">
          {days.map(d => <ToggleChip key={d} role="radio" selected={day === d} onToggle={() => chooseDay(d)}>{d === today ? 'Today' : DAY_LONG[d]}</ToggleChip>)}
        </div>
      </fieldset>

      {candidates.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={ChefHat} title="Nothing to prep yet">
            Plan the week first, then come back to prep the meals from {DAY_LONG[day]} on.
          </EmptyState>
        </div>
      ) : (
        <fieldset className="mt-8">
          <legend className="mb-1 text-small font-semibold text-ink">Meals to prep</legend>
          <p className="mb-3 text-small text-ink-muted">Up to {MAX_PREP_RECIPES}. Three is about an hour for most kitchens.</p>
          <Card className="divide-y divide-line">
            {candidates.map(c => (
              <div key={c.id} className="px-4 py-3">
                <Checkbox checked={picks.includes(c.id)} onChange={on => toggle(c.id, on)}
                  label={<span><span className="block text-body text-ink">{c.title}</span><span className="block text-small text-ink-muted">{DAY_LONG[c.day]}, {SLOT_LABEL[c.slot].toLowerCase()}</span></span>} />
              </div>
            ))}
          </Card>
          {error && <p role="alert" className="mt-4 text-small text-terracotta-deep">{error}</p>}
          <Button size="lg" className="mt-6 w-full sm:w-auto" icon={ChefHat} loading={busy} disabled={!picks.length} onClick={plan}>
            {busy ? 'Putting your session together…' : 'Plan my prep session'}
          </Button>
          {busy && <p role="status" className="mt-3 text-small text-ink-muted">This takes about half a minute.</p>}
        </fieldset>
      )}
    </PageContainer>
  );
}
