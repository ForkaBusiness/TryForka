import { Check } from 'lucide-react';
import { BottomSheet, Button, Checkbox, cx } from '../ds';

// Step navigation in cooking mode: every step at a glance (jump to any), the ingredients
// the current step uses, and the ingredient checklist for prepping.

export interface CookIngredient {
  /** Position in the recipe's ingredient list (the checklist and step matching use it). */
  index: number;
  name: string;
  /** Scaled to the chosen servings, in the household's units ("1 1/2 cups"); '' when none. */
  amount: string;
}

/** All steps, numbered; tapping one goes there. */
export function StepsSheet({ open, steps, current, onPick, onClose }: {
  open: boolean; steps: string[]; current: number; onPick: (step: number) => void; onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="All steps" side="bottom">
      <ol className="flex flex-col gap-2">
        {steps.map((text, i) => {
          const here = i === current;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-current={here ? 'step' : undefined}
                data-autofocus={here || undefined}
                className={cx(
                  'flex min-h-14 w-full cursor-pointer items-start gap-4 rounded-input border px-4 py-3 text-left transition-[background-color,border-color] duration-150',
                  here ? 'border-green bg-green-soft' : 'border-line bg-surface hover:border-ink-muted',
                )}
              >
                <span className={cx('tabular flex size-8 shrink-0 items-center justify-center rounded-full text-small font-bold', here ? 'bg-green text-surface' : i < current ? 'bg-line text-ink-muted' : 'border border-line text-ink')}>
                  {i < current ? <Check size={16} strokeWidth={2.5} aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">Step {i + 1}{here ? ', current' : i < current ? ', done' : ''}: </span>
                  <span className={cx('line-clamp-2 text-body', i < current ? 'text-ink-muted' : 'text-ink')}>{text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </BottomSheet>
  );
}

/** The ingredients this step uses, with their amounts, under the step. */
export function StepIngredients({ items, servings }: { items: CookIngredient[]; servings: number }) {
  if (!items.length) return null;
  return (
    <section aria-label="Ingredients for this step" className="mt-8">
      <p className="label">For this step · {servings} {servings === 1 ? 'serving' : 'servings'}</p>
      <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface">
        {items.map(ing => (
          <li key={ing.index} className="cook-detail flex min-h-14 items-center gap-4 px-5 py-3">
            <span className="min-w-0 flex-1 font-medium text-ink">{ing.name}</span>
            {ing.amount && <span className="tabular max-w-1/2 text-right font-semibold text-ink">{ing.amount}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every ingredient, to tick off while prepping. */
export function IngredientsSheet({ open, items, checked, servings, onToggle, onClear, onClose }: {
  open: boolean; items: CookIngredient[]; checked: ReadonlySet<number>; servings: number;
  onToggle: (index: number, checked: boolean) => void; onClear: () => void; onClose: () => void;
}) {
  const ready = items.filter(i => checked.has(i.index)).length;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Ingredients"
      side="bottom"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {ready > 0 && <Button size="lg" variant="secondary" onClick={onClear}>Clear ticks</Button>}
          <Button size="lg" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <p className="text-small text-ink-muted">
        <span className="tabular font-semibold text-ink">{ready} of {items.length}</span> ready · amounts for {servings} {servings === 1 ? 'serving' : 'servings'}
      </p>
      <ul className="mt-3 divide-y divide-line">
        {items.map(ing => {
          const on = checked.has(ing.index);
          return (
            <li key={ing.index} className="flex min-h-14 items-center gap-3 py-1">
              <Checkbox
                checked={on}
                onChange={v => onToggle(ing.index, v)}
                className="min-h-12 min-w-0 flex-1"
                label={
                  <span className={cx('flex items-baseline gap-3', on && 'text-ink-muted')}>
                    <span className="min-w-0 flex-1"><span className="strike" data-checked={on}>{ing.name}</span></span>
                    {ing.amount && <span className="tabular shrink-0 text-right font-semibold">{ing.amount}</span>}
                  </span>
                }
              />
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
