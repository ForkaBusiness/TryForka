import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BottomSheet, Button, Skeleton, Tag, cx } from '../ds';
import { useApp } from '../../app/AppContext';
import { askSwaps, askVariations, localSwaps, type HelpAnswer, type Swap, type Variation } from '../../lib/cookingHelp';
import type { FoodPrefs } from '../../lib/recipeFilter';
import type { UnitSystem } from '../../../supabase/functions/_shared/catalog/units.ts';
import type { HelpIngredient } from '../../../supabase/functions/_shared/cooking/help.ts';
import type { CookIngredient } from './StepNav';

// Cooking help sheets: "Missing something?" (swaps for one ingredient) and "Make it
// different" (variations on the recipe). Every state is designed: picking, loading, the
// answer, nothing safe to suggest, today's help used up, and couldn't connect.

/** "1 cup buttermilk", "1 sliced onion"; "salt and pepper to taste" when the amount isn't a number. */
const usesLine = (i: CookIngredient) => (/^[\d½⅓⅔¼¾]/.test(i.amount) ? `${i.amount} ${i.name.toLowerCase()}` : `${i.name.toLowerCase()} ${i.amount}`);

const FILTER_NOTE = "We leave out anything anyone at your table is allergic to or never eats. Check labels if anyone's allergy is severe.";

function Loading({ text }: { text: string }) {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <p role="status" className="text-body text-ink-muted">{text}</p>
      <Skeleton className="h-20 w-full rounded-card" />
      <Skeleton className="h-20 w-full rounded-card" />
    </div>
  );
}

