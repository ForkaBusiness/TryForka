// Measures photo import accuracy on test-imports/ (ground truth in truth.json), with the
// same prompt, schema and parsing the import-recipe function uses.
//   ANTHROPIC_API_KEY=... deno run --allow-env --allow-read --allow-write --allow-net \
//     scripts/eval-photo-import.ts [model ...]
// Default model: claude-haiku-5-5 (what import-recipe uses); name others to compare.
// Writes docs/imports/photo-eval.md (scores) and test-imports/eval-raw.json (every line the
// model returned, git-ignored, for looking into misses). About a tenth of a cent per image
// on Haiku 5.5.

import { readPhotos, type Photo } from '../supabase/functions/_shared/imports/extract.ts';
import { draftFromModel } from '../supabase/functions/_shared/imports/modelDraft.ts';
import type { ImportDraft } from '../supabase/functions/_shared/imports/draft.ts';

const DIR = new URL('../test-imports/', import.meta.url);
const PRICE: Record<string, [number, number]> = { // $ per million tokens, in / out
  'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
};
type TruthIng = [string, number | null, string, string];
interface Truth {
  kind: string; title: string | null; servings?: number | null; ingredients: TruthIng[]; steps: string[];
  expectFlag?: number; blurry?: boolean;
  /** Truth drafted from the photo and not yet confirmed by a person, with what to confirm. */
  draft?: boolean; questions?: string[];
  /** What the review screen must show for this photo. */
  expect?: {
    /** Several recipes in the photo: the household is asked to pick (this one is picked). */
    pick?: string;
    /** A line printed twice is flagged as a repeat, at this 0-based line. */
    duplicateFlagAt?: number;
    /** An ingredient only in the steps is flagged, with this word in the line to add. */
    addFlag?: string;
    /** The notes include this (a headnote, not a step). */
    notesInclude?: string;
  };
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/(es|s)$/, ''));
const covers = (have: string, want: string) => { const h = new Set(words(have)); return words(want).every(w => h.has(w)); };
const mediaTypeOf = (file: string): Photo['mediaType'] => (/\.webp$/i.test(file) ? 'image/webp' : /\.png$/i.test(file) ? 'image/png' : 'image/jpeg');
const exists = async (file: string) => { try { await Deno.stat(new URL(file, DIR)); return true; } catch { return false; } };

