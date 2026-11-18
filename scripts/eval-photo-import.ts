// Measures photo import accuracy per model on test-imports/ (ground truth in truth.json),
// with the same prompt, schema and parsing the import-recipe function uses.
//   ANTHROPIC_API_KEY=... deno run --allow-env --allow-read --allow-write --allow-net \
//     scripts/eval-photo-import.ts [model ...]
// Default models: claude-haiku-5-5, claude-haiku-4-5, claude-sonnet-5-5. Writes
// docs/imports/photo-eval.md and prints a summary. Every run costs a little (about a cent
// per image on Haiku 5.5, more on Sonnet).

import { readPhotos, type Photo } from '../supabase/functions/_shared/imports/extract.ts';
import { draftFromModel } from '../supabase/functions/_shared/imports/modelDraft.ts';
import type { ImportDraft } from '../supabase/functions/_shared/imports/draft.ts';

const DIR = new URL('../test-imports/', import.meta.url);
const PRICE: Record<string, [number, number]> = { // $ per million tokens, in / out
  'claude-haiku-5-5': [0.10, 0.50], 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
};
type TruthIng = [string, number | null, string, string];
interface Truth { kind: string; title: string | null; servings?: number | null; ingredients: TruthIng[]; steps: string[]; expectFlag?: number; blurry?: boolean }

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/(es|s)$/, ''));
const covers = (have: string, want: string) => { const h = new Set(words(have)); return words(want).every(w => h.has(w)); };

