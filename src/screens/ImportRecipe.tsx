import { useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, ClipboardPaste, Clock, FileText, ImagePlus, Link2, PenLine, SearchX, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { findLink, importFromLink, importFromPhotos, importFromText, importPickedRecipe, MAX_IMPORT_PHOTOS, type ImportAnswer, type PhotoStep } from '../lib/imports';
import { clearUnsaved, readUnsaved } from '../lib/householdRecipes';
import { canImport, canSaveRecipe } from '../lib/usage';
import { Button, Card, IconButton, Input, PageContainer, Spinner, Textarea, cx } from '../components/ds';
import type { DraftSource } from '../../supabase/functions/_shared/imports/draft.ts';

// Import a recipe: paste a link (a recipe site, or a TikTok, Instagram, YouTube, Pinterest
// or Facebook post), add photos (cookbook pages, screenshots, a handwritten card), or paste
// the recipe's text. A good result opens the review screen; everything else has its own
// state here with a next step: already saved, more than one recipe in the photos (pick
// one), no recipe found, couldn't import, and today's imports used up.

type Phase =
  | { name: 'idle' }
  | { name: 'working'; title: string; detail: string; step?: string }
  | { name: 'duplicate'; id: number; title: string; url: string }
  | { name: 'no_recipe'; message: string; source: DraftSource | null; caption: string | null }
  | { name: 'failed'; message: string; retry: () => void }
  | { name: 'capped'; message: string }
  | { name: 'limit'; message: string }
  | { name: 'choose'; recipes: Array<{ title: string; has_method: boolean }>; paths: string[] };

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Whether the browser lets us read the clipboard without asking (so offering a copied link isn't a prompt). */
async function quietClipboardLink(): Promise<string | null> {
  try {
    const perm = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName });
    if (perm?.state !== 'granted') return null;
    return findLink(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}

export function ImportRecipe({ url: sharedUrl, text: sharedText, files: sharedFiles, mode, shared }: { url?: string; text?: string; files?: File[]; mode?: 'link' | 'photos' | 'text'; shared?: boolean }) {
  const { userId, back, replace, go, billing } = useApp();
  const [link, setLink] = useState(sharedUrl ?? '');
  const [text, setText] = useState(sharedText ?? '');
  const [textSource, setTextSource] = useState<DraftSource | null>(null);
  const [showText, setShowText] = useState(mode === 'text' || (!!sharedText && !sharedUrl));
  const [photos, setPhotos] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  /** Shared from another app: shown here, imported on a tap. */
  const [sharedLink, setSharedLink] = useState<string | null>(null);
  /** A recipe being checked that wasn't saved (the app was closed or refreshed). */
  const [unsaved, setUnsaved] = useState(() => readUnsaved(userId));
  // An answer that arrives after the household left this screen is dropped, not followed.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // After a while, say so: pages without recipe markup and photos take longer.
  useEffect(() => {
    if (phase.name !== 'working') { setSlow(false); return; }
    const id = window.setTimeout(() => setSlow(true), 9000);
    return () => window.clearTimeout(id);
  }, [phase.name]);

  /** What every answer leads to: the review screen, or a state of its own here. */
  const handle = (answer: ImportAnswer, retry: () => void, linkUrl?: string) => {
    if (!alive.current) return;
    switch (answer.status) {
      case 'ok':
      case 'partial':
        replace({ name: 'editor', draft: answer.draft, duplicate: answer.duplicate, note: answer.status === 'partial' ? answer.message : null });
        return;
      case 'duplicate': setPhase({ name: 'duplicate', ...answer.duplicate, url: linkUrl ?? '' }); return;
      case 'no_recipe':
        setPhase({ name: 'no_recipe', message: answer.message, source: answer.source, caption: answer.caption });
        if (answer.source) setTextSource(answer.source);
        if (answer.caption) setText(answer.caption);
        return;
      case 'capped': setPhase({ name: 'capped', message: answer.message }); return;
      case 'limit': setPhase({ name: 'limit', message: answer.message }); return;
      case 'choose': setPhase({ name: 'choose', recipes: answer.recipes, paths: answer.paths }); return;
      default: setPhase({ name: 'failed', message: answer.message, retry });
    }
  };

  /** The household picked one of the recipes in the photos: read just that one, from the same uploads. */
  const runPick = async (paths: string[], title: string) => {
    setPhase({ name: 'working', title: 'Importing', detail: `Reading ${title}` });
    handle(await importPickedRecipe(paths, title), () => runPick(paths, title));
  };

  /** Free's 20 imports: checked before anything is uploaded or read (the server checks too). */
  const LIMIT_MESSAGE = "You've used the 20 imports Free includes. Every recipe you imported stays yours, and you can still write one in by hand.";
  const importFits = async () => {
    const [imports, room] = await Promise.all([canImport(userId), canSaveRecipe(userId, null)]);
    if (!imports) { setPhase({ name: 'limit', message: LIMIT_MESSAGE }); return false; }
    // An import is saved as a recipe: with no room to save it, don't use up an import.
    if (!room) { billing.upgrade('saved_recipes'); return false; }
    return true;
  };

  const runLink = async (raw: string, allowDuplicate = false) => {
    const url = findLink(raw) ?? (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw.trim()) ? `https://${raw.trim()}` : null);
    if (!url) { setLinkError("That doesn't look like a link. Copy the address of the recipe or post and paste it here."); return; }
    setLinkError(null);
    setLink(url);
    if (!(await importFits())) return;
    setPhase({ name: 'working', title: 'Importing', detail: `Reading the recipe from ${host(url)}` });
    handle(await importFromLink(url, { allowDuplicate }), () => runLink(url, allowDuplicate), url);
  };

  const runText = async (body: string, source: DraftSource | null) => {
    if (body.trim().length < 20) return;
    if (!(await importFits())) return;
    setPhase({ name: 'working', title: 'Importing', detail: 'Reading the recipe from your text' });
    handle(await importFromText(body, source), () => runText(body, source));
  };

  const photoStep = (s: PhotoStep, total: number) => {
    const n = total === 1 ? 'photo' : `${total} photos`;
    if (s.step === 'preparing') return `Getting the ${n} ready${total > 1 ? ` (${s.done + 1} of ${total})` : ''}`;
    if (s.step === 'uploading') return `Uploading${total > 1 ? ` (${s.done + 1} of ${total})` : ''}`;
    return total > 1 ? 'Reading the recipe across the pages' : 'Reading the recipe';
  };
  const runPhotos = async (files: File[]) => {
    if (!files.length) return;
    if (!(await importFits())) return;
    setPhase({ name: 'working', title: 'Importing', detail: photoStep({ step: 'preparing', done: 0, total: files.length }, files.length) });
    const answer = await importFromPhotos(userId, files, s => setPhase({ name: 'working', title: 'Importing', detail: photoStep(s, files.length), step: s.step }));
    handle(answer, () => runPhotos(files));
  };

  // Something shared into Forka or picked before this screen opened: start right away.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (shared) {
      // From the share sheet: show it, ready to import. Nothing runs until the household taps.
      if (sharedFiles?.length) setPhotos(sharedFiles.slice(0, MAX_IMPORT_PHOTOS));
      else if (sharedUrl) { setLink(sharedUrl); setSharedLink(sharedUrl); }
      else if (sharedText) setShowText(true);
      return;
    }
    if (sharedFiles?.length) { setPhotos(sharedFiles.slice(0, MAX_IMPORT_PHOTOS)); void runPhotos(sharedFiles.slice(0, MAX_IMPORT_PHOTOS)); return; }
    if (sharedUrl) { void runLink(sharedUrl); return; }
    if (sharedText) { void runText(sharedText, null); return; }
    if (mode === 'photos') fileRef.current?.click();
    else if (mode === 'text') textRef.current?.focus();
    else if (mode === 'link') linkRef.current?.focus();
    // A link already on the clipboard, offered only where the browser allows reading it without a prompt.
    quietClipboardLink().then(setCopied);
    // Runs once, with what the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "Paste link": the clipboard where the browser allows it, else the field to paste into. */
  const pasteLink = async () => {
    try {
      const fromClipboard = findLink(await navigator.clipboard.readText());
      if (fromClipboard) { void runLink(fromClipboard); return; }
      setLinkError("There's no link on your clipboard. Copy the recipe's address, then try again.");
    } catch {
      linkRef.current?.focus();
    }
  };

  const addPhotos = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...photos, ...Array.from(list)].slice(0, MAX_IMPORT_PHOTOS);
    setPhotos(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const reset = () => setPhase({ name: 'idle' });
  const writeIt = () => replace({ name: 'editor' });
  const fileInput = <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={e => addPhotos(e.target.files)} />;

  // ── States after an attempt ──
  if (phase.name === 'working') {
    return (
      <PageContainer title="Importing" onBack={back}>
        <Card className="p-6" aria-live="polite" aria-busy>
          <div className="flex items-center gap-3">
            <Spinner className="size-6 text-green" />
            <p className="text-body font-semibold text-ink">{phase.detail}</p>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-green-soft"><div className="h-full w-1/3 animate-[import-slide_1.4s_ease-in-out_infinite] rounded-full bg-green" /></div>
          <p className="mt-4 text-small text-ink-muted">
            {slow ? 'Still reading. Long pages and handwriting take a little longer, up to about half a minute.' : 'Nothing is saved until you check it.'}
          </p>
        </Card>
      </PageContainer>
    );
  }
  if (phase.name === 'duplicate') {
    return (
      <PageContainer title="Already in your Library" onBack={back}>
        <Card className="p-6">
          <p className="text-body text-ink">You saved this one before as <span className="font-semibold">{phase.title}</span>.</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" icon={BookOpen} onClick={() => replace({ name: 'recipe', id: phase.id })}>Open the saved recipe</Button>
            <Button size="lg" variant="secondary" onClick={() => runLink(phase.url, true)}>Import again anyway</Button>
          </div>
        </Card>
      </PageContainer>
    );
  }
  if (phase.name === 'choose') {
    return (
      <PageContainer title="Which recipe?" onBack={back} intro={`These photos have ${phase.recipes.length} recipes. Choose the one to import.`}>
        <ul className="space-y-3">
          {phase.recipes.map(r => (
            <li key={r.title}>
              <button type="button" onClick={() => runPick(phase.paths, r.title)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-card border border-line bg-surface p-5 text-left shadow-sm transition-colors hover:border-green">
                <span className="min-w-0">
                  <span className="block text-heading text-ink">{r.title}</span>
                  {!r.has_method && <span className="mt-1 block text-small text-ink-muted">Ingredients only, no method on the page</span>}
                </span>
                <span className="shrink-0 text-body font-semibold text-green">Import</span>
              </button>
            </li>
          ))}
        </ul>
      </PageContainer>
    );
  }
  if (phase.name === 'limit') {
    return (
      <PageContainer title="You've used your 20 imports" onBack={back}>
        <Card className="p-6">
          <p className="text-body text-ink">{phase.message}</p>
          <p className="mt-3 text-body text-ink-muted">Pro imports as many recipes as you like, and plans your family's whole week.</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => go({ name: 'pro' })}>See what Pro adds</Button>
            <Button size="lg" variant="secondary" icon={PenLine} onClick={writeIt}>Add a recipe by hand</Button>
          </div>
        </Card>
      </PageContainer>
    );
  }
  if (phase.name === 'capped') {
    return (
      <PageContainer title="That's today's imports" onBack={back}>
        <Card className="p-6">
          <div className="flex gap-3"><Clock size={22} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-green" /><p className="text-body text-ink">{phase.message}</p></div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" icon={PenLine} onClick={writeIt}>Add a recipe by hand</Button>
            <Button size="lg" variant="secondary" onClick={back}>Done</Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  const other = (
    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
      <Button size="lg" icon={FileText} onClick={() => { setShowText(true); reset(); setTimeout(() => textRef.current?.focus(), 50); }}>Paste the recipe text</Button>
      <Button size="lg" variant="secondary" icon={Camera} onClick={() => { reset(); setTimeout(() => fileRef.current?.click(), 50); }}>Add screenshots</Button>
    </div>
  );
  if (phase.name === 'no_recipe') {
    return (
      <PageContainer title="No recipe found" onBack={back}>
        <Card className="p-6">
          <div className="flex gap-3"><SearchX size={22} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" /><p className="text-body text-ink">{phase.message}</p></div>
          {other}
          {phase.caption && <p className="mt-4 text-small text-ink-muted">The caption goes in the text box, so you can add the ingredients and steps to it.</p>}
        </Card>
        {fileInput}
      </PageContainer>
    );
  }
  if (phase.name === 'failed') {
    return (
      <PageContainer title="Couldn't import that" onBack={back}>
        <Card className="p-6">
          <div className="flex gap-3"><TriangleAlert size={22} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-terracotta" /><p className="text-body text-ink">{phase.message}</p></div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={phase.retry}>Try again</Button>
            <Button size="lg" variant="secondary" icon={Camera} onClick={() => { reset(); setTimeout(() => fileRef.current?.click(), 50); }}>Add screenshots</Button>
          </div>
          <Button variant="ghost" icon={FileText} className="mt-3" onClick={() => { setShowText(true); reset(); setTimeout(() => textRef.current?.focus(), 50); }}>Paste the recipe text</Button>
        </Card>
        {fileInput}
      </PageContainer>
    );
  }

  // ── Start ──
  return (
    <PageContainer title="Import a recipe" onBack={back} intro="From a recipe site, a social post, or photos of a cookbook page or recipe card.">
      {unsaved && !shared && (
        <Card className="mb-4 p-4">
          <p className="text-body text-ink">You were checking <span className="font-semibold">{unsaved.title || 'a recipe'}</span>. It isn't saved yet.</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => replace({ name: 'editor', draft: unsaved })}>Continue checking</Button>
            <Button variant="ghost" onClick={() => { clearUnsaved(); setUnsaved(null); }}>Discard it</Button>
          </div>
        </Card>
      )}
      {sharedLink && (
        <Card className="mb-4 p-4">
          <p className="text-body text-ink">Shared with Forka: <span className="font-semibold">{host(sharedLink)}</span></p>
          <p className="mt-1 truncate text-small text-ink-muted">{sharedLink}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => { setSharedLink(null); void runLink(sharedLink); }}>Import it</Button>
            <Button variant="ghost" onClick={() => setSharedLink(null)}>Not now</Button>
          </div>
        </Card>
      )}
      {copied && copied !== link && !sharedLink && (
        <Card className="mb-4 flex items-center gap-3 p-4">
          <ClipboardPaste size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-green" />
          <p className="min-w-0 flex-1 truncate text-body text-ink">Import the link you copied from <span className="font-semibold">{host(copied)}</span>?</p>
          <Button size="sm" onClick={() => runLink(copied)}>Import</Button>
          <IconButton icon={X} label="No thanks" size="sm" onClick={() => setCopied(null)} />
        </Card>
      )}

      <section aria-labelledby="by-link">
        <h2 id="by-link" className="label mb-2 px-1">Link</h2>
        <Button size="lg" icon={ClipboardPaste} block onClick={pasteLink}>Paste link</Button>
        <form noValidate className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void runLink(link); }}>
          <Input ref={linkRef} label="Recipe or post link" hideLabel className="min-w-0 flex-1" type="url" inputMode="url" autoComplete="off" value={link}
            placeholder="Or type or paste it here" leading={<Link2 size={20} strokeWidth={1.75} aria-hidden />}
            onChange={e => { setLink(e.target.value); setLinkError(null); }} error={linkError ?? undefined} />
          <Button type="submit" size="lg" variant="secondary" disabled={!link.trim()}>Import</Button>
        </form>
        <p className="mt-2 px-1 text-small text-ink-muted">Recipe sites, TikTok, Instagram, YouTube, Pinterest and Facebook.</p>
      </section>

      <section aria-labelledby="by-photo" className="mt-8">
        <h2 id="by-photo" className="label mb-2 px-1">Photos</h2>
        <Button size="lg" variant="secondary" icon={ImagePlus} block onClick={() => fileRef.current?.click()}>{photos.length ? 'Add more photos' : 'Add photos'}</Button>
        {fileInput}
        {photos.length > 0 && (
          <Card className="mt-3 p-4">
            <ul className="flex flex-wrap gap-3">
              {photos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative">
                  <Thumb file={f} />
                  <span className="absolute top-1 left-1 rounded-full bg-scrim px-2 text-caption font-semibold text-surface">{i + 1}</span>
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                    className="absolute -top-2 -right-2 flex size-7 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm"><X size={14} strokeWidth={2} aria-hidden /></button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-small text-ink-muted">{photos.length === 1 ? 'One photo.' : `${photos.length} photos, read in this order as one recipe.`} Up to {MAX_IMPORT_PHOTOS}.</p>
            <Button size="lg" className="mt-3 w-full sm:w-auto" onClick={() => runPhotos(photos)}>{photos.length === 1 ? 'Import this photo' : `Import ${photos.length} photos`}</Button>
          </Card>
        )}
        <p className="mt-2 px-1 text-small text-ink-muted">Cookbook pages, screenshots and handwritten cards. Photos stay private to your family.</p>
      </section>

      <section aria-labelledby="by-text" className="mt-8">
        {showText ? (
          <>
            <Textarea ref={textRef} id="by-text" label="Recipe text" value={text} onChange={e => setText(e.target.value)} fieldClassName="min-h-44 resize-y"
              placeholder={'Paste the ingredients and steps, for example from a caption or an email.'} />
            <Button size="lg" className="mt-3" disabled={text.trim().length < 20} onClick={() => runText(text, textSource)}>Import text</Button>
          </>
        ) : (
          <Button variant="ghost" icon={FileText} onClick={() => { setShowText(true); setTimeout(() => textRef.current?.focus(), 50); }}>Paste recipe text instead</Button>
        )}
      </section>

      <div className={cx('mt-8 border-t border-line pt-6')}>
        <Button variant="ghost" icon={PenLine} onClick={writeIt}>Write a recipe yourself</Button>
        <Button variant="ghost" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse Forka recipes</Button>
      </div>
    </PageContainer>
  );
}

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <span className="photo block size-20 overflow-hidden rounded-photo bg-green-soft">
      {url && <img src={url} alt="" className="size-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}
