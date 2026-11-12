import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { supabase } from '../lib/supabase';
import { getCards, recipeTitle } from '../lib/catalog';
import { PageContainer, SaveStatus, Skeleton, Textarea } from '../components/ds';

// Notes for one recipe. Saves as you type (after a short pause), no Save button.

export function Notes({ id }: { id: number }) {
  const { userId, back } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const rowId = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    getCards([id]).then(m => { const c = m.get(id); if (c) setTitle(recipeTitle(c)); }).catch(() => {});
    supabase.from('notes').select('id, content').eq('user_id', userId).eq('recipe_id', id)
      .order('updated_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        rowId.current = (data?.[0]?.id as string) ?? null;
        setText((data?.[0]?.content as string) ?? '');
      });
  }, [id, userId]);

  const save = (content: string) => {
    // Saves run one after another so the row is created once and the last edit wins.
    queue.current = queue.current.then(async () => {
      setState('saving');
      try {
        if (rowId.current) {
          const { error } = await supabase.from('notes').update({ content, updated_at: new Date().toISOString() }).eq('id', rowId.current);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from('notes').insert({ user_id: userId, recipe_id: id, content }).select('id').single();
          if (error) throw error;
          rowId.current = data.id as string;
        }
        setState('saved');
      } catch {
        setState('error');
      }
    });
  };

  const onChange = (value: string) => {
    setText(value);
    setState('idle');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(value), 700);
  };

  // Save anything pending when leaving.
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); } }, []);
  const leave = () => {
    if (timer.current && text !== null) { window.clearTimeout(timer.current); timer.current = null; save(text); }
    back();
  };

  return (
    <PageContainer title="Notes" onBack={leave} intro={title || undefined} actions={<SaveStatus state={state} />}>
      {text === null ? <Skeleton className="h-80 w-full rounded-input" /> : (
        <Textarea
          id="note"
          label={`Notes for ${title || 'this recipe'}`}
          hideLabel
          value={text}
          onChange={e => onChange(e.target.value)}
          placeholder="What worked, what you'd change, who liked it"
          fieldClassName="min-h-80 resize-y"
        />
      )}
    </PageContainer>
  );
}
