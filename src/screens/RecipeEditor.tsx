import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarPlus, Check, ExternalLink, ImagePlus, ListPlus, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getRecipe, householdRecipeForEdit, isHouseholdRecipe } from '../lib/catalog';
import { DAY_LONG, emptyPlan, findInPlan, nextOpenSlot, withSlot } from '../lib/plan';
import { CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { IMPORT_PHOTO, PhotoError, preparePhoto } from '../lib/photo';
import { uploadPhoto } from '../lib/recipePhotos';
import { addToGroceryList, clearUnsaved, deleteRecipe, keepUnsaved, reviewNote, draftBlockedBy, draftProblem, emptyDraft, groceryLines, rowToDraft, saveDraft, type DraftFlag, type DraftIngredient, type ImportDraft } from '../lib/householdRecipes';
import { parseIngredientLine, splitIngredientBlock, splitStepBlock } from '../../supabase/functions/_shared/imports/ingredientLine.ts';
import { amountText, ingredientText } from '../../supabase/functions/_shared/imports/structure.ts';
import { creditLine } from '../../supabase/functions/_shared/imports/social.ts';
import { HiddenRecipe } from '../components/AllergyReminder';
import { BottomBar, BottomSheet, Button, Card, IconButton, Input, PageContainer, Photo, Skeleton, Textarea, cx } from '../components/ds';

// One screen to write a recipe from scratch, edit one the household saved, and check an
// import before it's saved. Every import lands here: what the import wasn't sure of is
// highlighted with the reason, nothing is saved until the household says so, and a recipe
// the family's settings would hide says so before it's saved.
//
// Ingredients are edited one line each ("2 cups flour, sifted") and shown as the parts
// they're saved as (amount, unit, item, note). Pasting several lines into a line, or into
// a step, splits them.

interface Line { key: string; text: string; /** The import's own reading, kept until the line is edited. */ parsed: DraftIngredient | null; flag?: string }
interface Step { key: string; text: string; flag?: string }
type Field = 'title' | 'servings' | 'prep_minutes' | 'cook_minutes' | 'notes';

let seq = 0;
const key = () => `k${++seq}`;
const toLines = (list: DraftIngredient[], flags: DraftFlag[]): Line[] =>
  list.map((ing, i) => ({ key: key(), text: ingredientText(ing), parsed: ing, flag: flags.find(f => f.field === 'ingredients' && f.index === i)?.reason }));
const toSteps = (list: string[], flags: DraftFlag[]): Step[] =>
  list.map((text, i) => ({ key: key(), text, flag: flags.find(f => f.field === 'steps' && f.index === i)?.reason }));
const blankLine = (): Line => ({ key: key(), text: '', parsed: null });
const blankStep = (): Step => ({ key: key(), text: '' });
const numberOrNull = (s: string) => { const n = Number(s.trim()); return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

function sourceLabel(d: ImportDraft): string | null {
  const s = d.source;
  if (s.kind === 'social' && s.platform) return creditLine(s.platform, s.handle ?? null);
  if (s.site_name) return `From ${s.site_name}`;
  if (s.url) { try { return `From ${new URL(s.url).hostname.replace(/^www\./, '')}`; } catch { return null; } }
  return null;
}

export function RecipeEditor({ id, draft: incoming, duplicate, note }: { id?: number; draft?: ImportDraft; duplicate?: { id: number; title: string }; note?: string | null }) {
  const { userId, prefs, back, replace, weekPlan, saveWeek } = useApp();
  const [base, setBase] = useState<ImportDraft | null | undefined>(id ? undefined : incoming ?? emptyDraft());
  const [blockedOnOpen, setBlockedOnOpen] = useState<string[] | null>(null);
  const [photoForDelete, setPhotoForDelete] = useState<string | null>(null);
  const reviewing = !id && !!incoming && incoming.source.kind !== 'manual';

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getRecipe(id, prefs).then(async r => {
      if (cancelled) return;
      // The household's own recipe stays theirs to fix or delete, even when their settings
      // hide it; the editor says why it's hidden. Anything else hidden stays hidden.
      if (r?.blockedBy && isHouseholdRecipe({ id })) {
        const own = await householdRecipeForEdit(userId, id);
        if (cancelled) return;
        if (own) { setPhotoForDelete(own.thumb_url); setBase(rowToDraft(own as never)); return; }
      }
      if (r?.blockedBy) setBlockedOnOpen(r.blockedBy);
      if (r?.recipe) setPhotoForDelete(r.recipe.thumb_url);
      setBase(r?.recipe ? rowToDraft({ ...r.recipe, display_name: r.recipe.display_name, instructions_raw: r.recipe.instructions_raw ?? null } as never) : null);
    }).catch(() => { if (!cancelled) setBase(null); });
    return () => { cancelled = true; };
    // Loaded once: later changes to the settings show up in the warning below, not by reloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (blockedOnOpen) return <HiddenRecipe blockedBy={blockedOnOpen} onBack={back} />;
  if (base === undefined) {
    return (
      <PageContainer title="Edit recipe" onBack={back}>
        <div aria-busy aria-label="Loading recipe" className="space-y-4">
          <Skeleton className="aspect-4/3 w-full rounded-card" />
          <Skeleton className="h-12 w-full rounded-input" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </PageContainer>
    );
  }
  if (base === null) {
    return (
      <PageContainer title="Couldn't load this recipe" onBack={back}>
        <p className="text-body text-ink-muted">Check your connection, then go back and try again.</p>
      </PageContainer>
    );
  }
  return <Editor id={id} base={base} reviewing={reviewing} duplicate={duplicate} note={note ?? null} savedPhoto={photoForDelete} {...{ userId, prefs, back, replace, weekPlan, saveWeek }} />;
}

type EditorProps = Pick<ReturnType<typeof useApp>, 'userId' | 'prefs' | 'back' | 'replace' | 'weekPlan' | 'saveWeek'> & {
  id?: number; base: ImportDraft; reviewing: boolean; duplicate?: { id: number; title: string }; note: string | null; savedPhoto?: string | null;
};

function Editor({ id, base, reviewing, duplicate, note, savedPhoto, userId, prefs, back, replace, weekPlan, saveWeek }: EditorProps) {
  const [title, setTitle] = useState(base.title);
  const [servings, setServings] = useState(base.servings ? String(base.servings) : '');
  const [prep, setPrep] = useState(base.prep_minutes ? String(base.prep_minutes) : '');
  const [cook, setCook] = useState(base.cook_minutes ? String(base.cook_minutes) : '');
  const [notes, setNotes] = useState(base.notes);
  const [image, setImage] = useState(base.image_url);
  const [lines, setLines] = useState<Line[]>(() => (base.ingredients.length ? toLines(base.ingredients, base.flags) : [blankLine()]));
  const [steps, setSteps] = useState<Step[]>(() => (base.steps.length ? toSteps(base.steps, base.flags) : [blankStep()]));
  const [fieldFlags, setFieldFlags] = useState<Partial<Record<Field, string>>>(() =>
    Object.fromEntries(base.flags.filter(f => !['ingredients', 'steps'].includes(f.field)).map(f => [f.field, f.reason])));
  /** Ingredients the steps use that the list leaves out: offered to add, never added on their own. */
  const [missing, setMissing] = useState<DraftFlag[]>(() => base.flags.filter(f => f.field === 'ingredients' && f.index === undefined && f.add));
  const [dirty, setDirty] = useState(false);
  const [photoState, setPhotoState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'plan' | 'groceries' | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(!!duplicate);
  const fileRef = useRef<HTMLInputElement>(null);
  const focusKey = useRef<string | null>(null);

  const touch = () => { setDirty(true); setProblem(null); };
  const clearFlag = (f: Field) => setFieldFlags(prev => (prev[f] ? { ...prev, [f]: undefined } : prev));

  const draft: ImportDraft = useMemo(() => ({
    ...base,
    title, notes, image_url: image,
    servings: numberOrNull(servings), prep_minutes: numberOrNull(prep), cook_minutes: numberOrNull(cook),
    total_minutes: prep || cook ? null : base.total_minutes,
    ingredients: lines.map(l => l.parsed ?? parseIngredientLine(l.text)).filter(i => i.item || i.quantity !== null),
    steps: steps.map(s => s.text.trim()).filter(Boolean),
    flags: [],
  }), [base, title, notes, image, servings, prep, cook, lines, steps]);

  const blockedBy = useMemo(() => draftBlockedBy(draft, prefs), [draft, prefs]);

  // A new recipe or an import not saved yet is kept on this device until it's saved or discarded.
  useEffect(() => {
    if (id || saved || !dirty && !reviewing) return;
    const t = window.setTimeout(() => keepUnsaved(userId, { ...draft, flags: base.flags }), 400);
    return () => window.clearTimeout(t);
  }, [draft, id, saved, dirty, reviewing, base.flags, userId]);
  const openFlags = lines.filter(l => l.flag).length + steps.filter(s => s.flag).length + Object.values(fieldFlags).filter(Boolean).length + missing.length;
  const source = sourceLabel(base);

  // Focus a row that was just added.
  useEffect(() => {
    if (!focusKey.current) return;
    document.getElementById(focusKey.current)?.focus();
    focusKey.current = null;
  });

  // ── Ingredients ──
  const setLine = (k: string, text: string) => { touch(); setLines(ls => ls.map(l => (l.key === k ? { ...l, text, parsed: null, flag: undefined } : l))); };
  const removeLine = (k: string) => { touch(); setLines(ls => (ls.length > 1 ? ls.filter(l => l.key !== k) : [blankLine()])); };
  const addLine = () => { const l = blankLine(); focusKey.current = `ing-${l.key}`; setLines(ls => [...ls, l]); };
  const pasteLines = (k: string, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    const parts = splitIngredientBlock(text);
    if (!parts.length) return;
    touch();
    setLines(ls => {
      const at = ls.findIndex(l => l.key === k);
      const current = ls[at];
      const fresh = parts.map(p => ({ key: key(), text: p, parsed: null }));
      // Pasted into an empty line: the list takes its place.
      const keep = current.text.trim() ? [current] : [];
      return [...ls.slice(0, at), ...keep, ...fresh, ...ls.slice(at + 1)];
    });
  };

  // ── Steps ──
  const setStep = (k: string, text: string) => { touch(); setSteps(ss => ss.map(s => (s.key === k ? { ...s, text, flag: undefined } : s))); };
  const removeStep = (k: string) => { touch(); setSteps(ss => (ss.length > 1 ? ss.filter(s => s.key !== k) : [blankStep()])); };
  const addStep = () => { const s = blankStep(); focusKey.current = `step-${s.key}`; setSteps(ss => [...ss, s]); };
  const moveStep = (i: number, by: -1 | 1) => {
    touch();
    setSteps(ss => { const next = [...ss]; const [s] = next.splice(i, 1); next.splice(i + by, 0, s); return next; });
  };
  const pasteSteps = (k: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    const parts = splitStepBlock(text);
    if (parts.length < 2) return;
    e.preventDefault();
    touch();
    setSteps(ss => {
      const at = ss.findIndex(s => s.key === k);
      const keep = ss[at].text.trim() ? [ss[at]] : [];
      return [...ss.slice(0, at), ...keep, ...parts.map(text => ({ key: key(), text })), ...ss.slice(at + 1)];
    });
  };

  // ── Photo ──
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoState({ busy: true, error: null });
    try {
      const { blob } = await preparePhoto(file, { longEdge: IMPORT_PHOTO.longEdge, quality: 0.82 });
      const { ref } = await uploadPhoto(userId, blob, 'dishes');
      setImage(ref);
      touch();
      setPhotoState({ busy: false, error: null });
    } catch (err) {
      setPhotoState({ busy: false, error: err instanceof PhotoError ? err.message : "Couldn't add that photo. Check your connection and try again." });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Save and after ──
  const save = async () => {
    const issue = draftProblem(draft);
    if (issue) { setProblem(issue); return; }
    setSaving(true);
    setProblem(null);
    try {
      const savedId = await saveDraft(userId, draft, id);
      setDirty(false);
      if (!id) clearUnsaved();
      if (id) { back(); return; }
      setSaved(savedId);
      setStatus(blockedBy.length ? 'Saved. It stays hidden while your settings exclude it.' : 'Saved to your Library.');
      window.scrollTo(0, 0);
      document.querySelector('main')?.scrollTo(0, 0);
    } catch {
      setProblem("Couldn't save. Check your connection and try again. Nothing you typed is lost.");
    } finally {
      setSaving(false);
    }
  };

  const addToWeek = async () => {
    if (!saved) return;
    setBusyAction('plan');
    try {
      const plan = weekPlan?.plan ?? emptyPlan();
      const there = findInPlan(plan, saved);
      if (there) { setStatus(`It's already on ${DAY_LONG[there.day]}.`); return; }
      const spot = nextOpenSlot(plan, false, prefs.plan_lunch);
      if (!spot) { setStatus('Your week is full. Swap a day on the meal plan instead.'); return; }
      await saveWeek(withSlot(plan, spot.day, spot.slot, { id: saved, title: draft.title.trim(), image: image ?? '' }), !weekPlan);
      setStatus(`Added to ${DAY_LONG[spot.day]} ${spot.slot}. It's on your grocery list too.`);
    } catch (err) {
      setStatus(err instanceof Error && /still loading/.test(err.message) ? err.message : "Couldn't update your week. Check your connection and try again.");
    } finally {
      setBusyAction(null);
    }
  };

  const addToGroceries = async () => {
    setBusyAction('groceries');
    try {
      const n = await addToGroceryList(userId, groceryLines(draft, prefs.units));
      setStatus(n ? `Added ${n} item${n === 1 ? '' : 's'} to your grocery list.` : 'Those items are already on your grocery list.');
    } catch {
      setStatus("Couldn't update your grocery list. Check your connection and try again.");
    } finally {
      setBusyAction(null);
    }
  };

  const remove = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteRecipe(userId, id, savedPhoto);
      const plan = weekPlan?.plan;
      const there = plan ? findInPlan(plan, id) : null;
      if (plan && there) await saveWeek(withSlot(plan, there.day, there.slot, null), false, { quiet: true }).catch(() => {});
      setConfirmDelete(false);
      back();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
      setProblem("Couldn't delete. Check your connection and try again.");
    }
  };

  // An import is unsaved work even before it's edited: closing it asks first.
  const leave = () => ((dirty || reviewing) && !saved ? setConfirmLeave(true) : back());
  const heading = id ? 'Edit recipe' : reviewing ? 'Check and save' : 'New recipe';

  if (saved) {
    const hidden = blockedBy.length > 0;
    return (
      <PageContainer title={draft.title.trim()} onBack={back} backLabel="Done" bottomBar={<>
        <Button size="lg" className="flex-1 sm:min-w-56 sm:flex-none" onClick={() => replace({ name: 'recipe', id: saved })} disabled={hidden}>Open recipe</Button>
        <Button size="lg" variant="secondary" onClick={back}>Done</Button>
      </>}>
        <Card className="overflow-hidden">
          {image && <Photo src={image} className="aspect-4/3 w-full" />}
          <div className="p-5">
            <p role="status" className="flex items-center gap-2 text-body font-semibold text-green"><Check size={20} strokeWidth={2} aria-hidden />{status}</p>
            {hidden && <p className="mt-2 text-small text-ink-muted">It has {blockedBy.map(b => b.toLowerCase()).join(', ')}. {CHECK_INGREDIENTS}</p>}
          </div>
        </Card>
        {!hidden && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="lg" icon={CalendarPlus} loading={busyAction === 'plan'} disabled={!!busyAction} onClick={addToWeek}>Add to this week</Button>
            <Button variant="secondary" size="lg" icon={ListPlus} loading={busyAction === 'groceries'} disabled={!!busyAction} onClick={addToGroceries}>Add to grocery list</Button>
          </div>
        )}
      </PageContainer>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-column flex-1 px-gutter pt-(--screen-top) pb-10 md:pt-12">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-2">
          <IconButton icon={X} label={id ? 'Cancel editing' : 'Close without saving'} variant="outlined" onClick={leave} />
          {source && base.source.url && (
            <a href={base.source.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-small font-semibold text-green hover:underline">
              <span className="truncate">{source}</span><ExternalLink size={16} strokeWidth={2} aria-hidden className="shrink-0" />
            </a>
          )}
        </div>
        <h1 className="display mb-2 text-title text-ink md:text-display">{heading}</h1>

        {reviewing && (
          <p role="status" className={cx('mb-5 rounded-input px-4 py-3 text-body', openFlags || note ? 'bg-terracotta-soft text-ink' : 'bg-green-soft text-ink')}>
            {note ?? (openFlags ? reviewNote(base.flags) : 'Got it. Look it over, then save.')}
          </p>
        )}

        {showDuplicate && duplicate && (
          <Card className="mb-5 p-4">
            <p className="text-body text-ink">You already saved this one as <span className="font-semibold">{duplicate.title}</span>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => replace({ name: 'recipe', id: duplicate.id })}>Open the saved recipe</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowDuplicate(false)}>Save another copy</Button>
            </div>
          </Card>
        )}

        {blockedBy.length > 0 && (
          <div role="alert" className="mb-5 rounded-input border border-terracotta/40 bg-terracotta-soft px-4 py-3">
            <p className="text-body font-semibold text-terracotta-deep">Hidden for your family: {blockedBy.map(b => b.toLowerCase()).join(', ')}</p>
            <p className="mt-1 text-small text-ink">
              Your settings hide recipes like this, so after saving it won't show in your Library, plan or grocery list. You can still save it. {CHECK_INGREDIENTS}
            </p>
          </div>
        )}

        <section aria-label="Photo" className="mb-6">
          <div className="relative">
            {image ? <Photo src={image} className="aspect-4/3 w-full rounded-card" />
              : <div className="flex h-36 w-full items-center rounded-card border border-dashed border-line bg-surface px-5 text-ink-muted md:h-44"><ImagePlus size={28} strokeWidth={1.5} aria-hidden /><span className="ml-3 text-small">No photo yet</span></div>}
            <div className="absolute right-3 bottom-3 flex gap-2">
              {image && <Button size="sm" variant="secondary" onClick={() => { setImage(null); touch(); }}>Remove</Button>}
              <Button size="sm" variant="secondary" icon={ImagePlus} loading={photoState.busy} onClick={() => fileRef.current?.click()}>{image ? 'Change photo' : 'Add photo'}</Button>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden onChange={e => pickPhoto(e.target.files?.[0])} />
          {photoState.error && <p role="alert" className="mt-2 text-small text-terracotta-deep">{photoState.error}</p>}
        </section>

        <Flagged reason={fieldFlags.title}>
          <Input label="Recipe name" value={title} maxLength={120} placeholder="Grandma's lasagna" autoComplete="off"
            onChange={e => { setTitle(e.target.value); touch(); clearFlag('title'); }} />
        </Flagged>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {([['servings', 'Servings', servings, setServings], ['prep_minutes', 'Prep (min)', prep, setPrep], ['cook_minutes', 'Cook (min)', cook, setCook]] as const).map(([f, label, value, set]) => (
            <Flagged key={f} reason={fieldFlags[f]} compact>
              <Input label={label} inputMode="numeric" value={value} placeholder="-" autoComplete="off"
                onChange={e => { set(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); touch(); clearFlag(f); }} />
            </Flagged>
          ))}
        </div>

        <section aria-labelledby="ing-heading" className="mt-8">
          <h2 id="ing-heading" className="label mb-1 px-1">Ingredients</h2>
          <p className="mb-3 px-1 text-small text-ink-muted">One per line, like "2 cups flour, sifted". Paste a whole list to split it.</p>
          {missing.map(f => (
            <div key={f.add} className="mb-2 rounded-input bg-terracotta-soft p-3">
              <p className="text-small font-semibold text-terracotta-deep">{f.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => {
                  touch();
                  const l = { ...blankLine(), text: f.add! };
                  setLines(ls => [...ls.filter(x => x.text.trim()), l]);
                  setMissing(m => m.filter(x => x !== f));
                }}>Add to the list</Button>
                <Button size="sm" variant="ghost" onClick={() => setMissing(m => m.filter(x => x !== f))}>Leave it out</Button>
              </div>
            </div>
          ))}
          <ul className="space-y-2">
            {lines.map((l, i) => {
              const p = l.parsed ?? parseIngredientLine(l.text);
              const parts = [amountText(p), p.item, p.note].filter(Boolean);
              return (
                <li key={l.key}>
                  <div className={cx('rounded-input', l.flag && 'bg-terracotta-soft p-2')}>
                    <div className="flex items-center gap-2">
                      <Input id={`ing-${l.key}`} label={`Ingredient ${i + 1}`} hideLabel className="min-w-0 flex-1" value={l.text} autoComplete="off"
                        placeholder={i === 0 ? '2 cups flour, sifted' : 'Add an ingredient'} aria-invalid={l.flag ? true : undefined}
                        onChange={e => setLine(l.key, e.target.value)} onPaste={e => pasteLines(l.key, e)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }} />
                      <IconButton icon={Trash2} label={`Remove ingredient ${i + 1}`} size="sm" onClick={() => removeLine(l.key)} />
                    </div>
                    {l.flag && <p className="mt-1.5 px-2 text-small font-semibold text-terracotta-deep">{l.flag}</p>}
                    {l.text.trim() && parts.length > 0 && (
                      <p className="mt-1 px-2 text-caption text-ink-muted">
                        {p.quantity === null ? <span>No amount</span> : null}
                        {parts.map((part, j) => <span key={j}>{j || p.quantity === null ? ' · ' : ''}{part}</span>)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" icon={Plus} className="mt-2" onClick={addLine}>Add ingredient</Button>
        </section>

        <section aria-labelledby="steps-heading" className="mt-8">
          <h2 id="steps-heading" className="label mb-1 px-1">Steps</h2>
          <p className="mb-3 px-1 text-small text-ink-muted">One step per box, in order. Paste numbered steps to split them.</p>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.key} className={cx('rounded-input', s.flag && 'bg-terracotta-soft p-2')}>
                <div className="flex gap-2">
                  <span aria-hidden className="tabular mt-2.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-green-soft text-small font-bold text-green">{i + 1}</span>
                  <Textarea id={`step-${s.key}`} label={`Step ${i + 1}`} hideLabel className="min-w-0 flex-1" fieldClassName="min-h-24 resize-y" value={s.text}
                    placeholder={i === 0 ? 'Heat the oven to 400°F.' : 'Next step'} onChange={e => setStep(s.key, e.target.value)} onPaste={e => pasteSteps(s.key, e)} />
                  <div className="flex flex-col">
                    <IconButton icon={Trash2} label={`Remove step ${i + 1}`} size="sm" onClick={() => removeStep(s.key)} />
                    {i > 0 && <IconButton icon={ArrowUp} label={`Move step ${i + 1} up`} size="sm" onClick={() => moveStep(i, -1)} />}
                    {i < steps.length - 1 && <IconButton icon={ArrowDown} label={`Move step ${i + 1} down`} size="sm" onClick={() => moveStep(i, 1)} />}
                  </div>
                </div>
                {s.flag && <p className="mt-1.5 pl-10 text-small font-semibold text-terracotta-deep">{s.flag}</p>}
              </li>
            ))}
          </ol>
          <Button variant="ghost" size="sm" icon={Plus} className="mt-2" onClick={addStep}>Add step</Button>
        </section>

        <section className="mt-8">
          <Flagged reason={fieldFlags.notes}>
            <Textarea label="Notes" value={notes} maxLength={5000} placeholder="Swaps, what the kids thought, where it came from" fieldClassName="min-h-24 resize-y"
              onChange={e => { setNotes(e.target.value); touch(); clearFlag('notes'); }} />
          </Flagged>
        </section>
        {id && (
          <div className="mt-8 border-t border-line pt-6">
            <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} className="text-terracotta-deep">Delete recipe</Button>
          </div>
        )}
      </div>

      <BottomBar>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <Button size="lg" className="w-full sm:w-auto sm:min-w-56" loading={saving} onClick={save}>
            {id ? 'Save changes' : blockedBy.length ? 'Save anyway' : 'Save recipe'}
          </Button>
          {problem && <p role="alert" className="text-small font-semibold text-terracotta-deep">{problem}</p>}
          {!problem && openFlags > 0 && <p className="text-small text-ink-muted">{openFlags} highlighted to check</p>}
        </div>
      </BottomBar>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this recipe?" side="bottom">
        <p className="mb-5 text-body text-ink-muted">It comes out of your Library and your week. This can't be undone.</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button variant="danger" loading={deleting} onClick={remove}>Delete recipe</Button>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title={id ? 'Discard your changes?' : 'Discard this recipe?'} side="bottom">
        <p className="mb-5 text-body text-ink-muted">{id ? 'The recipe stays as it was.' : 'Nothing has been saved yet.'}</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button variant="danger" onClick={() => { setConfirmLeave(false); if (!id) clearUnsaved(); back(); }}>Discard</Button>
          <Button variant="secondary" onClick={() => setConfirmLeave(false)}>Keep editing</Button>
        </div>
      </BottomSheet>
    </div>
  );
}

/** A field the import wasn't sure of: highlighted, with the reason underneath, until it's edited. */
function Flagged({ reason, compact, children }: { reason?: string; compact?: boolean; children: React.ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <div className={cx('rounded-input bg-terracotta-soft', compact ? 'p-1.5' : 'p-2')}>
      {children}
      <p className={cx('mt-1.5 font-semibold text-terracotta-deep', compact ? 'text-caption' : 'px-2 text-small')}>{reason}</p>
    </div>
  );
}