function Problem({ answer, onRetry, tableNote }: { answer: Exclude<HelpAnswer<object>, { status: 'ok' }>; onRetry: () => void; tableNote?: boolean }) {
  const { billing } = useApp();
  return (
    <div role="alert" className="rounded-card border border-line bg-surface p-5">
      <p className="text-body font-semibold text-ink">{answer.message}</p>
      {answer.status === 'capped' ? (
        <>
          {tableNote && <p className="mt-2 text-small text-ink-muted">Swaps for buttermilk, eggs, butter, sour cream, wine and herbs still work any time.</p>}
          {billing.plan !== 'pro' && <Button variant="secondary" className="mt-4" onClick={() => billing.upgrade('cooking_help')}>See what Pro adds</Button>}
        </>
      ) : (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}

type SwapState = { status: 'loading' } | HelpAnswer<{ missing: string; swaps: Swap[] }>;

/**
 * "Missing something?": pick the ingredient (the step's come first), then swaps that work
 * in this recipe at the chosen servings. Opened on one ingredient, it goes straight there.
 */
export function MissingSheet({ open, start, ingredients, raw, inStep, recipeId, servings, scale, units, prefs, onClose }: {
  open: boolean;
  /** The ingredient it was opened on, or null to pick one. */
  start: number | null;
  ingredients: CookIngredient[];
  raw: HelpIngredient[];
  /** Indexes of the ingredients the current step uses. */
  inStep: number[];
  recipeId: number; servings: number; scale: number; units: UnitSystem; prefs: FoodPrefs;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(start);
  const [state, setState] = useState<SwapState | null>(null);
  const request = useRef(0);

  const ask = (index: number) => {
    setPicked(index);
    const local = localSwaps(raw[index], scale, units, prefs);
    if (local) { setState({ status: 'ok', ...local }); return; }
    const id = ++request.current;
    setState({ status: 'loading' });
    void askSwaps({ recipeId, ingredient: index, servings, units, prefs }).then(r => { if (id === request.current) setState(r); });
  };
  // Each time it opens: on the given ingredient, or on the list.
  useEffect(() => {
    if (!open) { request.current++; return; }
    if (start !== null) ask(start); else { setPicked(null); setState(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, start]);

  const name = picked !== null ? ingredients[picked]?.name ?? '' : '';
  const rest = ingredients.filter(i => !inStep.includes(i.index));
  const row = (i: CookIngredient) => (
    <li key={i.index}>
      <button type="button" onClick={() => ask(i.index)} className="flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-input px-4 py-2 text-left hover:bg-green-soft">
        <span className="min-w-0 flex-1 text-body text-ink">{i.name}</span>
        {i.amount && <span className="tabular shrink-0 text-small text-ink-muted">{i.amount}</span>}
      </button>
    </li>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Missing something?" side="bottom"
      footer={picked !== null ? (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button size="lg" variant="secondary" icon={ArrowLeft} onClick={() => { request.current++; setPicked(null); setState(null); }}>Another ingredient</Button>
          <Button size="lg" onClick={onClose}>Back to cooking</Button>
        </div>
      ) : undefined}
    >
      {picked === null ? (
        <div>
          <p className="text-body text-ink-muted">Pick what you're out of. We'll suggest swaps that work in this recipe.</p>
          {inStep.length > 0 && (
            <>
              <p className="label mt-5 mb-1 px-1">In this step</p>
              <ul className="divide-y divide-line">{ingredients.filter(i => inStep.includes(i.index)).map(row)}</ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              <p className="label mt-5 mb-1 px-1">{inStep.length ? 'Everything else' : 'Ingredients'}</p>
              <ul className="divide-y divide-line">{rest.map(row)}</ul>
            </>
          )}
        </div>
      ) : (
        <div>
          <h3 className="text-heading font-semibold text-ink">No {state?.status === 'ok' ? state.missing : name.toLowerCase()}?</h3>
          {ingredients[picked]?.amount && <p className="mt-1 text-small text-ink-muted">The recipe uses {usesLine(ingredients[picked])}, for {servings} {servings === 1 ? 'serving' : 'servings'}.</p>}
          <div className="mt-4">
            {(!state || state.status === 'loading') && <Loading text="Finding swaps that work in this recipe." />}
            {state && (state.status === 'capped' || state.status === 'failed') && <Problem answer={state} onRetry={() => ask(picked)} tableNote />}
            {state?.status === 'ok' && (state.swaps.length ? (
              <ul className="flex flex-col gap-3">
                {state.swaps.map((s, i) => (
                  <li key={i} className="rounded-card border border-line bg-surface p-5">
                    <p className="cook-detail font-semibold text-ink">{s.use}</p>
                    {s.how && <p className="mt-1 text-body text-ink-muted">{s.how}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div role="status" className="rounded-card border border-line bg-surface p-5">
                <p className="text-body font-semibold text-ink">Nothing we found is safe for everyone at your table.</p>
                <p className="mt-2 text-body text-ink-muted">If the dish can do without it, leave it out, or add it to the next shop.</p>
              </div>
            ))}
            {state?.status === 'ok' && state.swaps.length > 0 && <p className="mt-4 text-small text-ink-muted">{FILTER_NOTE}</p>}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

type VariationState = { status: 'loading' } | HelpAnswer<{ variations: Variation[]; onHand: string[] }>;

const usesOnHand = (v: Variation, onHand: string[]) => {
  const have = onHand.map(o => o.toLowerCase());
  return v.adds.filter(a => have.some(h => a.toLowerCase().includes(h) || h.includes(a.toLowerCase())));
};

/** "Make it different": a few variations on the recipe, each with what changes. */
export function VariationsSheet({ open, recipeId, servings, units, prefs, onClose }: {
  open: boolean; recipeId: number; servings: number; units: UnitSystem; prefs: FoodPrefs; onClose: () => void;
}) {
  const [state, setState] = useState<VariationState>({ status: 'loading' });
  const request = useRef(0);
  const asked = useRef(false);
  const load = () => {
    asked.current = true;
    const id = ++request.current;
    setState({ status: 'loading' });
    void askVariations({ recipeId, servings, units, prefs }).then(r => { if (id === request.current) setState(r); });
  };
  // Asked the first time it opens, and kept for this visit: closing and opening it again
  // (even while it's still looking) doesn't ask again or count again. A failure asks again.
  useEffect(() => {
    if (open && (!asked.current || state.status === 'failed')) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Make it different" side="bottom"
      footer={<div className="flex justify-end"><Button size="lg" className="w-full sm:w-auto" onClick={onClose}>Back to cooking</Button></div>}
    >
      {state.status === 'loading' && <Loading text="Finding a few ways to change it up, with what your family likes and has on hand." />}
      {(state.status === 'capped' || state.status === 'failed') && <Problem answer={state} onRetry={load} />}
      {state.status === 'ok' && (state.variations.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {state.variations.map((v, i) => {
              const have = usesOnHand(v, state.onHand);
              return (
                <li key={i} className="rounded-card border border-line bg-surface p-5">
                  <h3 className="text-heading font-semibold text-ink">{v.title}</h3>
                  <p className="mt-1 text-body text-ink-muted">{v.summary}</p>
                  {have.length > 0 && <Tag tone="green" className="mt-3">Uses what you have: {have.join(', ')}</Tag>}
                  <p className="label mt-4">What changes</p>
                  <ol className="mt-2 flex flex-col gap-2">
                    {v.changes.map((c, j) => (
                      <li key={j} className="flex gap-3 text-body text-ink">
                        <span aria-hidden className={cx('tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-green-soft text-caption font-bold text-green')}>{j + 1}</span>
                        <span className="min-w-0 flex-1">{c}</span>
                      </li>
                    ))}
                  </ol>
                  {v.removes.length > 0 && <p className="mt-3 text-small text-ink-muted">Leaves out: {v.removes.join(', ')}</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-small text-ink-muted">{FILTER_NOTE}</p>
        </>
      ) : (
        <div role="status" className="rounded-card border border-line bg-surface p-5">
          <p className="text-body font-semibold text-ink">We couldn't find a change that's safe for everyone at your table.</p>
          <p className="mt-2 text-body text-ink-muted">The recipe as it is still works.</p>
        </div>
      ))}
    </BottomSheet>
  );
}
