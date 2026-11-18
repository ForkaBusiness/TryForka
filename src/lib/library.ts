// The library: every recipe the household saved, as a favorite or in a collection, in one
// list. Pure, so the filtering is tested in tests/library.test.ts.

export interface LibraryEntry { id: number; favorite: boolean; collections: string[] }

/** One entry per saved recipe: favorites first (newest first), then the rest of the collections. */
export function libraryEntries(favoriteIds: readonly number[], memberships: ReadonlyArray<{ collection_id: string; recipe_id: number }>): LibraryEntry[] {
  const byId = new Map<number, LibraryEntry>();
  for (const id of favoriteIds) if (!byId.has(id)) byId.set(id, { id, favorite: true, collections: [] });
  for (const m of memberships) {
    const entry = byId.get(m.recipe_id) ?? { id: m.recipe_id, favorite: false, collections: [] };
    if (!entry.collections.includes(m.collection_id)) entry.collections.push(m.collection_id);
    byId.set(m.recipe_id, entry);
  }
  return [...byId.values()];
}

/** "all", "favorites", "quick", or a collection id. */
export type LibraryFilter = string;
export const QUICK_MINUTES = 30;

export interface Searchable { title: string; area: string | null; category: string | null; total_minutes: number | null }

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether a saved recipe shows under a filter and a search ("thai chicken": every word must be found). */
export function inLibraryView(entry: LibraryEntry, recipe: Searchable, filter: LibraryFilter, search: string): boolean {
  if (filter === 'favorites' && !entry.favorite) return false;
  if (filter === 'quick' && !(recipe.total_minutes && recipe.total_minutes <= QUICK_MINUTES)) return false;
  if (!['all', 'favorites', 'quick'].includes(filter) && !entry.collections.includes(filter)) return false;
  const wanted = words(search);
  if (!wanted.length) return true;
  const haystack = words(`${recipe.title} ${recipe.area ?? ''} ${recipe.category ?? ''}`);
  return wanted.every(w => haystack.some(h => h.startsWith(w)));
}
