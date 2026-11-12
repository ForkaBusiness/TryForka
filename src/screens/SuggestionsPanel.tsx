import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CalendarPlus } from 'lucide-react';
import { useApp, type SuggestionsTarget } from '../app/AppContext';
import { getCards, similarRecipes, type RecipeCard } from '../lib/catalog';
import {
  DAY_LONG, emptyPlan, entryFromCard, findInPlan, generateWeekPlan, getSuggestions, nextOpenSlot, planEntries, withSlot,
  type SuggestionPick,
} from '../lib/plan';
import { filterRecipes } from '../lib/recipeFilter';
import { RecipeCarousel } from '../components/RecipeCarousel';
import { BottomSheet, Button, ChipButton, cx, Input, ListGroup, ListRow, RecipeCard as RecipeCardView, RecipeGrid, RecipeGridSkeleton, Skeleton } from '../components/ds';

// Suggestions: prompt chips, a photo, or the whole week, with the request bar anchored to
// the bottom. Results are recipe cards. With a target slot (Swap on the meal plan) the
// options are a swipeable carousel and a pick replaces that slot instead of adding to the week.

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

  const title = target ? `Swap ${DAY_LONG[target.day]} ${target.slot}` : 'Suggestions';
  const selectedId = target && weekPlan ? weekPlan.plan[target.day][target.slot]?.id : null;
  const carousel = (recipes: RecipeCard[], caption?: (r: RecipeCard) => string | undefined) => (
    <RecipeCarousel key={recipes.map(r => r.id).join()} recipes={recipes} selectedId={selectedId} onSelect={r => void choose(r)}
      onOpen={r => openRecipe(r.id)} caption={caption} label={`Recipe options for ${title.replace('Swap ', '')}`} />
  );
  const bar = (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        ref={inputRef}
        id="suggest-input"
        data-autofocus
        label="What sounds good?"
        hideLabel
        className="min-w-0 flex-1"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Quick chicken, nothing spicy"
        maxLength={300}
      />
      <Button type="submit" className="h-12" disabled={!prompt.trim()} loading={loading}>Suggest</Button>
    </form>
  );
  return (
    <BottomSheet open={open} onClose={onClose} title={title} footer={bar}>
      {!loading && !picks && !target && !planning && (
        <div className="mb-4">
          <p className="label mb-2 px-1">What sounds good?</p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map(s => <ChipButton key={s} onClick={() => starter(s)}>{s}</ChipButton>)}
          </div>
        </div>
      )}

      <ListGroup>
        <ListRow leading={<Camera size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Find meals like a photo" chevron
          onClick={() => { onClose(); openPhotoSearch(); }} />
        {!target && (
          <ListRow leading={<CalendarPlus size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title={planning ? 'Planning your week…' : 'Plan my whole week'} chevron
            onClick={planning ? undefined : () => (weekPlan ? setConfirmReplace(true) : void planWeek())} />
        )}
      </ListGroup>

      {confirmReplace && (
        <div role="alertdialog" aria-label="Replace this week's plan?" className="mt-4 rounded-input border border-line bg-cream p-4">
          <p className="text-body font-semibold text-ink">Replace this week's plan?</p>
          <p className="mt-1 text-small text-ink-muted">The grocery list will be rebuilt for the new meals.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={planWeek}>Replace</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReplace(false)}>Keep current plan</Button>
          </div>
        </div>
      )}

      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={cx('pt-4 text-small font-medium', message.tone === 'error' ? 'text-terracotta-deep' : 'text-green')}>
          {message.text}
          {message.groceries && (
            <span className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { onClose(); go({ name: 'mealplan' }); }}>See this week</Button>
              <Button size="sm" variant="secondary" onClick={() => { onClose(); go({ name: 'groceries' }); }}>Grocery list</Button>
            </span>
          )}
        </div>
      )}

      {planning && <p className="pt-4 text-body text-ink-muted">Picking a week of meals that fit your household…</p>}

      {loading && <div className="mt-4"><RecipeGridSkeleton count={4} compact /></div>}

      {!loading && picks && note && <p role="status" className="pt-4 text-small text-ink-muted">{note}</p>}
      {!loading && picks && (
        picks.length
          ? target
            ? <div className="mt-4">{carousel(picks.map(p => p.recipe), r => picks.find(p => p.recipe.id === r.id)?.reason)}</div>
            : (
              <RecipeGrid compact className="mt-4">
                {picks.map(p => (
                  <li key={p.recipe.id}>
                    <RecipeCardView recipe={p.recipe} note={p.reason || undefined} onOpen={() => openRecipe(p.recipe.id)}
                      added={inWeek(p.recipe.id)} onAdd={() => void choose(p.recipe)} />
                  </li>
                ))}
              </RecipeGrid>
            )
          : <p className="pt-4 text-body text-ink-muted">Nothing fits that yet. Try different words.</p>
      )}

      {!loading && !picks && target && (
        <section className="mt-5">
          <h3 className="label px-1">Options for this meal</h3>
          {ideas === null
            ? <Skeleton className="mt-3 h-80 rounded-card" />
            : ideas.length
              ? <div className="mt-3">{carousel(ideas)}</div>
              : <p className="pt-3 text-body text-ink-muted">No other recipes fit this meal with your current settings.</p>}
        </section>
      )}
    </BottomSheet>
  );
}
