import { useEffect, useMemo, useState } from 'react';
import { BookHeart, BookOpen, Plus, Search, SearchX } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { householdRecipeIds, recipeTitle, safeCards, type RecipeCard } from '../lib/catalog';
import { CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { fetchCollectionRecipes, fetchCollections, type CollectionRow } from '../lib/collections';
import { inLibraryView, libraryEntries, type LibraryFilter } from '../lib/library';
import { ImportButtons } from '../components/ImportEntry';
import { Button, EmptyState, Input, PageContainer, RecipeCard as RecipeCardView, RecipeGrid, RecipeGridSkeleton, ToggleChip } from '../components/ds';

// The library: every recipe the household saved, favorites, collections and its own
// recipes (typed in or imported) together, in one grid. A search box and a row of filters (all, favorites, quick, then each
// collection) instead of separate tabs and folders.

interface Saved { collections: CollectionRow[]; memberships: Array<{ collection_id: string; recipe_id: number }>; own: number[] }

export function Favorites() {
  const { userId, prefs, favorites, toggleFavorite, go } = useApp();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [cards, setCards] = useState<Map<number, RecipeCard> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  // Un-hearted recipes stay on screen until the user leaves, so a mis-tap can be undone.
  const [shownFavorites] = useState(() => [...favorites.keys()]);
  const favoriteIds = useMemo(() => [...new Set([...favorites.keys(), ...shownFavorites])], [favorites, shownFavorites]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    Promise.all([fetchCollections(userId), fetchCollectionRecipes(), householdRecipeIds(userId)])
      .then(([collections, memberships, own]) => { if (!cancelled) setSaved({ collections, memberships, own }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const entries = useMemo(() => (saved ? libraryEntries(favoriteIds, saved.memberships, saved.own) : []), [saved, favoriteIds]);
  const ids = entries.map(e => e.id).join(',');

  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    // Saved recipes the family can no longer eat stay saved, but aren't shown.
    safeCards(ids ? ids.split(',').map(Number) : [], prefs)
      .then(list => { if (!cancelled) setCards(new Map(list.map(r => [r.id, r]))); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ids, prefs, saved]);

  const browse = <Button size="lg" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse recipes</Button>;
  const addRecipe = () => go({ name: 'import' });
  const loading = !error && (!saved || !cards);
  const visible = cards ? entries.filter(e => cards.has(e.id)) : [];
  const hidden = cards ? entries.length - visible.length : 0;
  const shown = visible.filter(e => {
    const r = cards!.get(e.id)!;
    return inLibraryView(e, { title: recipeTitle(r), area: r.area, category: r.category, total_minutes: r.total_minutes }, filter, search);
  });
  const filters: Array<{ value: LibraryFilter; label: string }> = [
    { value: 'all', label: 'All' }, { value: 'favorites', label: 'Favorites' },
    ...(saved?.own.length ? [{ value: 'mine', label: 'Added by you' }] : []),
    { value: 'quick', label: '30 min or less' },
    ...(saved?.collections ?? []).map(c => ({ value: c.id, label: c.name })),
  ];
  const collectionName = saved?.collections.find(c => c.id === filter)?.name;

  return (
    <PageContainer wide title="Library" intro={cards && visible.length ? `${visible.length} saved recipe${visible.length === 1 ? '' : 's'}` : undefined}
      actions={<Button size="sm" variant="ghost" icon={Plus} onClick={addRecipe} aria-label="Add a recipe">Add</Button>}>
      <ImportButtons className="mb-5" />
      {error ? (
        <EmptyState icon={BookHeart} title="Couldn't load your library" action={<Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState>
      ) : loading ? (
        <div aria-busy aria-label="Loading your library"><RecipeGridSkeleton count={8} /></div>
      ) : !entries.length ? (
        <EmptyState icon={BookHeart} title="Nothing saved yet" action={<div className="flex flex-wrap justify-center gap-3">{browse}<Button size="lg" variant="secondary" icon={Plus} onClick={addRecipe}>Import a recipe</Button></div>}>
          Tap the heart on a recipe to keep it here, or import one from a link or a photo. To group recipes, like "Weeknight" or "Kids love it", open one and choose Add to collection.
        </EmptyState>
      ) : (
        <>
          <Input id="library-search" type="search" label="Search your library" hideLabel className="mb-4 max-w-form"
            leading={<Search size={20} strokeWidth={1.75} aria-hidden />} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your library" />
          <div role="radiogroup" aria-label="Show" className="no-scrollbar -mx-gutter mb-5 flex gap-2 overflow-x-auto px-gutter pb-1 md:mx-0 md:flex-wrap md:px-0">
            {filters.map(f => <ToggleChip key={f.value} role="radio" selected={filter === f.value} onToggle={() => setFilter(f.value)}>{f.label}</ToggleChip>)}
          </div>
          {hidden > 0 && (
            <p className="mb-4 text-small text-ink-muted">
              {hidden === 1 ? '1 saved recipe is hidden' : `${hidden} saved recipes are hidden`} because {hidden === 1 ? "it doesn't" : "they don't"} fit your household's settings. {CHECK_INGREDIENTS}
            </p>
          )}
          {shown.length ? (
            <RecipeGrid>
              {shown.map(e => {
                const r = cards!.get(e.id)!;
                return (
                  <li key={r.id}>
                    <RecipeCardView recipe={r} onOpen={() => go({ name: 'recipe', id: r.id })} favorite={favorites.has(r.id)}
                      onFavorite={() => toggleFavorite({ id: r.id, title: recipeTitle(r), image: r.thumb_url ?? '' })} />
                  </li>
                );
              })}
            </RecipeGrid>
          ) : search.trim() ? (
            <EmptyState icon={SearchX} title={`Nothing saved matches "${search.trim()}"`}>Try another word, or clear the search.</EmptyState>
          ) : filter === 'all' ? (
            <EmptyState icon={BookHeart} title="Nothing to show right now">Your saved recipes don't fit your household's settings at the moment. {CHECK_INGREDIENTS}</EmptyState>
          ) : filter === 'mine' ? (
            <EmptyState icon={BookHeart} title="Nothing added yet">Recipes you write or import show up here.</EmptyState>
          ) : collectionName ? (
            <EmptyState icon={BookHeart} title={`Nothing in ${collectionName} yet`}>Open a recipe and choose Add to collection.</EmptyState>
          ) : (
            <EmptyState icon={BookHeart} title={filter === 'favorites' ? 'No favorites yet' : 'Nothing quick saved yet'}>
              {filter === 'favorites' ? 'Tap the heart on a recipe to keep it here.' : 'Recipes that take 30 minutes or less show up here.'}
            </EmptyState>
          )}
        </>
      )}
    </PageContainer>
  );
}
