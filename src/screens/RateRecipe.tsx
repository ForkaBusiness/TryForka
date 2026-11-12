import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { supabase } from '../lib/supabase';
import { getCards, recipeTitle } from '../lib/catalog';
import { Button, Card, cx, PageContainer, Textarea } from '../components/ds';

// Rate this recipe: five stars (empty until chosen) and an optional comment.

const LABELS = ['', 'Not for us', 'It was OK', 'Good', 'Really good', 'A favorite'];

export function RateRecipe({ id }: { id: number }) {
  const { userId, back } = useApp();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getCards([id]).then(m => { const c = m.get(id); if (c) setTitle(recipeTitle(c)); }).catch(() => {});
    supabase.from('recipe_ratings').select('rating, comment').eq('user_id', userId).eq('recipe_id', id).maybeSingle()
      .then(({ data }) => { if (data) { setRating(data.rating as number); setComment((data.comment as string) ?? ''); } });
  }, [id, userId]);

  const save = async () => {
    if (!rating) { setError('Choose a star rating first.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('recipe_ratings').upsert({
      user_id: userId, recipe_id: id, rating, comment: comment.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,recipe_id' });
    setSaving(false);
    if (err) { setError("Couldn't save your rating. Check your connection and try again."); return; }
    setSaved(true);
    window.setTimeout(back, 600);
  };

  return (
    <PageContainer
      title="Rate this recipe"
      onBack={back}
      intro={title || undefined}
      bottomBar={<Button size="lg" className="w-full sm:w-auto sm:min-w-56" onClick={save} loading={saving}>{saved ? 'Saved' : 'Save rating'}</Button>}
    >
      <Card className="p-5">
      <fieldset>
        <legend className="mb-3 text-small font-semibold text-ink">Your rating</legend>
        <div role="radiogroup" aria-label="Stars" className="flex justify-between gap-1 sm:justify-start">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}: ${LABELS[n]}`}
              onClick={() => { setRating(n); setError(null); }}
              className="flex size-13 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 ease-spring hover:bg-green-soft active:scale-98"
            >
              <Star size={34} strokeWidth={1.5} aria-hidden className={cx(n <= rating ? 'fill-green text-green' : 'text-ink-muted')} />
            </button>
          ))}
        </div>
        <p className="mt-2 min-h-6 text-body font-medium text-ink">{LABELS[rating]}</p>
      </fieldset>
      <Textarea className="mt-5" label="Comment (optional)" placeholder="What would you change next time?" value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} />
      </Card>
      {error && <p role="alert" className="mt-4 text-small text-terracotta-deep">{error}</p>}
    </PageContainer>
  );
}
