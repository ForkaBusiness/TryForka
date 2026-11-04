import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, RefreshCcw } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { checkFile, findSimilar, PhotoError, preparePhoto } from '../lib/photo';
import { DAY_LONG, emptyPlan, entryFromCard, findInPlan, nextOpenSlot, withSlot } from '../lib/plan';
import type { RecipeCard } from '../lib/catalog';
import { Button, cx, RecipeTile, Sheet, Skeleton } from '../components/ds';

// Find meals like this: a photo (taken or chosen), an optional description, then 6-8
// recipes from the household's safe catalog that are closest to it.

const CONTEXT_MAX = 200;

export function PhotoSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { weekPlan, prefs, saveWeek, go, favorites, toggleFavorite } = useApp();
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [context, setContext] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ dish: string; recipes: RecipeCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const contextInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null); setBase64(null); setContext(''); setResult(null); setError(null); setStatus(null);
  }, [open]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setResult(null); setStatus(null);
    try {
      checkFile(file);
      setPreparing(true);
      const { dataUrl, base64: b64 } = await preparePhoto(file);
      setPreview(dataUrl);
      setBase64(b64);
      requestAnimationFrame(() => contextInput.current?.focus());
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : "Couldn't open that photo. Try a different one.");
    } finally {
      setPreparing(false);
    }
  };

  const search = async () => {
    if (!base64 || searching) return;
    setSearching(true); setError(null); setResult(null);
    try {
      const r = await findSimilar(base64, context.trim(), prefs);
      setResult({ dish: r.dish_name, recipes: r.recipes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't look at that photo. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const toggleWeek = async (r: RecipeCard) => {
    const plan = weekPlan?.plan ?? emptyPlan();
    const existing = findInPlan(plan, r.id);
    try {
      if (existing) { await saveWeek(withSlot(plan, existing.day, existing.slot, null), false); return; }
      const spot = nextOpenSlot(plan, r.meal_role === 'breakfast', prefs.plan_lunch);
      if (!spot) { setStatus('Your week is full. Swap a day on the meal plan instead.'); return; }
      await saveWeek(withSlot(plan, spot.day, spot.slot, entryFromCard(r)), !weekPlan);
      setStatus(`Added to ${DAY_LONG[spot.day]} ${spot.slot}.`);
    } catch {
      setStatus("Couldn't update your week. Check your connection and try again.");
    }
  };

  const editAgain = () => {
    setResult(null);
    requestAnimationFrame(() => { contextInput.current?.focus(); contextInput.current?.scrollIntoView({ block: 'center' }); });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Find meals like this">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}
      />
      {/* A second picker without `capture`, so phones can choose from the photo library too. */}
      <input
        id="photo-library"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!preview ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx('flex flex-col items-start gap-4 rounded-photo border border-dashed p-6 transition-colors duration-150', dragging ? 'border-basil bg-basil-soft' : 'border-line bg-canvas')}
        >
          <p className="text-base text-ink">Take or choose a photo of a dish you liked. We'll find recipes like it that fit your household.</p>
          <div className="flex flex-wrap gap-3">
            <Button icon={ImagePlus} loading={preparing} onClick={() => fileInput.current?.click()}>Take or choose a photo</Button>
            <Button variant="secondary" onClick={() => (document.getElementById('photo-library') as HTMLInputElement | null)?.click()}>Photo library</Button>
          </div>
          <p className="hidden text-sm text-ink-muted md:block">Or drag a photo here. JPEG, PNG, WebP or HEIC, up to 15 MB.</p>
        </div>
      ) : (
        <div>
          <img src={preview} alt="Your photo" className="max-h-72 w-full rounded-photo bg-canvas object-cover" />
          <button type="button" onClick={() => fileInput.current?.click()} className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-basil hover:underline">
            <RefreshCcw size={16} strokeWidth={1.75} aria-hidden />Use a different photo
          </button>

          {!result && (
            <div className="mt-4">
              <label htmlFor="photo-context" className="mb-2 block text-sm font-semibold text-ink">Tell us about it (optional)</label>
              <textarea
                ref={contextInput}
                id="photo-context"
                value={context}
                maxLength={CONTEXT_MAX}
                onChange={e => setContext(e.target.value)}
                placeholder="What is it? e.g. my mom's chicken tinga, the kids loved it"
                rows={2}
                className="block w-full resize-none rounded-control border border-line bg-surface px-4 py-3 text-base outline-none focus:border-basil focus:ring-2 focus:ring-basil/25"
              />
              <p className="mt-1 text-right text-xs text-ink-muted">{context.length}/{CONTEXT_MAX}</p>
              <Button size="lg" block className="mt-3" loading={searching} onClick={search}>Find similar meals</Button>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-alert">{error}</p>}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-basil">{status}</p>

      {searching && (
        <div aria-hidden className="mt-4 grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i}><Skeleton className="aspect-square" /><Skeleton className="mt-2 h-4 w-3/4" /></div>)}
        </div>
      )}

      {result && (
        <section aria-labelledby="photo-results" className="mt-4">
          <h3 id="photo-results" className="text-lg text-ink">Like your {result.dish.charAt(0).toLowerCase() + result.dish.slice(1)}</h3>
          <button type="button" onClick={editAgain} className="mt-1 cursor-pointer text-sm font-semibold text-basil hover:underline">Not quite? Edit and try again</button>
          {result.recipes.length === 0 ? (
            <p className="mt-4 text-base text-ink-muted">Nothing in your recipes is close to that yet. Try a different photo or description.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6">
              {result.recipes.map(r => (
                <li key={r.id}>
                  <RecipeTile
                    recipe={r}
                    onOpen={() => { onClose(); go({ name: 'recipe', id: r.id }); }}
                    added={!!weekPlan && !!findInPlan(weekPlan.plan, r.id)}
                    onAdd={() => toggleWeek(r)}
                    favorite={favorites.has(r.id)}
                    onFavorite={() => toggleFavorite({ id: r.id, title: r.display_name || r.name, image: r.thumb_url ?? '' })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Sheet>
  );
}
