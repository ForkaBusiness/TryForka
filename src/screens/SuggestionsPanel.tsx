import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CalendarPlus } from 'lucide-react';
import { useApp, type SuggestionsTarget } from '../app/AppContext';
import { safeCards, similarRecipes, type RecipeCard } from '../lib/catalog';
import { isSchoolLunch, isSnack } from '../lib/meals';
import {
  DAY_LONG, emptyPlan, entryFromCard, findInPlan, getSuggestions, nextOpenSlot, planEntries, SLOT_LABEL, withSlot,
  type SuggestionPick,
} from '../lib/plan';
import { AllergyReminder } from '../components/AllergyReminder';
import { CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { RecipeCarousel } from '../components/RecipeCarousel';
import { BottomSheet, Button, ChipButton, cx, Input, ListGroup, ListRow, RecipeCard as RecipeCardView, RecipeGrid, RecipeGridSkeleton, Skeleton } from '../components/ds';

// Suggestions: prompt chips, a photo, or the whole week, with the request bar anchored to
// the bottom. Results are recipe cards. With a target slot (Swap on the meal plan) the
// options are a swipeable carousel and a pick replaces that slot instead of adding to the week.

const STARTERS = ['Under 30 minutes', "Uses what's in my fridge", 'Kid-friendly'];

export function SuggestionsPanel({ open, target, onClose }: { open: boolean; target: SuggestionsTarget | null; onClose: () => void }) {
  const { weekPlan, prefs, saveWeek, planNewWeek, go, openPhotoSearch } = useApp();
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
    if (!target) return;
    const plan = weekPlan?.plan ?? emptyPlan();
    const current = plan[target.day][target.slot];
    const exclude = planEntries(plan).map(e => e.entry.id);
    (async () => {
      const base = current ? (await safeCards([current.id], prefs))[0] ?? null : null;
      // Same kind of meal: snacks from sides and sweets, school lunches only if they pack and suit kids.
      const similar = target.slot === 'snack'
        ? [...await similarRecipes(base, 'side', exclude, prefs, 24), ...await similarRecipes(base, 'dessert', exclude, prefs, 24)].filter(isSnack).slice(0, 8)
        : target.slot === 'school_lunch'
          ? [...await similarRecipes(base, 'main', exclude, prefs, 120), ...await similarRecipes(base, 'side', exclude, prefs, 60)].filter(isSchoolLunch).slice(0, 8)
          : await similarRecipes(base, target.slot === 'breakfast' ? 'breakfast' : 'main', exclude, prefs);
      // The current recipe leads, so it shows as selected.
      setIdeas([...(base ? [base] : []), ...similar]);
    })().catch(() => setIdeas([]));
  }, [open, target, weekPlan, prefs]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true); setMessage(null);
    try {
      const exclude = weekPlan ? planEntries(weekPlan.plan).map(e => e.entry.id) : [];
      // The suggestions function knows breakfast, lunch and dinner; a school lunch asks as a lunch.
      const slot = target?.slot === 'school_lunch' ? 'lunch' : target?.slot === 'snack' ? undefined : target?.slot;
      const result = await getSuggestions(q, prefs, { slot, exclude: target ? exclude : [] });
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
    // Finding recipes by what's in the fridge is a search of our own recipes: no request needed.
    if (s === "Uses what's in my fridge") { onClose(); go({ name: 'pantry' }); return; }
    setPrompt(s);
    void ask(s);
  };

  const planWeek = async () => {
    setConfirmReplace(false); setPlanning(true); setMessage(null);
    try {
      const notice = await planNewWeek();
      setMessage({ tone: 'ok', text: `Your week is planned. The grocery list is ready too.${notice ? ` ${notice}` : ''}`, groceries: true });
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
        const before = weekPlan?.plan ?? emptyPlan();
        // A locked day stays locked when the household itself picks something else for it.
        const was = before[target.day][target.slot];
        // A school lunch keeps how many children it's packed for.
        const plan = withSlot(before, target.day, target.slot, { ...entryFromCard(r), ...(was?.locked ? { locked: true } : {}), ...(was?.share ? { share: was.share } : {}) });
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
      setMessage({ tone: 'ok', text: `Added to ${DAY_LONG[spot.day]} ${SLOT_LABEL[spot.slot].toLowerCase()}.` });
    } catch {
      setMessage({ tone: 'error', text: "Couldn't update your week. Check your connection and try again." });
    }
  };

  const inWeek = (id: number) => !!weekPlan && !!findInPlan(weekPlan.plan, id);
  const openRecipe = (id: number) => { onClose(); go({ name: 'recipe', id }); };

  // An open day has nothing to swap: the sheet is for picking.
  const filled = !!target && !!weekPlan?.plan[target.day][target.slot];
  const title = target ? `${filled ? 'Swap' : 'Pick'} ${DAY_LONG[target.day]} ${SLOT_LABEL[target.slot].toLowerCase()}` : 'Suggestions';
  const selectedId = target && weekPlan ? weekPlan.plan[target.day][target.slot]?.id : null;
  const carousel = (recipes: RecipeCard[], caption?: (r: RecipeCard) => string | undefined) => (
    <RecipeCarousel key={recipes.map(r => r.id).join()} recipes={recipes} selectedId={selectedId} onSelect={r => void choose(r)}
      onOpen={r => openRecipe(r.id)} caption={caption} label={`Recipe options for ${title.replace(/^(Swap|Pick) /, '')}`} />
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
      {!loading && (picks || (target && ideas)) && <AllergyReminder className="pt-4" />}
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
              : <p className="pt-3 text-body text-ink-muted">No other recipes fit this meal with your current settings. {CHECK_INGREDIENTS}</p>}
        </section>
      )}
    </BottomSheet>
  );
}
