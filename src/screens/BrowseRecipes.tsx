import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Search, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { availableFilters, browseRecipes, BROWSE_FILTERS, type BrowseFilter, type RecipeCard } from '../lib/catalog';
import { DAY_LONG, emptyPlan, entryFromCard, findInPlan, nextOpenSlot, withSlot } from '../lib/plan';
import { filterRecipes } from '../lib/recipeFilter';
import { Button, IconButton, PageContainer, RecipeTile, Skeleton, ToggleChip } from '../components/ds';

// Build a meal plan: browse the catalog (already filtered for the household's
// allergies, diet and skipped ingredients) and add recipes to the week with "+".

const PAGE = 36;
const HINT_KEY = 'forka_browse_hint_dismissed';

export function BrowseRecipes() {
  const { weekPlan, prefs, saveWeek, go, favorites, toggleFavorite, openSuggestions, openPhotoSearch } = useApp();
  const [filter, setFilter] = useState<BrowseFilter>('All');
  const [filters, setFilters] = useState<BrowseFilter[]>([...BROWSE_FILTERS]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState<RecipeCard[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; } });
  const request = useRef(0);
  // `recipes` keeps the raw pages so "Show more" counts from the right place.
  const visible = useMemo(() => recipes && filterRecipes(recipes, prefs), [recipes, prefs]);

  useEffect(() => { availableFilters().then(setFilters).catch(() => {}); }, [prefs]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const req = ++request.current;
    setRecipes(null);
    setError(null);
    browseRecipes({ filter, search: query, limit: PAGE })
      .then(rows => { if (req === request.current) { setRecipes(rows); setMore(rows.length === PAGE); } })
      .catch(() => { if (req === request.current) setError("Couldn't load recipes. Check your connection and try again."); });
  }, [filter, query, prefs]);

  const loadMore = async () => {
    if (!recipes) return;
    setLoadingMore(true);
    try {
      const rows = await browseRecipes({ filter, search: query, limit: PAGE, offset: recipes.length });
      setRecipes([...recipes, ...rows]);
      setMore(rows.length === PAGE);
    } catch {
      setError("Couldn't load more recipes. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleWeek = async (r: RecipeCard) => {
    setStatus(null);
    const plan = weekPlan?.plan ?? emptyPlan();
    const existing = findInPlan(plan, r.id);
    try {
      if (existing) {
        await saveWeek(withSlot(plan, existing.day, existing.slot, null), false);
        setStatus(`Removed from ${DAY_LONG[existing.day]}.`);
        return;
      }
      const spot = nextOpenSlot(plan, r.meal_role === 'breakfast', prefs.plan_lunch);
      if (!spot) { setStatus('Your week is full. Swap a day on the meal plan instead.'); return; }
      await saveWeek(withSlot(plan, spot.day, spot.slot, entryFromCard(r)), !weekPlan);
      setStatus(`Added to ${DAY_LONG[spot.day]} ${spot.slot}.`);
    } catch {
      setStatus("Couldn't update your week. Check your connection and try again.");
    }
  };

  const dismissHint = () => {
    setHint(false);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <PageContainer title="Build a meal plan" onBack={() => go({ name: 'mealplan' })} backLabel="Back to meal plan">
      {hint && (
        <div className="-mt-3 mb-5 flex items-start gap-2 text-base text-ink-muted">
          <p className="flex-1">
            Tap + to add recipes to your week, or let{' '}
            <button type="button" onClick={() => openSuggestions()} className="cursor-pointer font-semibold text-basil hover:underline">Suggestions</button>
            {' '}plan it for you.
          </p>
          <IconButton icon={X} label="Dismiss tip" size={36} onClick={dismissHint} />
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={20} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
          <label htmlFor="recipe-search" className="sr-only">Search recipes</label>
          <input
            id="recipe-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes"
            className="h-12 w-full rounded-control border border-line bg-surface pr-4 pl-11 text-base outline-none focus:border-basil focus:ring-2 focus:ring-basil/25"
          />
        </div>
        <IconButton icon={Camera} label="Find meals like a photo" variant="outlined" size={44} className="size-12" onClick={openPhotoSearch} />
      </div>

      <div role="radiogroup" aria-label="Filter recipes" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {filters.map(f => <ToggleChip key={f} role="radio" selected={filter === f} onToggle={() => setFilter(f)}>{f}</ToggleChip>)}
      </div>

      {prefs.allergies.length === 0 && (
        <p className="mb-5 text-sm text-ink-muted">
          <button type="button" onClick={() => go({ name: 'settings' })} className="cursor-pointer font-semibold text-basil hover:underline">Add allergies in Settings</button>
          {' '}and we'll hide recipes that contain them.
        </p>
      )}

      <p role="status" aria-live="polite" className="mb-3 min-h-5 text-sm text-basil">{status}</p>
      {error && <p role="alert" className="mb-4 text-sm text-alert">{error}</p>}

      {recipes === null && !error ? (
        <div aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <div key={i}><Skeleton className="aspect-square" /><Skeleton className="mt-2 h-4 w-3/4" /></div>)}
        </div>
      ) : visible && visible.length === 0 && !more ? (
        <p className="border-y border-line py-8 text-base text-ink-muted">
          No recipes match{query ? ` "${query}"` : ''}. Try another search or filter.
        </p>
      ) : visible && (
        <>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map(r => (
              <li key={r.id}>
                <RecipeTile
                  recipe={r}
                  onOpen={() => go({ name: 'recipe', id: r.id })}
                  added={!!weekPlan && !!findInPlan(weekPlan.plan, r.id)}
                  onAdd={() => toggleWeek(r)}
                  favorite={favorites.has(r.id)}
                  onFavorite={() => toggleFavorite({ id: r.id, title: r.display_name || r.name, image: r.thumb_url ?? '' })}
                />
              </li>
            ))}
          </ul>
          {more && <div className="mt-8"><Button variant="secondary" loading={loadingMore} onClick={loadMore}>Show more recipes</Button></div>}
        </>
      )}
    </PageContainer>
  );
}
