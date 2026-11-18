import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePhotoSrc } from '../lib/recipePhotos';
import type { PrintData } from '../lib/printData';

// The printed recipe: one recipe per page, readable at arm's length, no app chrome. It sits
// outside the app (a portal on <body>), is hidden on screen, and is the only thing that
// prints (index.css, @media print). Print from the recipe's options, or the browser's own
// Print, both give this page.

export function PrintView({ data }: { data: PrintData }) {
  const photo = usePhotoSrc(data.photo);
  // While this view is on the page, printing gives the recipe and nothing else.
  useEffect(() => {
    document.body.classList.add('print-recipe');
    return () => document.body.classList.remove('print-recipe');
  }, []);
  return createPortal(
    <article id="print-root" aria-hidden className="print-recipe">
      <h1 className="display text-[26pt] leading-[1.1] text-ink">{data.title}</h1>
      <div className="mt-3 mb-4 h-0.5 w-16 bg-green" />
      <p className="text-[12pt] text-ink-muted">{data.facts.join('   ·   ')}</p>
      {photo && <img src={photo} alt="" className="mt-4 h-[46mm] w-full rounded-[4mm] object-cover" referrerPolicy="no-referrer" />}
      <div className="mt-5 grid grid-cols-[36%_1fr] gap-[8mm]">
        <section>
          <h2 className="mb-2 text-[10pt] font-bold tracking-[0.12em] text-ink-muted uppercase">Ingredients</h2>
          <ul className="space-y-[1.6mm] text-[12pt] leading-snug">
            {data.ingredients.map((ing, i) => (
              <li key={i} className="break-inside-avoid">{ing.amount && <b className="font-semibold">{ing.amount} </b>}{ing.name}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-[10pt] font-bold tracking-[0.12em] text-ink-muted uppercase">Steps</h2>
          <ol className="space-y-[2mm] text-[12pt] leading-[1.4]">
            {data.steps.map((s, i) => (
              <li key={i} className="flex gap-[3mm] break-inside-avoid">
                <span className="print-step-number">{i + 1}</span><span>{s}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {data.notes && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-2 text-[10pt] font-bold tracking-[0.12em] text-ink-muted uppercase">Notes</h2>
          <p className="text-[12pt] whitespace-pre-line">{data.notes}</p>
        </section>
      )}
      <footer className="print-footer flex justify-between border-t border-line pt-2 text-[9.5pt] text-ink-muted">
        <span>{data.credit}{data.creditUrl ? `  ·  ${data.creditUrl.replace(/^https?:\/\/(www\.)?/, '')}` : ''}</span>
        <span>Forka</span>
      </footer>
    </article>,
    document.body,
  );
}
