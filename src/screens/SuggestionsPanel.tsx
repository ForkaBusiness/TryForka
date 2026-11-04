import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CalendarPlus, Check, Plus } from 'lucide-react';
import { useApp, type SuggestionsTarget } from '../app/AppContext';
import { getCards, photo, recipeTitle, similarRecipes, type RecipeCard } from '../lib/catalog';
import {
  DAY_LONG, emptyPlan, entryFromCard, findInPlan, generateWeekPlan, getSuggestions, nextOpenSlot, planEntries, withSlot,
  type SuggestionPick,
} from '../lib/plan';
import { filterRecipes } from '../lib/recipeFilter';
import { RecipeCarousel } from '../components/RecipeCarousel';
import { Button, ChipButton, Sheet, Skeleton } from '../components/ds';

// Suggestions: a text request, a photo, or the whole week. With a target slot (Swap on
// the meal plan) the options are a swipeable carousel and a pick replaces that slot
// instead of adding to the week.

const STARTERS = ['Under 30 minutes', "Uses what's in my fridge", 'Kid-friendly'];

export function SuggestionsPanel({ open, target, onClose }: { open: boolean; target: SuggestionsTarget | null; onClose: () => void }) {
  const { weekPlan, prefs, saveWeek, setPlanReview, go, openPhotoSearch } = useApp();
  const [prompt, setPrompt] = useState('');
  const [picks, setPicks] = useState<SuggestionPick[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<RecipeCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string; groceries?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh state each time it opens; in swap mode, start with similar safe options.
  useEffect(() => {
    if (!open) return;
    setPicks(null); setNote(null); setMessage(null); setPrompt(''); setConfirmReplace(false); setIdeas(null);
    if (!target || !weekPlan) return;
    const current = weekPlan.plan[target.day][target.slot];
    const exclude = planEntries(weekPlan.plan).map(e => e.entry.id);
    (async () => {
      const base = current ? (await getCards([current.id])).get(current.id) ?? null : null;
      const similar = await similarRecipes(base, target.slot === 'breakfast' ? 'breakfast' : 'main', exclude, prefs);
      // The current recipe leads, so it shows as selected.
      setIdeas([...(base ? filterRecipes([base], prefs) : []), ...similar]);
    })().catch(() => setIdeas([]));
  }, [open, target, weekPlan, prefs]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true); setMessage(null);
    try {
      const exclude = weekPlan ? planEntries(weekPlan.plan).map(e => e.entry.id) : [];
      const result = await getSuggestions(q, prefs, { slot: target?.slot, exclude: target ? exclude : [] });
      setPicks(result.picks);
      setNote(result.note);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : "Couldn't get suggestions. Try again." });
    } finally {
      setLoading(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(prompt); };

  const starter = (s: string) => {
    if (s === "Uses what's in my fridge") {
      setPrompt('Uses what I have: ');
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(99, 99); });
      return;
    }
    setPrompt(s);
    void ask(s);
  };

  const planWeek = async () => {
    setConfirmReplace(false); setPlanning(true); setMessage(null);
    try {
      const week = await generateWeekPlan(prefs);
      await saveWeek(week.plan, true);
      setPlanReview({ notice: week.notice, blocked: week.blocked });
      setMessage({ tone: 'ok', text: `Your week is planned. The grocery list is ready too.${week.notice ? ` ${week.notice}` : ''}`, groceries: true });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : "Couldn't plan your week. Try again." });
    } finally {
      setPlanning(false);
    }
  };

  /** Swap mode: replace the slot. Otherwise: add to the next open slot, or remove if it's already in. */
  const choose = async (r: RecipeCard) => {
    setMessage(null);
    try {
      if (target) {
        const plan = withSlot(weekPlan?.plan ?? emptyPlan(), target.day, target.slot, entryFromCard(r));
        await saveWeek(plan, !weekPlan);
        onClose();
        return;
      }
      const plan = weekPlan?.plan ?? emptyPlan();
      const existing = findInPlan(plan, r.id);
      if (existing) {
        await saveWeek(withSlot(plan, existing.day, existing.slot, null), false);
        return;
      }
      const spot = nextOpenSlot(plan, r.meal_role === 'breakfast', prefs.plan_lunch);
      if (!spot) {
        setMessage({ tone: 'error', text: 'Your week is full. Swap a day on the meal plan instead.' });
        return;
      }
      await saveWeek(withSlot(plan, spot.day, spot.slot, entryFromCard(r)), !weekPlan);
      setMessage({ tone: 'ok', text: `Added to ${DAY_LONG[spot.day]} ${spot.slot}.` });
    } catch {
      setMessage({ tone: 'error', text: "Couldn't update your week. Check your connection and try again." });
    }
  };

  const inWeek = (id: number) => !!weekPlan && !!findInPlan(weekPlan.plan, id);
  const openRecipe = (id: number) => { onClose(); go({ name: 'recipe', id }); };

  const row = (r: RecipeCard, reason?: string) => {
    const added = !target && inWeek(r.id);
    return (
      <li key={r.id} className="flex items-center gap-3 border-b border-line py-3">
        <button type="button" onClick={() => openRecipe(r.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
          <span className="size-16 shrink-0 overflow-hidden rounded-photo bg-line/60">
            {r.thumb_url && <img src={photo(r.thumb_url, 'small')} alt="" className="size-full object-cover" />}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-md font-semibold tracking-[-0.01em] text-ink">{recipeTitle(r)}</span>
            <span className="block text-sm text-ink-muted">{reason || r.subtitle}</span>
          </span>
        </button>
        {target ? (
          <Button size="sm" variant="secondary" onClick={() => choose(r)}>Use this</Button>
        ) : (
          <Button size="sm" variant={added ? 'quiet' : 'secondary'} icon={added ? Check : Plus} onClick={() => choose(r)}
            aria-label={added ? `${recipeTitle(r)} is in your week. Remove it` : `Add ${recipeTitle(r)} to week`}>
            {added ? 'In week' : 'Add'}
          </Button>
        )}
      </li>
    );
  };

  const title = target ? `Swap ${DAY_LONG[target.day]} ${target.slot}` : 'Suggestions';
  const selectedId = target && weekPlan ? weekPlan.plan[target.day][target.slot]?.id : null;
  const carousel = (recipes: RecipeCard[], caption?: (r: RecipeCard) => string | undefined) => (
    <RecipeCarousel key={recipes.map(r => r.id).join()} recipes={recipes} selectedId={selectedId} onSelect={r => void choose(r)}
      onOpen={r => openRecipe(r.id)} caption={caption} label={`Recipe options for ${title.replace('Swap ', '')}`} />
  );
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="suggest-input" className="sr-only">What sounds good?</label>
        <input
          ref={inputRef}
          id="suggest-input"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="What sounds good? e.g. quick chicken, nothing spicy"
          maxLength={300}
          className="h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 text-base outline-none focus:border-basil focus:ring-2 focus:ring-basil/25"
        />
        <Button type="submit" size="md" className="h-12" disabled={!prompt.trim()} loading={loading}>Suggest</Button>
      </form>

      <div className="mt-3 flex flex-col gap-1 border-b border-line pb-3">
        <Button variant="quiet" icon={Camera} className="justify-start px-2" onClick={() => { onClose(); openPhotoSearch(); }}>Find meals like a photo</Button>
        {!target && (
          <Button variant="quiet" icon={CalendarPlus} className="justify-start px-2" loading={planning}
            onClick={() => (weekPlan ? setConfirmReplace(true) : void planWeek())}>
            Plan my whole week
          </Button>
        )}
      </div>

      {confirmReplace && (
        <div role="alertdialog" aria-label="Replace this week's plan?" className="border-b border-line py-4">
          <p className="text-base font-semibold text-ink">Replace this week's plan?</p>
          <p className="mt-1 text-sm text-ink-muted">The grocery list will be rebuilt for the new meals.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={planWeek}>Replace</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReplace(false)}>Keep current plan</Button>
          </div>
        </div>
      )}

      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`py-3 text-sm ${message.tone === 'error' ? 'text-alert' : 'text-basil'}`}>
          {message.text}
          {message.groceries && (
            <span className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { onClose(); go({ name: 'mealplan' }); }}>See this week</Button>
              <Button size="sm" variant="secondary" onClick={() => { onClose(); go({ name: 'groceries' }); }}>Grocery list</Button>
            </span>
          )}
        </div>
      )}

      {planning && <p className="py-4 text-base text-ink-muted">Picking a week of meals that fit your household…</p>}

      {loading && (
        <ul aria-hidden className="mt-2">
          {[0, 1, 2, 3].map(i => (
            <li key={i} className="flex items-center gap-3 border-b border-line py-3">
              <Skeleton className="size-16" /><span className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/2" /></span>
            </li>
          ))}
        </ul>
      )}

      {!loading && picks && note && <p role="status" className="pt-3 text-sm text-ink-muted">{note}</p>}
      {!loading && picks && (
        picks.length
          ? target
            ? <div className="mt-3">{carousel(picks.map(p => p.recipe), r => picks.find(p => p.recipe.id === r.id)?.reason)}</div>
            : <ul className="mt-1">{picks.map(p => row(p.recipe, p.reason))}</ul>
          : <p className="py-4 text-base text-ink-muted">Nothing fits that yet. Try different words.</p>
      )}

      {!loading && !picks && target && (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-ink-muted">Options for this meal</h3>
          {ideas === null
            ? <Skeleton className="mt-3 h-80" />
            : ideas.length
              ? <div className="mt-3">{carousel(ideas)}</div>
              : <p className="py-4 text-base text-ink-muted">No other recipes fit this meal with your current settings.</p>}
        </section>
      )}

      {!loading && !picks && !target && !planning && (
        <div className="mt-4 flex flex-wrap gap-2">
          {STARTERS.map(s => <ChipButton key={s} onClick={() => starter(s)}>{s}</ChipButton>)}
        </div>
      )}
    </Sheet>
  );
}