function score(t: Truth, d: ImportDraft | null, isRecipe: boolean) {
  if (!t.title) return { pass: !isRecipe, note: isRecipe ? 'invented a recipe from a food photo' : 'said there is no recipe' };
  if (t.blurry) {
    if (!isRecipe || !d) return { pass: true, note: 'refused: no recipe read' };
  }
  if (!d) return { pass: false, note: 'no recipe read' };
  const out = { title: covers(d.title, t.title) || covers(t.title, d.title), servings: (t.servings ?? null) === null || d.servings === t.servings,
    correct: 0, wrongAmount: [] as string[], missing: [] as string[], flaggedRight: 0, unflaggedFade: false, extra: 0, stepsFound: 0, steps: t.steps.length };
  const used = new Set<number>();
  t.ingredients.forEach(([raw, qty, unit, item], n) => {
    const i = d.ingredients.findIndex((x, k) => !used.has(k) && covers(`${x.item} ${x.note}`, item));
    if (i < 0) { out.missing.push(item); return; }
    used.add(i);
    const x = d.ingredients[i];
    const flagged = d.flags.some(f => f.field === 'ingredients' && f.index === i);
    const sameQty = qty === null ? x.quantity === null : x.quantity !== null && Math.abs(x.quantity - qty) < 0.02;
    const sameUnit = (x.unit || '') === (unit || '') || (unit === '' && ['clove', 'stalk'].includes(x.unit));
    if (raw === 'FADED') {
      // Read correctly, or left blank and flagged: both honest. Any other number is a guess.
      if (x.quantity === null ? flagged : Math.abs(x.quantity - 1 / 3) < 0.02) { out.correct++; out.flaggedRight++; }
      else if (x.quantity === null) out.unflaggedFade = true;
      else out.wrongAmount.push(`${item}: ${x.quantity} (truth unreadable 1/3)`);
      return;
    }
    if (sameQty && sameUnit) out.correct++;
    else if (x.quantity !== null && (qty === null || Math.abs(x.quantity - qty) >= 0.02)) out.wrongAmount.push(`${item}: ${x.quantity} ${x.unit} (truth ${raw})`);
    else if (!sameUnit) out.wrongAmount.push(`${item}: unit ${x.unit} (truth ${raw})`);
    else out.missing.push(`${item} amount`);
  });
  out.extra = d.ingredients.length - used.size;
  out.stepsFound = t.steps.filter(s => d.steps.some(x => covers(x, s.split(/[,.;]/)[0]))).length;
  const pass = out.title && out.wrongAmount.length === 0 && !out.unflaggedFade && out.missing.length === 0 && out.extra === 0 && out.stepsFound === out.steps;
  return { pass, ...out };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const truth = JSON.parse(await Deno.readTextFile(new URL('truth.json', DIR))) as Record<string, Truth>;
const models = Deno.args.length ? Deno.args : ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5'];
const rows: string[] = [];
const summary: Record<string, { pass: number; total: number; wrong: number; cost: number; ms: number }> = {};

for (const model of models) {
  summary[model] = { pass: 0, total: 0, wrong: 0, cost: 0, ms: 0 };
  for (const [key, t] of Object.entries(truth)) {
    const photos: Photo[] = [];
    for (const file of key.split('+')) photos.push({ base64: toBase64(await Deno.readFile(new URL(file, DIR))), mediaType: 'image/jpeg' });
    const started = Date.now();
    let result;
    try {
      const read = await readPhotos(photos, model);
      const d = draftFromModel(read.recipe, { kind: 'photo', url: null, site_name: null });
      const s = score(t, read.recipe.is_recipe ? d : null, read.recipe.is_recipe);
      const [pin, pout] = PRICE[model] ?? [0, 0];
      const cost = read.usage ? (read.usage.input * pin + read.usage.output * pout) / 1e6 : 0;
      result = { s, cost, flags: d.flags.length };
    } catch (err) {
      result = { s: { pass: false, note: `error: ${err instanceof Error ? err.message : err}` }, cost: 0, flags: 0 };
    }
    const ms = Date.now() - started;
    const sum = summary[model];
    sum.total++; sum.cost += result.cost; sum.ms += ms;
    if (result.s.pass) sum.pass++;
    const s = result.s as Record<string, unknown>;
    if (Array.isArray(s.wrongAmount)) sum.wrong += (s.wrongAmount as string[]).length;
    rows.push(`| ${model} | ${key} | ${result.s.pass ? 'pass' : 'FAIL'} | ${'correct' in s ? `${s.correct}/${truth[key].ingredients.length}` : '-'} | ${'stepsFound' in s ? `${s.stepsFound}/${s.steps}` : '-'} | ${result.flags} | ${[
      ...(Array.isArray(s.wrongAmount) && s.wrongAmount.length ? [`wrong: ${(s.wrongAmount as string[]).join('; ')}`] : []),
      ...(Array.isArray(s.missing) && s.missing.length ? [`missing: ${(s.missing as string[]).join(', ')}`] : []),
      ...(s.extra ? [`${s.extra} extra lines`] : []), ...(s.unflaggedFade ? ['faded amount left blank without a flag'] : []),
      ...(s.title === false ? ['title wrong'] : []), ...(s.note ? [String(s.note)] : []),
    ].join('. ') || 'all correct'} | ${(ms / 1000).toFixed(1)}s | $${result.cost.toFixed(4)} |`);
    console.log(rows.at(-1));
  }
}

const table = Object.entries(summary).map(([m, s]) => `| ${m} | ${s.pass}/${s.total} | ${s.wrong} | $${(s.cost / s.total).toFixed(4)} | ${(s.ms / s.total / 1000).toFixed(1)}s |`).join('\n');
const report = `# Photo import: measured accuracy per model\n\nRun ${new Date().toISOString().slice(0, 10)} on test-imports/ (${Object.keys(truth).length} cases), same prompt and parsing as import-recipe.\n\n| Model | Cases passed | Wrong amounts | Cost per import | Time per import |\n|---|---|---|---|---|\n${table}\n\n| Model | Case | Result | Ingredients right | Steps found | Flags | Notes | Time | Cost |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
await Deno.mkdir(new URL('../docs/imports/', import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL('../docs/imports/photo-eval.md', import.meta.url), report);
console.log(`\n${table}`);
