import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { supabase } from '../lib/supabase';
import { getCards, recipeTitle } from '../lib/catalog';
import { Button, Card, Checkbox, Input, ListSkeleton, PageContainer } from '../components/ds';
import { fetchCollections, recipeCount, type CollectionRow } from '../lib/collections';

// Add a recipe to collections: tick the ones it belongs in, create new ones, Save.

export function Collections({ id }: { id: number }) {
  const { userId, back } = useApp();
  const [collections, setCollections] = useState<CollectionRow[] | null>(null);
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCards([id]).then(m => { const c = m.get(id); if (c) setTitle(recipeTitle(c)); }).catch(() => {});
    Promise.all([
      fetchCollections(userId),
      supabase.from('collection_recipes').select('collection_id').eq('recipe_id', id),
    ]).then(([rows, { data }]) => {
      const inThese = new Set((data ?? []).map(r => r.collection_id as string));
      setCollections(rows);
      setInitial(inThese);
      setSelected(new Set(inThese));
    }).catch(() => setError("Couldn't load your collections. Check your connection."));
  }, [id, userId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const { data, error: err } = await supabase.from('collections').insert({ user_id: userId, name }).select('id, name').single();
    if (err) { setError("Couldn't create the collection. Try again."); return; }
    setCollections(c => [...(c ?? []), { id: data.id as string, name: data.name as string, count: 0 }]);
    setSelected(s => new Set(s).add(data.id as string));
    setNewName('');
    setCreating(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const add = [...selected].filter(c => !initial.has(c));
      const remove = [...initial].filter(c => !selected.has(c));
      if (add.length) {
        const { error: err } = await supabase.from('collection_recipes').insert(add.map(collection_id => ({ collection_id, recipe_id: id, recipe_title: title })));
        if (err) throw err;
      }
      if (remove.length) {
        const { error: err } = await supabase.from('collection_recipes').delete().eq('recipe_id', id).in('collection_id', remove);
        if (err) throw err;
      }
      back();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setSaving(false);
    }
  };

  const toggle = (cid: string, on: boolean) => setSelected(s => { const n = new Set(s); if (on) n.add(cid); else n.delete(cid); return n; });

  return (
    <PageContainer
      title="Add to collection"
      onBack={back}
      intro={title || undefined}
      bottomBar={<Button size="lg" className="w-full sm:w-auto sm:min-w-56" onClick={save} loading={saving} disabled={!collections}>Save</Button>}
    >
      {collections === null && !error ? <ListSkeleton rows={3} /> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {(collections ?? []).map(c => {
              const on = selected.has(c.id);
              // Count reflects the change about to be saved.
              const count = c.count + (on && !initial.has(c.id) ? 1 : 0) - (!on && initial.has(c.id) ? 1 : 0);
              return (
                <li key={c.id}>
                  <Checkbox checked={on} onChange={v => toggle(c.id, v)} className="flex min-h-14 w-full px-4 py-3"
                    label={<span><span className="block font-medium">{c.name}</span><span className="block text-small text-ink-muted">{recipeCount(count)}</span></span>} />
                </li>
              );
            })}
            <li className="px-4 py-3">
              {creating ? (
                <form onSubmit={create} className="flex items-end gap-2">
                  <Input className="flex-1" label="Collection name" placeholder="Weeknight favorites" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                  <Button type="submit" variant="secondary" className="h-12" disabled={!newName.trim()}>Create</Button>
                </form>
              ) : (
                <button type="button" onClick={() => setCreating(true)} className="flex min-h-8 w-full cursor-pointer items-center gap-3 text-left text-body font-semibold text-green">
                  <Plus size={20} strokeWidth={1.75} aria-hidden />New collection
                </button>
              )}
            </li>
          </ul>
        </Card>
      )}
      {error && <p role="alert" className="mt-4 text-small text-terracotta-deep">{error}</p>}
    </PageContainer>
  );
}
