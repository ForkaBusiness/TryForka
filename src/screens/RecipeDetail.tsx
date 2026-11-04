import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChefHat, FolderPlus, Heart, MoreHorizontal, NotebookPen, Star, TriangleAlert } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getRecipe, ingredientPhoto, minutesLabel, photo, recipeMeta, recipeTitle, type Recipe } from '../lib/catalog';
import { recipeChecker } from '../lib/recipeFilter';
import { cookedRecently, markCooked, unmarkCooked } from '../lib/cooked';
import { formatMeasure } from '../../supabase/functions/_shared/catalog/units.ts';
import { TimerChip } from '../components/Timers';
import { BottomBar, Button, IconButton, ListRow, Segmented, Sheet, Skeleton, Tag } from '../components/ds';

// One screen for a recipe: hero photo, name, tags, then Ingredients / Steps.

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
      <div aria-busy className="w-full max-w-[960px]">
        <Skeleton className="aspect-[4/3] w-full rounded-none md:aspect-[21/9]" />
        <div className="px-4 py-6 md:px-8"><Skeleton className="h-8 w-2/3" /><Skeleton className="mt-3 h-4 w-1/3" /></div>
      </div>
    );
  }
  if (recipe === null) {
    return (
      <div className="px-4 py-8 md:px-8">
        <IconButton icon={ArrowLeft} label="Back" onClick={back} className="-ml-2" />
        <h1 className="mt-4 text-2xl">Couldn't load this recipe</h1>
        <p className="mt-2 text-base text-ink-muted">Check your connection, then go back and try again.</p>
      </div>
    );
  }

  const title = recipeTitle(recipe);
  const allergyCheck = recipeChecker({ allergies: prefs.allergies, skip_ingredients: [] });
  const dislikeCheck = recipeChecker({ allergies: [], skip_ingredients: prefs.skip_ingredients, avoid_ingredients: prefs.avoid_ingredients });
  const hits = allergyCheck(recipe).blockedBy;
  const isFav = favorites.has(recipe.id);
  const meta = recipeMeta(recipe);
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
      <div className="w-full max-w-[960px] flex-1 pb-10">
        <div className="relative">
          <img src={photo(recipe.thumb_url, 'large')} alt="" className="aspect-[4/3] w-full bg-line/60 object-cover md:aspect-[21/9] md:rounded-b-photo" />
          <div className="absolute inset-x-0 top-0 flex justify-between p-3 md:p-4">
            <IconButton icon={ArrowLeft} label="Back" variant="overlay" onClick={back} />
            <IconButton
              icon={Heart}
              label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              pressed={isFav}
              variant="overlay"
              className={isFav ? '[&_svg]:fill-basil [&_svg]:text-basil' : ''}
              onClick={() => toggleFavorite({ id: recipe.id, title, image: recipe.thumb_url ?? '' })}
            />
          </div>
        </div>

        <div className="px-4 pt-5 md:px-8 md:pt-6">
          <h1 className="text-2xl text-ink md:text-4xl">{title}</h1>
          {recipe.subtitle && <p className="mt-1 text-base text-ink-muted">{recipe.subtitle}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {meta && <Tag>{meta}</Tag>}
            {recipe.total_minutes ? <Tag>{minutesLabel(recipe.total_minutes)}</Tag> : null}
            {recipe.category && !['Miscellaneous', 'Vegetarian', 'Vegan'].includes(recipe.category) && <Tag>{recipe.category}</Tag>}
          </div>

          {hits.length > 0 && (
            <div role="alert" className="mt-4 flex gap-2 rounded-control border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
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
              className="flex-1 md:flex-none"
            />
            <IconButton icon={MoreHorizontal} label="More options" variant="outlined" onClick={() => setMenu(true)} />
          </div>

          {tab === 'ingredients' ? (
            <section aria-label="Ingredients" className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="text-sm text-ink-muted">{recipe.ingredients.length} ingredients</p>
                <Segmented label="Recipe amount" value={multiplier} onChange={setMultiplier} options={[...MULTIPLIERS]} />
              </div>
              <ul className="border-t border-line">
                {recipe.ingredients.map((ing, i) => {
                  const item = { name: '', ingredient_names: [ing.name, ing.name_us], allergens: ing.allergens };
                  const allergy = allergyCheck(item).blockedBy;
                  const dislike = dislikeCheck(item);
                  const measure = formatMeasure({ quantity: ing.quantity, quantityMax: ing.quantity_max, unit: ing.unit, note: ing.note }, prefs.units, Number(multiplier));
                  return (
                    <li key={i} className="flex items-center gap-3 border-b border-line py-3">
                      <img src={ingredientPhoto(ing.name)} alt="" loading="lazy" className="size-10 shrink-0 rounded-photo bg-canvas object-contain" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base text-ink">{ing.name_us}</span>
                        {allergy.length > 0 && <span className="block text-sm font-semibold text-alert">Contains {allergy.map(a => a.toLowerCase()).join(', ')}</span>}
                        {!dislike.allowed && !allergy.length && <span className="block text-sm text-ink-muted">You skip this</span>}
                        {dislike.avoids.length > 0 && !allergy.length && <span className="block text-sm text-ink-muted">You'd rather avoid this</span>}
                      </span>
                      <span className="tabular max-w-[45%] text-right text-base text-ink">{measure}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-ink-muted">Check labels if anyone has a severe allergy.</p>
            </section>
          ) : (
            <section aria-label="Steps" className="mt-6">
              <ol className="space-y-6">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-4">
                    <span aria-hidden className="tabular w-6 shrink-0 font-display text-lg font-semibold text-ink-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="max-w-[65ch] text-base text-ink">{prefs.units === 'metric' ? s.text_metric : s.text_us}</p>
                      {s.timers.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {s.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} />)}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {!steps.length && <p className="text-base text-ink-muted">This recipe has no written steps.</p>}
            </section>
          )}

          <p className="mt-10 border-t border-line pt-4 text-sm text-ink-muted">
            Recipe and photo from{' '}
            <a href="https://www.themealdb.com" target="_blank" rel="noreferrer" className="font-semibold text-basil hover:underline">TheMealDB</a>.
            {recipe.source_url && <>{' '}<a href={recipe.source_url} target="_blank" rel="noreferrer" className="font-semibold text-basil hover:underline">See the original recipe</a>.</>}
            {recipe.youtube_url && <>{' '}<a href={recipe.youtube_url} target="_blank" rel="noreferrer" className="font-semibold text-basil hover:underline">Watch the video</a>.</>}
          </p>
          {cookedNote && (
            <p role="status" className="mt-4 text-sm text-basil">
              {cookedNote}{' '}
              {cooked && <button type="button" onClick={() => go({ name: 'rate', id: recipe.id })} className="cursor-pointer font-semibold underline underline-offset-2">Rate this recipe</button>}
            </p>
          )}
        </div>
      </div>

      <BottomBar>
        <Button size="lg" icon={ChefHat} className="flex-1 sm:flex-none" onClick={() => go({ name: 'cooking', id: recipe.id })} disabled={!steps.length}>Start cooking</Button>
        <Button size="lg" variant="secondary" icon={cooked ? Check : undefined} className="flex-1 sm:flex-none" loading={cookedBusy} onClick={toggleCooked}
          aria-pressed={!!cooked}>
          {cooked ? 'Cooked' : 'Mark as cooked'}
        </Button>
      </BottomBar>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Recipe options" hideTitle side="bottom">
        <div className="border-t border-line">
          <ListRow leading={<NotebookPen size={20} strokeWidth={1.75} aria-hidden />} title="Add notes" onClick={() => { setMenu(false); go({ name: 'notes', id: recipe.id }); }} />
          <ListRow leading={<Star size={20} strokeWidth={1.75} aria-hidden />} title="Rate this recipe" onClick={() => { setMenu(false); go({ name: 'rate', id: recipe.id }); }} />
          <ListRow leading={<FolderPlus size={20} strokeWidth={1.75} aria-hidden />} title="Add to collection" onClick={() => { setMenu(false); go({ name: 'collections', id: recipe.id }); }} />
        </div>
      </Sheet>
    </div>
  );
}
