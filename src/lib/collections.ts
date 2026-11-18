import { supabase } from './supabase';

// The household's recipe collections.

export interface CollectionRow { id: string; name: string; count: number }

export const recipeCount = (n: number) => `${n} recipe${n === 1 ? '' : 's'}`;

export async function fetchCollections(userId: string): Promise<CollectionRow[]> {
  const { data, error } = await supabase.from('collections')
    .select('id, name, collection_recipes(count)').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(c => ({ id: c.id as string, name: c.name as string, count: (c.collection_recipes as Array<{ count: number }>)?.[0]?.count ?? 0 }));
}

/** Which collections each saved recipe is in, newest first. */
export async function fetchCollectionRecipes(): Promise<Array<{ collection_id: string; recipe_id: number }>> {
  // Row level security limits this to the household's own collections.
  const { data, error } = await supabase.from('collection_recipes').select('collection_id, recipe_id, added_at').order('added_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({ collection_id: r.collection_id as string, recipe_id: r.recipe_id as number }));
}
