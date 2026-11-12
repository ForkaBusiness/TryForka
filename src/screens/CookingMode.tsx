import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getRecipe, recipeTitle, type Recipe } from '../lib/catalog';
import { markCooked } from '../lib/cooked';
import { TimerChip } from '../components/Timers';
import { Button, IconButton, Progress, Skeleton } from '../components/ds';

// A cookbook propped on the counter: one step per screen in type you can read from a few
// feet away, and big targets for next and back. Arrow keys and space move on desktop; the
// screen stays awake while this is open.

function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let active = true;
    const acquire = async () => {
      try { if (active && document.visibilityState === 'visible') lock = await nav.wakeLock!.request('screen'); } catch { /* denied or unsupported */ }
    };
    // The lock drops when the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export function CookingMode({ id }: { id: number }) {
  const { prefs, userId, replace, back } = useApp();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useWakeLock();

  useEffect(() => { getRecipe(id).then(setRecipe).catch(() => setRecipe(null)); }, [id]);

  const total = recipe?.steps.length ?? 0;
  const last = step >= total - 1;

  const finish = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await markCooked(userId, id);
      setFinished(true);
    } catch {
      setError("Couldn't mark it as cooked. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [userId, id]);

  const next = useCallback(() => { if (last) void finish(); else setStep(s => Math.min(total - 1, s + 1)); }, [last, finish, total]);
  const prev = useCallback(() => setStep(s => Math.max(0, s - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Space on a focused button presses that button instead.
      if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, finished]);

  if (recipe === undefined) {
    return (
      <div aria-busy aria-label="Loading recipe" className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-12">
        <Skeleton className="h-11 w-11 rounded-full" />
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
        <Skeleton className="mt-12 h-5 w-24 rounded-full" />
        <Skeleton className="mt-5 h-40 w-full rounded-card" />
      </div>
    );
  }
  if (!recipe || !total) {
    return (
      <div className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-12">
        <IconButton icon={X} label="Close cooking mode" variant="outlined" onClick={back} />
        <h1 className="display mt-6 text-title text-ink">{recipe ? 'No steps to cook from' : "Couldn't load this recipe"}</h1>
        <p className="mt-2 text-body text-ink-muted">{recipe ? 'This recipe has no written steps.' : 'Check your connection, then try again.'}</p>
      </div>
    );
  }

  const title = recipeTitle(recipe);
  const current = recipe.steps[step];

  if (finished) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-column flex-col justify-center px-gutter py-10">
        <p className="label">Marked as cooked</p>
        <h1 className="display mt-2 text-display text-ink">{title} is done. Enjoy.</h1>
        <p className="mt-3 text-body text-ink-muted">How did it turn out? A rating helps us suggest what your household likes.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => replace({ name: 'rate', id })}>Rate this recipe</Button>
          <Button size="lg" variant="secondary" onClick={back}>Back to recipe</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-10">
        <div className="flex items-center gap-3">
          <IconButton icon={X} label="Close cooking mode" variant="outlined" onClick={back} />
          <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-muted">{title}</p>
        </div>
        <div className="mt-4">
          <Progress value={(step + 1) / total} label={`Step ${step + 1} of ${total}`} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-column flex-1 px-gutter pt-8 pb-6 md:pt-12">
        <p className="label" aria-live="polite">Step {step + 1} of {total}</p>
        <p className="mt-4 text-step font-medium text-ink md:text-step-lg">
          {prefs.units === 'metric' ? current.text_metric : current.text_us}
        </p>
        {current.timers.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-3">
            {current.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} size="lg" />)}
          </div>
        )}
        {error && <p role="alert" className="mt-6 text-body text-terracotta-deep">{error}</p>}
      </div>

      <div className="sticky bottom-0 bg-linear-to-t from-cream from-75% to-cream/0">
        <div className="mx-auto flex w-full max-w-column gap-3 px-gutter pt-5 pb-(--bottombar-pad)">
          <Button size="lg" variant="secondary" icon={ArrowLeft} className="h-16 flex-1" onClick={prev} disabled={step === 0}>Back</Button>
          <Button size="lg" iconEnd={last ? Check : ArrowRight} className="h-16 flex-2" onClick={next} loading={saving}>{last ? 'Done' : 'Next'}</Button>
        </div>
      </div>
    </div>
  );
}
