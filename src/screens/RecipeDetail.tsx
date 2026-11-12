import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChefHat, Clock, FolderPlus, Heart, MoreHorizontal, NotebookPen, Star, TriangleAlert } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getRecipe, ingredientPhoto, minutesLabel, photo, recipeTitle, type Recipe } from '../lib/catalog';
import { recipeChecker } from '../lib/recipeFilter';
import { cookedRecently, markCooked, unmarkCooked } from '../lib/cooked';
import { formatMeasure } from '../../supabase/functions/_shared/catalog/units.ts';
import { TimerChip } from '../components/Timers';
import { BottomBar, BottomSheet, Button, Card, GlassIconButton, IconButton, ListGroup, ListRow, PageContainer, Photo, recipeTags, Segmented, Skeleton, Tag } from '../components/ds';

// One screen for a recipe: a full-bleed photo with glass controls floating on it, then a
// cream sheet that overlaps the photo: name, tags, Ingredients / Steps.

type Tab = 'ingredients' | 'steps';
const MULTIPLIERS = [{ value: '1', label: '1x' }, { value: '2', label: '2x' }, { value: '3', label: '3x' }] as const;

export function RecipeDetail({ id, initialTab }: { id: number; initialTab?: Tab }) {
  const { prefs, userId, back, go, favorites, toggleFavorite } = useApp();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'ingredients');
  const [multiplier, setMultiplier] = useState<'1' | '2' | '3'>('1');
  const [menu, setMenu] = useState(false);
  const [cooked, setCooked] = useState<string | null>(null);
  const [cookedBusy, setCookedBusy] = useState(false);
  const [cookedNote, setCookedNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecipe(undefined);
    getRecipe(id).then(r => { if (!cancelled) setRecipe(r); }).catch(() => { if (!cancelled) setRecipe(null); });
    cookedRecently(userId, id).then(c => { if (!cancelled) setCooked(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, userId]);

  if (recipe === undefined) {
    return (
      <div aria-busy aria-label="Loading recipe" className="mx-auto w-full max-w-column md:px-gutter md:pt-8">
        <Skeleton className="aspect-4/3 w-full rounded-none md:aspect-video md:rounded-card" />
        <div className="relative -mt-7 rounded-t-sheet bg-cream px-gutter pt-7">
          <Skeleton className="h-8 w-2/3 rounded-full" />
          <Skeleton className="mt-4 h-7 w-1/2 rounded-full" />
          <Skeleton className="mt-8 h-11 w-full rounded-full" />
          <Skeleton className="mt-6 h-48 w-full rounded-card" />
        </div>
      </div>
    );
  }
  if (recipe === null) {
    return (
      <PageContainer title="Couldn't load this recipe" onBack={back}>
        <p className="text-body text-ink-muted">Check your connection, then go back and try again.</p>
      </PageContainer>
    );
  }

  const title = recipeTitle(recipe);
  const allergyCheck = recipeChecker({ allergies: prefs.allergies, skip_ingredients: [] });
  const dislikeCheck = recipeChecker({ allergies: [], skip_ingredients: prefs.skip_ingredients, avoid_ingredients: prefs.avoid_ingredients });
  const hits = allergyCheck(recipe).blockedBy;
  const isFav = favorites.has(recipe.id);
  const tags = recipeTags(recipe);
  const steps = recipe.steps;

  const toggleCooked = async () => {
    setCookedBusy(true);
    try {
      if (cooked) { await unmarkCooked(userId, recipe.id); setCooked(null); setCookedNote(null); }
      else { setCooked(await markCooked(userId, recipe.id)); setCookedNote('Marked as cooked.'); }
    } catch {
      setCookedNote("Couldn't save. Check your connection and try again.");
    } finally {
      setCookedBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-column flex-1 pb-6 md:px-gutter md:pt-8">
        <div className="relative">
          <Photo src={photo(recipe.thumb_url, 'large')} eager className="aspect-4/3 w-full md:aspect-video md:rounded-card" />
          <div className="absolute inset-x-0 top-0 flex justify-between px-gutter pt-(--screen-top) md:p-4">
            <GlassIconButton icon={ArrowLeft} label="Back" onClick={back} />
            <GlassIconButton
              icon={Heart}
              label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              pressed={isFav}
              onClick={() => toggleFavorite({ id: recipe.id, title, image: recipe.thumb_url ?? '' })}
            />
          </div>
        </div>

        <div className="relative -mt-7 rounded-t-sheet bg-cream px-gutter pt-7">
          <h1 className="display text-title text-ink md:text-display">{title}</h1>
          {recipe.subtitle && <p className="mt-1 text-body text-ink-muted">{recipe.subtitle}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {recipe.total_minutes ? <Tag icon={Clock}>{minutesLabel(recipe.total_minutes)}</Tag> : null}
            {tags.map(t => <Tag key={t}>{t}</Tag>)}
            {recipe.category && !['Miscellaneous', 'Vegetarian', 'Vegan'].includes(recipe.category) && <Tag>{recipe.category}</Tag>}
          </div>

          {hits.length > 0 && (
            <div role="alert" className="mt-4 flex gap-2 rounded-input border border-terracotta bg-terracotta-soft p-3 text-small font-medium text-terracotta-deep">
              <TriangleAlert size={20} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span>Contains {hits.map(h => h.toLowerCase()).join(' and ')}, which you marked as an allergy.</span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-2">
            <Segmented
              label="Recipe section"
              value={tab}
              onChange={setTab}
              options={[{ value: 'ingredients', label: 'Ingredients' }, { value: 'steps', label: 'Steps' }]}
              className="flex-1"
            />
            <IconButton icon={MoreHorizontal} label="More options" variant="outlined" onClick={() => setMenu(true)} />
          </div>

          {tab === 'ingredients' ? (
            <section aria-label="Ingredients" className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="label px-1">{recipe.ingredients.length} ingredients</p>
                <Segmented label="Recipe amount" value={multiplier} onChange={setMultiplier} options={[...MULTIPLIERS]} />
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {recipe.ingredients.map((ing, i) => {
                    const item = { name: '', ingredient_names: [ing.name, ing.name_us], allergens: ing.allergens };
                    const allergy = allergyCheck(item).blockedBy;
                    const dislike = dislikeCheck(item);
                    const measure = formatMeasure({ quantity: ing.quantity, quantityMax: ing.quantity_max, unit: ing.unit, note: ing.note }, prefs.units, Number(multiplier));
                    return (
                      <li key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
                        <img src={ingredientPhoto(ing.name)} alt="" loading="lazy" className="size-10 shrink-0 object-contain" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-body text-ink">{ing.name_us}</span>
                          {allergy.length > 0 && <span className="block text-small font-semibold text-terracotta-deep">Contains {allergy.map(a => a.toLowerCase()).join(', ')}</span>}
                          {!dislike.allowed && !allergy.length && <span className="block text-small text-ink-muted">You skip this</span>}
                          {dislike.avoids.length > 0 && !allergy.length && <span className="block text-small text-ink-muted">You'd rather avoid this</span>}
                        </span>
                        <span className="tabular max-w-2/5 text-right text-body font-medium text-ink">{measure}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <p className="mt-3 px-1 text-small text-ink-muted">Check labels if anyone has a severe allergy.</p>
            </section>
          ) : (
            <section aria-label="Steps" className="mt-6">
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <li key={i}>
                    <Card className="flex gap-4 p-4">
                      <span aria-hidden className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-green-soft text-small font-bold text-green">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-ink">{prefs.units === 'metric' ? s.text_metric : s.text_us}</p>
                        {s.timers.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {s.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} />)}
                          </div>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
              {!steps.length && <p className="text-body text-ink-muted">This recipe has no written steps.</p>}
            </section>
          )}

          <p className="mt-8 border-t border-line pt-4 text-small text-ink-muted">
            Recipe and photo from{' '}
            <a href="https://www.themealdb.com" target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">TheMealDB</a>.
            {recipe.source_url && <>{' '}<a href={recipe.source_url} target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">See the original recipe</a>.</>}
            {recipe.youtube_url && <>{' '}<a href={recipe.youtube_url} target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">Watch the video</a>.</>}
          </p>
          {cookedNote && (
            <p role="status" className="mt-4 text-small font-semibold text-green">
              {cookedNote}{' '}
              {cooked && <button type="button" onClick={() => go({ name: 'rate', id: recipe.id })} className="cursor-pointer underline underline-offset-2">Rate this recipe</button>}
            </p>
          )}
        </div>
      </div>

      <BottomBar>
        <Button size="lg" icon={ChefHat} className="flex-1 sm:min-w-56 sm:flex-none" onClick={() => go({ name: 'cooking', id: recipe.id })} disabled={!steps.length}>Start cooking</Button>
        <Button size="lg" variant="secondary" icon={cooked ? Check : undefined} loading={cookedBusy} onClick={toggleCooked}
          aria-pressed={!!cooked}>
          {cooked ? 'Cooked' : 'Mark as cooked'}
        </Button>
      </BottomBar>

      <BottomSheet open={menu} onClose={() => setMenu(false)} title="Recipe options" hideTitle side="bottom">
        <ListGroup>
          <ListRow leading={<NotebookPen size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Add notes" chevron onClick={() => { setMenu(false); go({ name: 'notes', id: recipe.id }); }} />
          <ListRow leading={<Star size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Rate this recipe" chevron onClick={() => { setMenu(false); go({ name: 'rate', id: recipe.id }); }} />
          <ListRow leading={<FolderPlus size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Add to collection" chevron onClick={() => { setMenu(false); go({ name: 'collections', id: recipe.id }); }} />
        </ListGroup>
      </BottomSheet>
    </div>
  );
}
