import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FolderHeart, Heart } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { supabase } from '../lib/supabase';
import { getCards, type RecipeCard } from '../lib/catalog';
import { Button, EmptyState, ListGroup, ListRow, ListSkeleton, PageContainer, RecipeCard as RecipeCardView, RecipeGrid, RecipeGridSkeleton, Segmented } from '../components/ds';
import { fetchCollections, recipeCount, type CollectionRow } from '../lib/collections';

// Favorites and Collections. Collections open to their recipes.

type Tab = 'favorites' | 'collections';

function TileGrid({ ids, emptyText }: { ids: number[]; emptyText: React.ReactNode }) {
  const { go, favorites, toggleFavorite } = useApp();
  const [cards, setCards] = useState<Map<number, RecipeCard> | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    getCards(ids).then(m => { if (!cancelled) setCards(m); }).catch(() => { if (!cancelled) setCards(new Map()); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids are keyed by `key`
  }, [key]);
  if (!ids.length) return <>{emptyText}</>;
  if (!cards) return <RecipeGridSkeleton count={Math.min(ids.length, 8)} />;
  return (
    <RecipeGrid>
      {ids.map(id => cards.get(id)).filter((c): c is RecipeCard => !!c).map(r => (
        <li key={r.id}>
          <RecipeCardView
            recipe={r}
            onOpen={() => go({ name: 'recipe', id: r.id })}
            favorite={favorites.has(r.id)}
            onFavorite={() => toggleFavorite({ id: r.id, title: r.display_name || r.name, image: r.thumb_url ?? '' })}
          />
        </li>
      ))}
    </RecipeGrid>
  );
}

export function Favorites() {
  const { userId, favorites, go } = useApp();
  const [tab, setTab] = useState<Tab>('favorites');
  const [collections, setCollections] = useState<CollectionRow[] | null>(null);
  const [openCollection, setOpenCollection] = useState<CollectionRow | null>(null);
  const [collectionIds, setCollectionIds] = useState<number[] | null>(null);
  // Keep un-hearted recipes on screen until the user leaves, so a mis-tap can be undone.
  const [shownIds] = useState(() => [...favorites.keys()]);
  const favoriteIds = useMemo(() => [...new Set([...shownIds, ...favorites.keys()])], [shownIds, favorites]);

  useEffect(() => {
    if (tab === 'collections') fetchCollections(userId).then(setCollections).catch(() => setCollections([]));
  }, [tab, userId]);

  useEffect(() => {
    if (!openCollection) return;
    setCollectionIds(null);
    supabase.from('collection_recipes').select('recipe_id').eq('collection_id', openCollection.id).order('added_at', { ascending: false })
      .then(({ data }) => setCollectionIds((data ?? []).map(r => r.recipe_id as number)));
  }, [openCollection]);

  const browse = <Button size="lg" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse recipes</Button>;

  if (openCollection) {
    return (
      <PageContainer wide title={openCollection.name} onBack={() => setOpenCollection(null)} backLabel="Back to collections"
        intro={collectionIds ? recipeCount(collectionIds.length) : undefined}>
        {collectionIds === null ? <RecipeGridSkeleton count={4} /> : (
          <TileGrid ids={collectionIds} emptyText={<EmptyState icon={FolderHeart} title="Nothing in this collection yet" action={browse}>Open a recipe, tap the three dots, then Add to collection.</EmptyState>} />
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer wide title="Favorites">
      <Segmented
        label="Favorites"
        value={tab}
        onChange={setTab}
        options={[{ value: 'favorites', label: 'Favorites' }, { value: 'collections', label: 'Collections' }]}
        className="mb-6 w-full max-w-form"
      />

      {tab === 'favorites' ? (
        <TileGrid ids={favoriteIds} emptyText={<EmptyState icon={Heart} title="No favorites yet" action={browse}>Recipes you heart show up here.</EmptyState>} />
      ) : collections === null ? <div className="max-w-column"><ListSkeleton rows={3} /></div> : collections.length === 0 ? (
        <EmptyState icon={FolderHeart} title="No collections yet" action={browse}>Group recipes your way, like "Weeknight" or "Kids love it". Open a recipe, tap the three dots, then Add to collection.</EmptyState>
      ) : (
        <ListGroup className="max-w-column">
          {collections.map(c => <ListRow key={c.id} title={c.name} subtitle={recipeCount(c.count)} chevron onClick={() => setOpenCollection(c)} />)}
        </ListGroup>
      )}
    </PageContainer>
  );
}
