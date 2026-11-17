import { useEffect, useState } from 'react';
import type { Recipe } from '../lib/catalog';
import { recipeFacts, recipeNutrition, rounded, type RecipeNutrition } from '../lib/nutrition';
import { Card, Skeleton } from './ds';

// Nutrition for one recipe at the servings chosen: calories, protein, carbs, fat and fiber
// per serving, labeled as an estimate, and what all the servings add up to. Ingredients
// that couldn't be matched or weighed are named, never quietly left out.

const ROWS: Array<{ key: keyof RecipeNutrition['perServing']; label: string; unit: string }> = [
  { key: 'kcal', label: 'Calories', unit: '' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
];

const list = (names: string[]) => {
  const lower = [...new Set(names)].map(n => n.toLowerCase());
  return lower.length <= 1 ? lower.join('') : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
};

export function NutritionCard({ recipe, servings }: { recipe: Recipe; servings: number }) {
  // undefined while loading, null when nutrition isn't available yet, 'error' when it couldn't load.
  const [facts, setFacts] = useState<Awaited<ReturnType<typeof recipeFacts>> | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFacts(undefined);
    recipeFacts(recipe.id, recipe.ingredients).then(f => { if (!cancelled) setFacts(f); }).catch(() => { if (!cancelled) setFacts('error'); });
    return () => { cancelled = true; };
  }, [recipe, attempt]);

  if (facts === null) return null;
  const heading = <h2 id="nutrition" className="label mb-2 px-1">Estimated per serving</h2>;

  if (facts === undefined) {
    return (
      <section aria-labelledby="nutrition" aria-busy className="mt-6">
        {heading}
        <Card className="grid grid-cols-5 gap-2 p-4">{ROWS.map(r => <Skeleton key={r.key} className="h-12" />)}</Card>
      </section>
    );
  }
  if (facts === 'error') {
    return (
      <section aria-labelledby="nutrition" className="mt-6">
        {heading}
        <Card className="flex items-center justify-between gap-3 p-4">
          <p className="text-small text-ink-muted">Couldn't load nutrition. Check your connection.</p>
          <button type="button" onClick={() => setAttempt(n => n + 1)} className="shrink-0 cursor-pointer text-small font-semibold text-green hover:underline">Try again</button>
        </Card>
      </section>
    );
  }

  const n = recipeNutrition(recipe.ingredients, key => facts.get(key), servings);
  const per = rounded(n.perServing);
  const total = rounded(n.total);
  const missing = [...n.unmatched, ...n.unweighed];
  // Numbers built from almost nothing would mislead: say so instead.
  const tooLittle = n.total.kcal <= 0 || n.counted * 2 < n.ingredients - n.noAmount.length;
  if (tooLittle) {
    return (
      <section aria-labelledby="nutrition" className="mt-6">
        {heading}
        <Card className="p-4">
          <p className="text-body font-medium text-ink">Not enough to estimate</p>
          <p className="mt-1 text-small text-ink-muted">
            We couldn't match or weigh enough of the ingredients{missing.length ? ` (${list(missing)})` : ''} to give a fair number for this recipe.
          </p>
        </Card>
      </section>
    );
  }
  return (
    <section aria-labelledby="nutrition" className="mt-6">
      {heading}
      <Card className="p-4">
        <dl className="grid grid-cols-5 gap-1 text-center">
          {ROWS.map(r => (
            <div key={r.key} className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-caption text-ink-muted">{r.label}</dt>
              <dd className="tabular text-heading font-semibold text-ink">{per[r.key]}{r.unit}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-small text-ink-muted">
          All {servings} {servings === 1 ? 'serving' : 'servings'}: about {total.kcal.toLocaleString('en-US')} calories.
          {' '}From USDA FoodData Central, for the recipe as written serving 4.
        </p>
        {missing.length > 0 && (
          <p role="note" className="mt-2 text-small text-terracotta-deep">
            Not counted: {list(missing)}. We couldn't match or weigh {missing.length === 1 ? 'it' : 'them'}, so the real numbers are higher.
          </p>
        )}
        {n.noAmount.length > 0 && <p className="mt-2 text-small text-ink-muted">Listed with no amount, so not counted: {list(n.noAmount)}.</p>}
      </Card>
    </section>
  );
}
