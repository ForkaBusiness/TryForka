import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarPlus, Check, ChefHat, Clock, Download, ExternalLink, FolderPlus, Heart, ListPlus, MoreHorizontal, NotebookPen, Pencil, Printer, Star, Trash2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getRecipe, ingredientPhoto, isHouseholdRecipe, minutesLabel, photo, recipeTitle, type Recipe } from '../lib/catalog';
import { addToGroceryList, deleteRecipe, groceryLines, rowToDraft } from '../lib/householdRecipes';
import { DAY_LONG, emptyPlan, findInPlan, nextOpenSlot, withSlot } from '../lib/plan';
import { creditLine } from '../../supabase/functions/_shared/imports/social.ts';
import { recipeChecker } from '../lib/recipeFilter';
import { cookedRecently, markCooked, unmarkCooked } from '../lib/cooked';
import { formatMeasure } from '../../supabase/functions/_shared/catalog/units.ts';
import { TimerChip } from '../components/Timers';
import { HiddenRecipe } from '../components/AllergyReminder';
import { CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { BottomBar, BottomSheet, Button, Card, GlassIconButton, IconButton, ListGroup, ListRow, PageContainer, Photo, recipeTags, Segmented, Skeleton, Stepper, Tag } from '../components/ds';
import { NutritionCard } from '../components/NutritionCard';
import { PrintView } from '../components/PrintView';
import { printData } from '../lib/printData';
import { BASE_SERVINGS, MAX_SERVINGS, MIN_SERVINGS, rememberServings, servingsFor } from '../lib/nutrition';

// One screen for a recipe: a full-bleed photo with glass controls floating on it, then a
// cream sheet that overlaps the photo: name, tags, Ingredients / Steps.

type Tab = 'ingredients' | 'steps';

export function RecipeDetail({ id, initialTab }: { id: number; initialTab?: Tab }) {
  const { prefs, userId, back, go, favorites, toggleFavorite, weekPlan, saveWeek } = useApp();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  /** Set when the family's settings don't allow this recipe: it isn't shown at all. */
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'ingredients');
  // The catalog has no servings: a recipe as written serves 4. A household recipe says how
  // many it serves. Changing it rescales the amounts and the nutrition.
  const [chosenServings, setServingsState] = useState(() => servingsFor(id, 0) || null);
  const setServings = (n: number) => { setServingsState(n); rememberServings(id, n); };
  const [menu, setMenu] = useState(false);
  const [cooked, setCooked] = useState<string | null>(null);
  const [cookedBusy, setCookedBusy] = useState(false);
  const [cookedNote, setCookedNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuNote, setMenuNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecipe(undefined);
    setBlockedBy(null);
    getRecipe(id, prefs)
      .then(r => { if (!cancelled) { setBlockedBy(r?.blockedBy ?? null); setRecipe(r?.recipe ?? null); } })
      .catch(() => { if (!cancelled) setRecipe(null); });
    cookedRecently(userId, id).then(c => { if (!cancelled) setCooked(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, userId, prefs]);

  if (blockedBy) return <HiddenRecipe blockedBy={blockedBy} onBack={back} />;
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
  const own = isHouseholdRecipe(recipe);
  const baseServings = recipe.servings ?? BASE_SERVINGS;
  const servings = chosenServings ?? baseServings;
  const scale = servings / baseServings;
  // A recipe with one of the family's allergens never gets this far (it opens as hidden).
  // The per-ingredient check stays as a second look at each line.
  const allergyCheck = recipeChecker({ allergies: prefs.allergies, skip_ingredients: [] });
  const dislikeCheck = recipeChecker({ allergies: [], skip_ingredients: prefs.skip_ingredients, avoid_ingredients: prefs.avoid_ingredients });
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

  const print = printData(recipe, servings, prefs.units);
  const downloadPdf = async () => {
    setMenuNote('Making the PDF…');
    try {
      const { downloadRecipePdf } = await import('../lib/recipePdf');
      await downloadRecipePdf(print, prefs.units === 'metric' ? 'a4' : 'letter');
      setMenuNote('PDF downloaded.');
    } catch {
      setMenuNote("Couldn't make the PDF. Try again, or use Print and save as PDF.");
    }
  };

  const addToWeek = async () => {
    try {
      const plan = weekPlan?.plan ?? emptyPlan();
      const there = findInPlan(plan, recipe.id);
      if (there) { setMenuNote(`It's already on ${DAY_LONG[there.day]}.`); return; }
      const spot = nextOpenSlot(plan, false, prefs.plan_lunch);
      if (!spot) { setMenuNote('Your week is full. Swap a day on the meal plan instead.'); return; }
      await saveWeek(withSlot(plan, spot.day, spot.slot, { id: recipe.id, title, image: recipe.thumb_url ?? '' }), !weekPlan);
      setMenuNote(`Added to ${DAY_LONG[spot.day]} ${spot.slot}.`);
    } catch {
      setMenuNote("Couldn't update your week. Check your connection and try again.");
    }
  };

  const addToGroceries = async () => {
    try {
      const n = await addToGroceryList(userId, groceryLines(rowToDraft(recipe as never), prefs.units));
      setMenuNote(n ? `Added ${n} item${n === 1 ? '' : 's'} to your grocery list.` : 'Those items are already on your grocery list.');
    } catch {
      setMenuNote("Couldn't update your grocery list. Check your connection and try again.");
    }
  };

  // Out of the Library, the favorites and the week too, so nothing points at a recipe that's gone.
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteRecipe(userId, recipe.id, recipe.thumb_url);
      // The favorite row is gone; keep the app's list of favorites in step.
      if (favorites.has(recipe.id)) await toggleFavorite({ id: recipe.id, title, image: recipe.thumb_url ?? '' }).catch(() => {});
      const plan = weekPlan?.plan;
      const there = plan ? findInPlan(plan, recipe.id) : null;
      if (plan && there) await saveWeek(withSlot(plan, there.day, there.slot, null), false, { quiet: true }).catch(() => {});
      setConfirmDelete(false);
      back();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
      setMenuNote("Couldn't delete. Check your connection and try again.");
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-column flex-1 pb-6 md:px-gutter md:pt-8">
        <div className="relative">
          {recipe.thumb_url
            ? <Photo src={photo(recipe.thumb_url, 'large')} eager className="aspect-4/3 w-full md:aspect-video md:rounded-card" />
            : <div aria-hidden className="h-36 w-full bg-green-soft md:h-44 md:rounded-card" />}
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
                <Stepper label="Servings" value={servings} min={MIN_SERVINGS} max={MAX_SERVINGS} unit={n => (n === 1 ? 'serving' : 'servings')} onChange={setServings} />
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {recipe.ingredients.map((ing, i) => {
                    const item = { name: '', ingredient_names: [ing.name, ing.name_us], allergens: ing.allergens };
                    const allergy = allergyCheck(item).blockedBy;
                    const dislike = dislikeCheck(item);
                    const measure = formatMeasure({ quantity: ing.quantity, quantityMax: ing.quantity_max, unit: ing.unit, note: ing.note }, prefs.units, scale);
                    return (
                      <li key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
                        <img src={ingredientPhoto(ing.name)} alt="" loading="lazy" className="size-10 shrink-0 object-contain" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
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
              <p className="mt-3 px-1 text-small text-ink-muted">
                {prefs.allergies.length > 0 ? 'We hide recipes by their ingredient list. ' : ''}{CHECK_INGREDIENTS} Check product labels too if anyone has a severe allergy.
              </p>
              <NutritionCard recipe={recipe} servings={servings} />
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
                            {s.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} step={i + 1} />)}
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

          {own && recipe.notes && (
            <section aria-labelledby="recipe-notes" className="mt-8">
              <h2 id="recipe-notes" className="label mb-2 px-1">Notes</h2>
              <Card className="p-4"><p className="text-body whitespace-pre-line text-ink">{recipe.notes}</p></Card>
            </section>
          )}
          {own ? (
            <p className="mt-8 border-t border-line pt-4 text-small text-ink-muted">
              {recipe.source_url ? (
                <a href={recipe.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-green hover:underline">
                  {sourceCredit(recipe)}<ExternalLink size={14} strokeWidth={2} aria-hidden />
                </a>
              ) : recipe.source_kind === 'photo' ? 'Saved from your photos.' : 'Your recipe.'}
            </p>
          ) : (
            <p className="mt-8 border-t border-line pt-4 text-small text-ink-muted">
              Recipe and photo from{' '}
              <a href="https://www.themealdb.com" target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">TheMealDB</a>.
              {recipe.source_url && <>{' '}<a href={recipe.source_url} target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">See the original recipe</a>.</>}
              {recipe.youtube_url && <>{' '}<a href={recipe.youtube_url} target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">Watch the video</a>.</>}
            </p>
          )}
          {menuNote && <p role="status" className="mt-4 text-small font-semibold text-green">{menuNote}</p>}
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
          {own && <ListRow leading={<CalendarPlus size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Add to this week" onClick={() => { setMenu(false); void addToWeek(); }} />}
          {own && <ListRow leading={<ListPlus size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Add to grocery list" onClick={() => { setMenu(false); void addToGroceries(); }} />}
          <ListRow leading={<Printer size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Print" onClick={() => { setMenu(false); setTimeout(() => window.print(), 150); }} />
          <ListRow leading={<Download size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Download PDF" onClick={() => { setMenu(false); void downloadPdf(); }} />
          {own && <ListRow leading={<Pencil size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Edit recipe" chevron onClick={() => { setMenu(false); go({ name: 'editor', id: recipe.id }); }} />}
          {own && <ListRow leading={<Trash2 size={20} strokeWidth={1.75} aria-hidden />} title="Delete recipe" destructive onClick={() => { setMenu(false); setConfirmDelete(true); }} />}
        </ListGroup>
      </BottomSheet>

      <PrintView data={print} />

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this recipe?" side="bottom">
        <p className="mb-5 text-body text-ink-muted">It comes out of your Library{findInPlan(weekPlan?.plan ?? emptyPlan(), recipe.id) ? ' and your week' : ''}. This can't be undone.</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button variant="danger" loading={deleting} onClick={remove}>Delete recipe</Button>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button>
        </div>
      </BottomSheet>
    </div>
  );
}

/** "From Serious Eats", "From @handle on TikTok". */
function sourceCredit(r: Recipe): string {
  if (r.source_kind === 'social' && r.source_platform) return creditLine(r.source_platform, r.source_handle ?? null);
  if (r.source_name) return `From ${r.source_name}`;
  try { return `From ${new URL(r.source_url!).hostname.replace(/^www\./, '')}`; } catch { return 'See the original recipe'; }
}
