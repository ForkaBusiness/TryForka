import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, Refrigerator, SearchX, ShoppingBasket } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { photo, recipeTitle, searchablePool, type SearchableRecipe } from '../lib/catalog';
import { matchRecipes } from '../lib/ingredientMatch';
import { exactOption } from '../lib/ingredientSearch';
import { useIngredientIndex } from '../lib/useIngredientIndex';
import { IngredientInput } from '../components/IngredientInput';
import { AllergyReminder } from '../components/AllergyReminder';
import { Button, Card, EmptyState, PageContainer, Photo, RecipeGrid, RecipeGridSkeleton } from '../components/ds';
import { activeOnHand, ON_HAND_DAYS } from '../lib/onHand';

// Cook with what you have: a few ingredients in, the recipes that use the most of them
// out, each saying what it uses and what it still needs. A search of our own recipes, in
// memory once they've loaded, so results change as each ingredient is added. "Plan around
// these" makes them the things to use up: the week leans toward meals that use them.

const HAVE_KEY = 'forka_have';
const MAX_SHOWN_MISSING = 4;

function savedHave(): string[] {
  try { return (JSON.parse(localStorage.getItem(HAVE_KEY) ?? '[]') as unknown[]).filter((v): v is string => typeof v === 'string'); } catch { return []; }
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CookWithWhatYouHave() {
  const { prefs, back, go, onHand, planAroundOnHand, weekPlan } = useApp();
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [planError, setPlanError] = useState(false);
  const index = useIngredientIndex();
  const [have, setHaveState] = useState<string[]>(savedHave);
  const [pool, setPool] = useState<SearchableRecipe[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const setHave = (next: string[]) => {
    setHaveState(next);
    try { localStorage.setItem(HAVE_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
  };

  useEffect(() => {
    let cancelled = false;
    setError(false);
    searchablePool(prefs).then(p => { if (!cancelled) setPool(p); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [prefs, attempt]);

  const results = useMemo(() => (pool ? matchRecipes(pool, r => r.ingredients, have) : []), [pool, have]);
  const using = activeOnHand(onHand);
  const usingThese = using.length > 0 && using.length === have.length && using.every(i => have.includes(i));
  const listed = (items: string[]) => {
    const names = items.map(i => (index && exactOption(index, i)?.label) || i).map(n => n.toLowerCase());
    return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };
  const planAround = async (items: string[]) => {
    setPlanning(true); setPlanError(false); setPlanNote(null);
    try {
      const note = await planAroundOnHand(items);
      setPlanNote(items.length ? note ?? (weekPlan ? 'Your open days already fit. New weeks will favor them too.' : 'Your next plan will favor them.') : null);
    } catch {
      setPlanError(true);
    } finally {
      setPlanning(false);
    }
  };

  const chips = have.map(v => {
    const known = index && exactOption(index, v);
    return { value: v, label: known ? known.label : sentence(v), custom: !!index && !known };
  });

  return (
    <PageContainer wide title="Cook with what you have" onBack={back} intro="Add what's in your kitchen. We'll find recipes that use the most of it.">
      <div className="mb-6">
        <IngredientInput label="What you have" placeholder="Chicken, rice, spinach" options={index}
          chips={chips} onAdd={v => setHave([...have, v])} onRemove={v => setHave(have.filter(x => x !== v))} />
      </div>

      {have.length > 0 && (
        <Card className="mb-6 p-4">
          {usingThese ? (
            <div className="flex items-start gap-3">
              <CalendarCheck size={20} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-green" />
              <div className="min-w-0 flex-1">
                <p role="status" className="text-body font-medium text-ink">Your plan is using up {listed(using)}.</p>
                {planNote && <p className="mt-1 text-small text-ink-muted">{planNote}</p>}
              </div>
              <Button variant="ghost" size="sm" loading={planning} onClick={() => void planAround([])}>Stop</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-small text-ink-muted">Want these used up? Meals that use them move up in your week, for the next {ON_HAND_DAYS} days.</p>
              <Button variant="secondary" icon={CalendarCheck} loading={planning} onClick={() => void planAround(have)}>Plan around these</Button>
            </div>
          )}
          {planError && <p role="alert" className="mt-2 text-small text-terracotta-deep">Couldn't save that. Check your connection and try again.</p>}
        </Card>
      )}

      {error ? (
        <EmptyState icon={SearchX} title="Couldn't load recipes" action={<Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState>
      ) : !have.length ? (
        <EmptyState icon={Refrigerator} title="What's in the fridge?">
          Add two or three things you'd like to use up, like leftover chicken or half a bag of spinach.
        </EmptyState>
      ) : !pool ? (
        <div aria-busy aria-label="Finding recipes"><RecipeGridSkeleton count={8} /></div>
      ) : !results.length ? (
        <EmptyState icon={SearchX} title="No recipes use those yet">
          Try another ingredient, or a simpler name, like "chicken" instead of "chicken leftovers".
        </EmptyState>
      ) : (
        <>
          <p role="status" className="mb-3 text-small text-ink-muted">
            {results.length === 1 ? '1 recipe' : `${results.length} recipes`} use{results.length === 1 ? 's' : ''} what you have, the closest first.
          </p>
          <AllergyReminder className="mb-4" />
          <RecipeGrid>
            {results.map(({ recipe: { recipe }, have: uses, missing }) => (
              <li key={recipe.id}>
                <button type="button" onClick={() => go({ name: 'recipe', id: recipe.id })}
                  className="flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-sm transition-shadow duration-150 hover:shadow-md">
                  <Photo src={photo(recipe.thumb_url, 'medium')} className="aspect-4/3 w-full" />
                  <span className="flex flex-1 flex-col gap-1.5 p-3">
                    <span className="line-clamp-2 text-body font-semibold text-ink">{recipeTitle(recipe)}</span>
                    <span className="flex gap-1 text-small font-medium text-green">
                      <Check size={16} strokeWidth={2.25} aria-hidden className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2"><span className="sr-only">You have: </span>{sentence(uses.join(', ').toLowerCase())}</span>
                    </span>
                    <span className="mt-auto flex gap-1 text-small text-ink-muted">
                      <ShoppingBasket size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">
                        {missing.length
                          ? <>Also needs {missing.slice(0, MAX_SHOWN_MISSING).join(', ').toLowerCase()}{missing.length > MAX_SHOWN_MISSING ? ` and ${missing.length - MAX_SHOWN_MISSING} more` : ''}</>
                          : 'Nothing else to buy'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </RecipeGrid>
        </>
      )}
    </PageContainer>
  );
}
