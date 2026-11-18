// Measures photo import accuracy on test-imports/, with the same prompt, schema and parsing
// the import-recipe function uses.
//   ANTHROPIC_API_KEY=... deno run --allow-env --allow-read --allow-write --allow-net \
//     scripts/eval-photo-import.ts [model ...]
//   deno run --allow-read --allow-write scripts/eval-photo-import.ts --rescore
//     (no model calls: scores the last run's saved answers with the current rules)
//
// Ground truth: test-imports/truth.json (the synthetic set, committed) and, if present,
// test-imports/truth.local.json (real photos, git-ignored with the photos themselves). Cases
// from the local file are private: the report gives only their scores and what was flagged,
// never their ingredients, titles or text.
// Default model: claude-haiku-5-5 (what import-recipe uses). Writes docs/imports/photo-eval.md
// and test-imports/eval-raw.json (every line the model returned; git-ignored).

import { readPhotos, type Photo } from '../supabase/functions/_shared/imports/extract.ts';
import { draftFromModel, type ModelRecipe } from '../supabase/functions/_shared/imports/modelDraft.ts';
import type { DraftFlag, ImportDraft } from '../supabase/functions/_shared/imports/draft.ts';

const DIR = new URL('../test-imports/', import.meta.url);
const RAW = new URL('eval-raw.json', DIR);
const PRICE: Record<string, [number, number]> = { // $ per million tokens, in / out
  'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
};
type TruthIng = [string, number | null, string, string];
interface Truth {
  kind: string; title: string | null; servings?: number | null; ingredients: TruthIng[]; steps: string[];
  expectFlag?: number; blurry?: boolean;
  /** From truth.local.json: report scores only. */
  private?: boolean;
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
const readJson = async <T>(url: URL, fallback: T): Promise<T> => { try { return JSON.parse(await Deno.readTextFile(url)) as T; } catch { return fallback; } };

/** What the review screen flagged, by kind: "2 amounts, 1 repeat". No recipe text. */
function flagSummary(flags: DraftFlag[]): string {
  const kinds = new Map<string, number>();
  const add = (k: string) => kinds.set(k, (kinds.get(k) ?? 0) + 1);
  for (const f of flags) {
    if (f.add) add('in the steps only');
    else if (/appears twice/.test(f.reason)) add('repeated line');
    else if (f.part === 'quantity') add('amount');
    else if (f.field === 'ingredients') add('ingredient line');
    else if (f.field === 'steps') add('step');
    else add(f.field);
  }
  return [...kinds].map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
}

function score(t: Truth, d: ImportDraft | null, isRecipe: boolean) {
  if (!t.title) return { pass: !isRecipe, note: isRecipe ? 'invented a recipe from a food photo' : 'said there is no recipe' };
  if (t.blurry && (!isRecipe || !d)) return { pass: true, note: 'refused: no recipe read' };
  if (!d) return { pass: false, note: 'no recipe read' };
  const out = {
    title: covers(d.title, t.title) || covers(t.title, d.title), servings: (t.servings ?? null) === null || d.servings === t.servings,
    correct: 0, wrongAmount: [] as string[], wrongFlagged: 0, blankFlagged: [] as string[], missing: [] as string[], flaggedRight: 0, unflaggedFade: false, extra: 0, stepsFound: 0, steps: t.steps.length,
    expectations: [] as string[], offeredFromSteps: [] as string[],
  };
  const used = new Set<number>();
  t.ingredients.forEach(([raw, qty, unit, item]) => {
    const i = d.ingredients.findIndex((x, k) => !used.has(k) && covers(`${x.item} ${x.note}`, item));
    // Not in the list because the page names it only in the method: offered with "Add to the list".
    if (i < 0 && d.flags.some(f => f.add && covers(f.add, item))) { out.offeredFromSteps.push(item); return; }
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
  if (e.addFlag && !d.flags.some(f => f.add && covers(f.add, e.addFlag!))) out.expectations.push('ingredient only in the steps not flagged');
  if (e.notesInclude && !d.notes.toLowerCase().includes(e.notesInclude.toLowerCase())) out.expectations.push('headnote not in the notes');
  if (e.notesInclude && d.steps.some(s => s.toLowerCase().includes(e.notesInclude!.toLowerCase()))) out.expectations.push('headnote copied into the steps');
  const pass = out.title && out.wrongAmount.length === 0 && !out.unflaggedFade && out.missing.length === 0 && out.extra === 0 && out.stepsFound === out.steps && !out.expectations.length;
  return { pass, ...out };
}

/** The notes column: names for the synthetic set, counts only for private (real) photos. */
function notesFor(s: Record<string, unknown>, priv: boolean): string {
  const list = (k: string) => (Array.isArray(s[k]) ? (s[k] as string[]) : []);
  if (priv) {
    const wrong = list('wrongAmount');
    return [
      wrong.length ? `${wrong.length} wrong amount${wrong.length === 1 ? '' : 's'} (${s.wrongFlagged ?? 0} flagged)` : '',
      list('blankFlagged').length ? `${list('blankFlagged').length} left blank and flagged` : '',
      list('offeredFromSteps').length ? `${list('offeredFromSteps').length} only in the method, offered with Add to the list` : '',
      list('missing').length ? `${list('missing').length} missing` : '',
      s.extra ? `${s.extra} extra lines` : '',
      ...list('expectations'),
      typeof s.recipesListed === 'number' && s.recipesListed > 1 ? `${s.recipesListed} recipes listed, the expected one picked` : '',
      s.title === false ? 'title wrong' : '', s.note ? String(s.note) : '',
    ].filter(Boolean).join('. ') || 'all correct';
  }
  return [
    ...(list('wrongAmount').length ? [`wrong: ${list('wrongAmount').join('; ')}`] : []),
    ...(list('missing').length ? [`missing: ${list('missing').join(', ')}`] : []),
    ...(s.extra ? [`${s.extra} extra lines`] : []), ...(s.unflaggedFade ? ['faded amount left blank without a flag'] : []),
    ...(list('blankFlagged').length ? [`left blank and flagged: ${list('blankFlagged').join(', ')}`] : []),
    ...(list('offeredFromSteps').length ? [`only in the method, offered with Add to the list: ${list('offeredFromSteps').join(', ')}`] : []),
    ...(list('expectations').length ? [`review screen: ${list('expectations').join(', ')}`] : []),
    ...(s.chose ? [String(s.chose)] : []),
    ...(s.title === false ? ['title wrong'] : []), ...(s.note ? [String(s.note)] : []),
  ].join('. ') || 'all correct';
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const RESCORE = Deno.args.includes('--rescore');
const truth: Record<string, Truth> = {
  ...await readJson<Record<string, Truth>>(new URL('truth.json', DIR), {}),
  ...Object.fromEntries(Object.entries(await readJson<Record<string, Truth>>(new URL('truth.local.json', DIR), {})).map(([k, t]) => [k, { ...t, private: true }])),
};
const saved = RESCORE ? await readJson<Record<string, Record<string, Partial<ModelRecipe> & { chose?: string }>>>(RAW, {}) : {};
const savedAt = RESCORE ? (await Deno.stat(RAW).catch(() => null))?.mtime?.toISOString().replace('T', ' ').slice(0, 16) : null;
const models = Deno.args.filter(a => !a.startsWith('--')).length ? Deno.args.filter(a => !a.startsWith('--')) : (RESCORE ? Object.keys(saved) : ['claude-haiku-5-5']);
const rows: string[] = [];
const raw: Record<string, Record<string, unknown>> = {};
const summary: Record<string, { pass: number; total: number; wrong: number; wrongFlagged: number; cost: number; ms: number }> = {};
const EMPTY: Omit<ModelRecipe, 'is_recipe'> = { title: '', title_unsure: false, servings: '', servings_unsure: false, prep_time: '', cook_time: '', total_time: '', ingredients: [], steps: [], notes: '', recipes_seen: [], only_in_steps: [] };

for (const model of models) {
  summary[model] = { pass: 0, total: 0, wrong: 0, wrongFlagged: 0, cost: 0, ms: 0 };
  raw[model] = {};
  for (const [key, t] of Object.entries(truth)) {
    // Several photos of one recipe are joined with "+"; a file name can contain "+" too.
    const files = await exists(key) ? [key] : key.split('+');
    if (!RESCORE && !(await Promise.all(files.map(exists))).every(Boolean)) { console.log(`skipped ${key}: photo not in test-imports/`); continue; }
    if (RESCORE && !saved[model]?.[key]) { console.log(`skipped ${key}: no saved answer`); continue; }
    const started = Date.now();
    let result;
    try {
      const [pin, pout] = PRICE[model] ?? [0, 0];
      const costOf = (u?: { input: number; output: number }) => (u ? (u.input * pin + u.output * pout) / 1e6 : 0);
      let recipe: ModelRecipe;
      let cost = 0;
      let chose = '';
      let listed = 0;
      if (RESCORE) {
        const s = saved[model][key];
        recipe = { ...EMPTY, is_recipe: false, ...s } as ModelRecipe;
        chose = s.chose ?? '';
        listed = (s.recipes_seen ?? []).length;
      } else {
        const photos: Photo[] = [];
        for (const file of files) photos.push({ base64: toBase64(await Deno.readFile(new URL(file, DIR))), mediaType: mediaTypeOf(file) });
        let read = await readPhotos(photos, model);
        cost = costOf(read.usage);
        // Several recipes in the photos: the app asks which one, then reads that one again.
        // The eval picks the one the truth expects, like a person would.
        const seen = (read.recipe.recipes_seen ?? []).filter(r => r?.title?.trim());
        listed = seen.length;
        if (seen.length > 1) {
          const want = t.expect?.pick ?? t.title ?? '';
          const pick = seen.find(r => covers(r.title, want) || covers(want, r.title))?.title ?? seen[0].title;
          chose = `listed ${seen.map(r => `"${r.title}"`).join(', ')}; picked "${pick}"`;
          read = await readPhotos(photos, model, pick);
          cost += costOf(read.usage);
        }
        recipe = { ...read.recipe, recipes_seen: seen };
      }
      raw[model][key] = { chose, ...recipe };
      const d = draftFromModel(recipe, { kind: 'photo', url: null, site_name: null }, { photo: true });
      const s: Record<string, unknown> = { ...score(t, recipe.is_recipe ? d : null, recipe.is_recipe), recipesListed: listed };
      if (chose) s.chose = chose;
      if (t.expect?.pick && listed < 2) { s.pass = false; s.expectations = [...((s.expectations as string[]) ?? []), 'no choice between recipes offered']; }
      result = { s, cost, flags: flagSummary(d.flags), legibility: recipe.legibility ?? '-' };
    } catch (err) {
      result = { s: { pass: false, note: `error: ${err instanceof Error ? err.message : err}` }, cost: 0, flags: '-', legibility: '-' };
    }
    const ms = Date.now() - started;
    const sum = summary[model];
    sum.total++; sum.cost += result.cost; sum.ms += ms;
    if (result.s.pass) sum.pass++;
    const s = result.s as Record<string, unknown>;
    if (Array.isArray(s.wrongAmount)) sum.wrong += (s.wrongAmount as string[]).length;
    if (typeof s.wrongFlagged === 'number') sum.wrongFlagged += s.wrongFlagged;
    const name = t.private ? `${key} (real photo; scores only)` : key;
    rows.push(`| ${model} | ${name} | ${result.s.pass ? 'pass' : 'FAIL'} | ${'correct' in s ? `${s.correct}/${t.ingredients.length}` : '-'} | ${'stepsFound' in s ? `${s.stepsFound}/${s.steps}` : '-'} | ${result.legibility} | ${result.flags} | ${notesFor(s, !!t.private)} | ${RESCORE ? '-' : `${(ms / 1000).toFixed(1)}s`} | ${RESCORE ? '-' : `$${result.cost.toFixed(4)}`} |`);
    console.log(rows.at(-1));
  }
}

const table = Object.entries(summary)
  .map(([m, s]) => `| ${m} | ${s.pass}/${s.total} | ${s.wrong - s.wrongFlagged} | ${s.wrongFlagged} | ${RESCORE ? '-' : `$${(s.cost / s.total).toFixed(4)}`} | ${RESCORE ? '-' : `${(s.ms / s.total / 1000).toFixed(1)}s`} |`).join('\n');
const when = RESCORE
  ? `Model answers saved ${savedAt} (UTC), scored ${new Date().toISOString().slice(0, 10)} with the current parsing, review checks and scoring (no model calls; times and costs are in the run's own report).`
  : `Run ${new Date().toISOString().slice(0, 10)}, same prompt and parsing as import-recipe.`;
const report = `# Photo import: measured accuracy

${when} ${rows.length} cases from test-imports/. Real photos are listed with scores and flag counts only.

| Model | Cases passed | Wrong amounts, not flagged | Wrong amounts, flagged | Cost per import | Time per import |
|---|---|---|---|---|---|
${table}

"Flagged" is what the review screen highlights for the household to check. An amount left blank and flagged counts as honest, not wrong. Legibility is the model's own rating of the photo (from runs after 2026-11-18 11:43 CST; "-" before).

| Model | Case | Result | Ingredients right | Steps found | Legibility | Flagged on review | Notes | Time | Cost |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
if (!RESCORE) await Deno.writeTextFile(RAW, JSON.stringify(raw, null, 1));
await Deno.mkdir(new URL('../docs/imports/', import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL('../docs/imports/photo-eval.md', import.meta.url), report);
console.log(`\n${table}`);