function score(t: Truth, d: ImportDraft | null, isRecipe: boolean) {
  if (!t.title) return { pass: !isRecipe, note: isRecipe ? 'invented a recipe from a food photo' : 'said there is no recipe' };
  if (t.blurry && (!isRecipe || !d)) return { pass: true, note: 'refused: no recipe read' };
  if (!d) return { pass: false, note: 'no recipe read' };
  const out = {
    title: covers(d.title, t.title) || covers(t.title, d.title), servings: (t.servings ?? null) === null || d.servings === t.servings,
    correct: 0, wrongAmount: [] as string[], wrongFlagged: 0, blankFlagged: [] as string[], missing: [] as string[], flaggedRight: 0, unflaggedFade: false, extra: 0, stepsFound: 0, steps: t.steps.length,
    expectations: [] as string[],
  };
  const used = new Set<number>();
  t.ingredients.forEach(([raw, qty, unit, item]) => {
    const i = d.ingredients.findIndex((x, k) => !used.has(k) && covers(`${x.item} ${x.note}`, item));
    if (i < 0) { out.missing.push(item); return; }
    used.add(i);
    const x = d.ingredients[i];
    const flagged = d.flags.some(f => f.field === 'ingredients' && f.index === i);
    const sameQty = qty === null ? x.quantity === null : x.quantity !== null && Math.abs(x.quantity - qty) < 0.02;
    const sameUnit = (x.unit || '') === (unit || '');
    if (raw === 'FADED') {
      // Read correctly, or left blank and flagged: both honest. Any other number is a guess.
      if (x.quantity === null ? flagged : Math.abs(x.quantity - 1 / 3) < 0.02) { out.correct++; out.flaggedRight++; }
      else if (x.quantity === null) out.unflaggedFade = true;
      else out.wrongAmount.push(`${item}: ${x.quantity} (truth unreadable 1/3)`);
      return;
    }
    // A wrong amount the household is told to check is still wrong, but not silent: counted apart.
    const wrong = (text: string) => { out.wrongAmount.push(flagged ? `${text} [flagged]` : text); if (flagged) out.wrongFlagged++; };
    if (sameQty && sameUnit) out.correct++;
    // Left blank and flagged where the photo has an amount: not read, but not guessed either.
    else if (x.quantity === null && qty !== null && flagged) out.blankFlagged.push(`${item} (truth ${raw})`);
    else if (x.quantity !== null && (qty === null || Math.abs(x.quantity - qty) >= 0.02)) wrong(`${item}: ${x.quantity} ${x.unit} (truth ${raw})`);
    else if (!sameUnit) wrong(`${item}: unit ${x.unit || 'none'} (truth ${raw})`);
    else if (flagged) { out.correct++; out.flaggedRight++; }
    else out.missing.push(`${item} amount`);
  });
  out.extra = d.ingredients.length - used.size;
  out.stepsFound = t.steps.filter(s => d.steps.some(x => covers(x, s.split(/[,.;]/)[0]))).length;
  const e = t.expect ?? {};
  if (e.duplicateFlagAt !== undefined && !d.flags.some(f => f.index === e.duplicateFlagAt && /appears twice/.test(f.reason))) out.expectations.push('repeated line not flagged');
  if (e.addFlag && !d.flags.some(f => f.add && covers(f.add, e.addFlag!))) out.expectations.push(`"${e.addFlag}" in the steps not flagged`);
  if (e.notesInclude && !d.notes.toLowerCase().includes(e.notesInclude.toLowerCase())) out.expectations.push(`notes missing "${e.notesInclude}"`);
  if (e.notesInclude && d.steps.some(s => s.toLowerCase().includes(e.notesInclude!.toLowerCase()))) out.expectations.push('headnote copied into the steps');
  const pass = out.title && out.wrongAmount.length === 0 && !out.unflaggedFade && out.missing.length === 0 && out.extra === 0 && out.stepsFound === out.steps && !out.expectations.length;
  return { pass, ...out };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const truth = JSON.parse(await Deno.readTextFile(new URL('truth.json', DIR))) as Record<string, Truth>;
const models = Deno.args.length ? Deno.args : ['claude-haiku-5-5'];
const rows: string[] = [];
const raw: Record<string, Record<string, unknown>> = {};
const summary: Record<string, { pass: number; total: number; wrong: number; wrongFlagged: number; cost: number; ms: number }> = {};

for (const model of models) {
  summary[model] = { pass: 0, total: 0, wrong: 0, wrongFlagged: 0, cost: 0, ms: 0 };
  raw[model] = {};
  for (const [key, t] of Object.entries(truth)) {
    // Several photos of one recipe are joined with "+"; a file name can contain "+" too.
    const files = await exists(key) ? [key] : key.split('+');
    // Photos that aren't on this machine (real photos are not committed) are skipped.
    if (!(await Promise.all(files.map(exists))).every(Boolean)) { console.log(`skipped ${key}: photo not in test-imports/`); continue; }
    const photos: Photo[] = [];
    for (const file of files) photos.push({ base64: toBase64(await Deno.readFile(new URL(file, DIR))), mediaType: mediaTypeOf(file) });
    const started = Date.now();
    let result;
    try {
      const [pin, pout] = PRICE[model] ?? [0, 0];
      const costOf = (u?: { input: number; output: number }) => (u ? (u.input * pin + u.output * pout) / 1e6 : 0);
      let read = await readPhotos(photos, model);
      let cost = costOf(read.usage);
      // Several recipes in the photos: the app asks which one, then reads that one again.
      // The eval picks the one the truth expects, like a person would.
      const seen = (read.recipe.recipes_seen ?? []).filter(r => r?.title?.trim());
      let chose = '';
      if (seen.length > 1) {
        const want = t.expect?.pick ?? t.title ?? '';
        const pick = seen.find(r => covers(r.title, want) || covers(want, r.title))?.title ?? seen[0].title;
        chose = `listed ${seen.map(r => `"${r.title}"`).join(', ')}; picked "${pick}"`;
        read = await readPhotos(photos, model, pick);
        cost += costOf(read.usage);
      } else if (t.expect?.pick) {
        chose = `expected a choice between recipes, but only ${seen.length || 'no'} recipe was listed`;
      }
      raw[model][key] = { recipes_seen: seen, chose, title: read.recipe.title, servings: read.recipe.servings, is_recipe: read.recipe.is_recipe,
        ingredients: read.recipe.ingredients, steps: read.recipe.steps, notes: read.recipe.notes, only_in_steps: read.recipe.only_in_steps };
      const d = draftFromModel(read.recipe, { kind: 'photo', url: null, site_name: null }, { photo: true });
      const s: Record<string, unknown> = { ...score(t, read.recipe.is_recipe ? d : null, read.recipe.is_recipe) };
      if (chose) s.chose = chose;
      if (t.expect?.pick && seen.length < 2) { s.pass = false; s.expectations = [...((s.expectations as string[]) ?? []), 'no choice offered']; }
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
    if (typeof s.wrongFlagged === 'number') sum.wrongFlagged += s.wrongFlagged;
    rows.push(`| ${model} | ${key}${t.draft ? ' (draft truth)' : ''} | ${result.s.pass ? 'pass' : 'FAIL'} | ${'correct' in s ? `${s.correct}/${t.ingredients.length}` : '-'} | ${'stepsFound' in s ? `${s.stepsFound}/${s.steps}` : '-'} | ${result.flags} | ${[
      ...(Array.isArray(s.wrongAmount) && s.wrongAmount.length ? [`wrong: ${(s.wrongAmount as string[]).join('; ')}`] : []),
      ...(Array.isArray(s.missing) && s.missing.length ? [`missing: ${(s.missing as string[]).join(', ')}`] : []),
      ...(s.extra ? [`${s.extra} extra lines`] : []), ...(s.unflaggedFade ? ['faded amount left blank without a flag'] : []),
      ...(Array.isArray(s.blankFlagged) && s.blankFlagged.length ? [`left blank and flagged: ${(s.blankFlagged as string[]).join(', ')}`] : []),
      ...(Array.isArray(s.expectations) && s.expectations.length ? [`review screen: ${(s.expectations as string[]).join(', ')}`] : []),
      ...(s.chose ? [String(s.chose)] : []),
      ...(s.title === false ? ['title wrong'] : []), ...(s.note ? [String(s.note)] : []),
    ].join('. ') || 'all correct'} | ${(ms / 1000).toFixed(1)}s | $${result.cost.toFixed(4)} |`);
    console.log(rows.at(-1));
  }
}

const table = Object.entries(summary)
  .map(([m, s]) => `| ${m} | ${s.pass}/${s.total} | ${s.wrong - s.wrongFlagged} | ${s.wrongFlagged} | $${(s.cost / s.total).toFixed(4)} | ${(s.ms / s.total / 1000).toFixed(1)}s |`).join('\n');
const questions = Object.entries(truth).filter(([, t]) => t.draft && t.questions?.length)
  .map(([k, t]) => `- **${k}** (${t.kind}): ${t.questions!.join(' ')}`).join('\n');
const report = `# Photo import: measured accuracy

Run ${new Date().toISOString().slice(0, 10)} on test-imports/ (${Object.keys(truth).length} cases), same prompt and parsing as import-recipe.

| Model | Cases passed | Wrong amounts, not flagged | Wrong amounts, flagged | Cost per import | Time per import |
|---|---|---|---|---|---|
${table}

| Model | Case | Result | Ingredients right | Steps found | Flags | Notes | Time | Cost |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
${questions ? `\n## Ground truth still to confirm\n\n${questions}\n` : ''}`;
await Deno.writeTextFile(new URL('eval-raw.json', DIR), JSON.stringify(raw, null, 1));
await Deno.mkdir(new URL('../docs/imports/', import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL('../docs/imports/photo-eval.md', import.meta.url), report);
console.log(`\n${table}`);
