import { pdfName, type PrintData } from './printData';
import { signedPhotoUrl, isPhotoRef } from './recipePhotos';

// A recipe as a PDF file in the Glazed Pantry look: cream page, serif title, green
// accents, the photo, ingredients beside the steps, and the source credit. One recipe per
// file, starting on its own page; a long one carries on to a second. Built on the device
// (jsPDF, loaded only when someone downloads), so nothing is sent anywhere.
//
// The app's own fonts ship only as WOFF2, which jsPDF can't embed, so the PDF uses the
// standard PDF serif (Times) for the title and sans (Helvetica) for the text. The printed
// page (Print) uses the app's fonts.

const INK: [number, number, number] = [42, 37, 32];
const MUTED: [number, number, number] = [111, 102, 92];
const GREEN: [number, number, number] = [47, 93, 58];
const LINE: [number, number, number] = [230, 221, 205];
const CREAM: [number, number, number] = [251, 248, 241];

/** The photo as a JPEG data URL, cropped to fill w x h (cover). Null if it can't be read. */
async function photoData(src: string, w: number, h: number): Promise<string | null> {
  const url = isPhotoRef(src) ? await signedPhotoUrl(src) : src;
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    await img.decode();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d')!;
    const r = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const dw = img.naturalWidth * r;
    const dh = img.naturalHeight * r;
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

export async function downloadRecipePdf(data: PrintData, paper: 'letter' | 'a4'): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: paper });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const page = () => { doc.setFillColor(...CREAM); doc.rect(0, 0, W, H, 'F'); };
  page();
  const ensure = (needed: number) => { if (y + needed > H - M - 24) { doc.addPage(); page(); y = M; } };

  // Title and facts
  doc.setFont('times', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...INK);
  const title = doc.splitTextToSize(data.title, W - 2 * M) as string[];
  doc.text(title, M, y + 22);
  y += 22 + (title.length - 1) * 30 + 14;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1.5);
  doc.line(M, y, M + 64, y);
  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...MUTED);
  doc.text(data.facts.join('   ·   '), M, y);
  y += 22;

  // Photo
  if (data.photo) {
    const ph = Math.min(170, (W - 2 * M) * 0.36);
    const img = await photoData(data.photo, W - 2 * M, ph);
    if (img) { doc.addImage(img, 'JPEG', M, y, W - 2 * M, ph); y += ph + 24; }
  }

  // Ingredients (left) and steps (right)
  const gap = 28;
  const leftW = (W - 2 * M - gap) * 0.36;
  const rightX = M + leftW + gap;
  const rightW = W - M - rightX;
  const top = y;
  const heading = (text: string, x: number, at: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(text.toUpperCase(), x, at, { charSpace: 1.2 });
  };

  const startPage = doc.getNumberOfPages();
  heading('Ingredients', M, y);
  let ly = y + 20;
  doc.setFontSize(12);
  for (const ing of data.ingredients) {
    const amount = ing.amount ? `${ing.amount}  ` : '';
    const lines = doc.splitTextToSize(`${amount}${ing.name}`, leftW) as string[];
    if (ly + lines.length * 16 > H - M - 24) { doc.addPage(); page(); ly = M + 20; heading('Ingredients, continued', M, M); }
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK);
    // Amount in bold, the name regular: drawn as two runs on the first line.
    const first = lines[0];
    if (amount && first.startsWith(amount.trim())) {
      doc.text(amount.trim(), M, ly);
      const width = doc.getTextWidth(amount.trim()) + 4; // measured in bold, where it was drawn
      doc.setFont('helvetica', 'normal');
      doc.text(first.slice(amount.trim().length).trimStart(), M + width, ly);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.text(first, M, ly);
    }
    doc.setFont('helvetica', 'normal');
    lines.slice(1).forEach((l, i) => doc.text(l, M, ly + (i + 1) * 16));
    ly += lines.length * 16 + 6;
  }
  const leftPage = doc.getNumberOfPages();
  // Notes go under the ingredients when there's room there, so the recipe stays on one page.
  let notesDone = false;
  if (data.notes) {
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(data.notes, leftW) as string[];
    if (ly + 34 + lines.length * 15 < H - M - 24) {
      heading('Notes', M, ly + 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...INK);
      doc.text(lines, M, ly + 34, { lineHeightFactor: 1.35 });
      ly += 34 + lines.length * 15;
      notesDone = true;
    }
  }

  // Steps start beside the ingredients and carry on to the next page when they run out of room.
  doc.setPage(startPage);
  heading('Steps', rightX, top);
  let ry = top + 20;
  let rightPage = startPage;
  data.steps.forEach((step, i) => {
    const lines = doc.splitTextToSize(step, rightW - 26) as string[];
    if (ry + lines.length * 16 > H - M - 24) {
      rightPage++;
      if (rightPage > doc.getNumberOfPages()) { doc.addPage(); page(); } else doc.setPage(rightPage);
      ry = M + 20;
      heading('Steps, continued', rightX, M);
    }
    doc.setFillColor(227, 235, 220);
    doc.circle(rightX + 9, ry - 4, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GREEN);
    doc.text(String(i + 1), rightX + 9, ry - 0.5, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5); doc.setTextColor(...INK);
    doc.text(lines, rightX + 26, ry, { lineHeightFactor: 1.35 });
    ry += lines.length * 15.5 + 9;
  });

  // Notes and credit, under whichever column ran longer.
  const last = doc.getNumberOfPages();
  doc.setPage(last);
  y = Math.max(leftPage === last ? ly : M, rightPage === last ? ry : M) + 10;
  if (data.notes && !notesDone) {
    const lines = doc.splitTextToSize(data.notes, W - 2 * M) as string[];
    ensure(30 + lines.length * 16);
    heading('Notes', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...INK);
    doc.text(lines, M, y + 20);
    y += 20 + lines.length * 16 + 10;
  }
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.75);
    doc.line(M, H - M - 8, W - M, H - M - 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
    const credit = data.creditUrl ? `${data.credit}  ·  ${data.creditUrl.replace(/^https?:\/\/(www\.)?/, '')}` : data.credit;
    doc.text(doc.splitTextToSize(credit, W - 2 * M - 80)[0], M, H - M + 8);
    if (data.creditUrl) doc.link(M, H - M - 2, W - 2 * M - 80, 14, { url: data.creditUrl });
    doc.text('Forka', W - M, H - M + 8, { align: 'right' });
  }
  doc.save(pdfName(data.title));
}
