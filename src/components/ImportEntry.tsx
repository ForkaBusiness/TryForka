import { useRef } from 'react';
import { ClipboardPaste, ImagePlus } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { findLink, MAX_IMPORT_PHOTOS } from '../lib/imports';
import { Button, ListRow, cx } from './ds';

// The way in to Import from the Library and the week plan: "Paste link" (the copied link,
// where the browser lets us read it on this tap) and "Add photos" (the picker, straight away).
// Both open the import screen already started.

function useImportEntry() {
  const { go } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteLink = async () => {
    let url: string | null = null;
    try { url = findLink(await navigator.clipboard.readText()); } catch { /* the import screen has a field to paste into */ }
    go(url ? { name: 'import', url } : { name: 'import', mode: 'link' });
  };
  const addPhotos = () => fileRef.current?.click();
  const input = (
    <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="sr-only" tabIndex={-1} aria-hidden
      onChange={e => {
        const files = Array.from(e.target.files ?? []).slice(0, MAX_IMPORT_PHOTOS);
        e.target.value = '';
        if (files.length) go({ name: 'import', files });
      }} />
  );
  return { pasteLink, addPhotos, input };
}

/** Two buttons side by side, for the Library. */
export function ImportButtons({ className }: { className?: string }) {
  const { pasteLink, addPhotos, input } = useImportEntry();
  return (
    <div className={cx('flex gap-2', className)}>
      <Button size="sm" variant="secondary" icon={ClipboardPaste} onClick={pasteLink}>Paste link</Button>
      <Button size="sm" variant="secondary" icon={ImagePlus} onClick={addPhotos}>Add photos</Button>
      {input}
    </div>
  );
}

/** Two rows, for a list of actions (the week plan's "Plan" group). */
export function ImportRows({ iconClass }: { iconClass: string }) {
  const { pasteLink, addPhotos, input } = useImportEntry();
  return (
    <>
      <ListRow leading={<ClipboardPaste size={20} strokeWidth={1.75} aria-hidden className={iconClass} />} title="Paste a recipe link" subtitle="From a recipe site or a social post" chevron onClick={pasteLink} />
      <ListRow leading={<ImagePlus size={20} strokeWidth={1.75} aria-hidden className={iconClass} />} title="Add recipe photos" subtitle="A cookbook page, screenshots or a recipe card" chevron onClick={addPhotos} />
      {input}
    </>
  );
}
