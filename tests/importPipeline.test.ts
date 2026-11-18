// The import pipeline with a fake network and a fake model: websites (JSON-LD first, the
// model only as a fallback), social posts (caption, caption link, nothing), pasted text,
// and the failures the household sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importLink, importText, type ImportDeps } from '../supabase/functions/_shared/imports/pipeline.ts';
import { safeFetch } from '../supabase/functions/_shared/imports/safeFetch.ts';
import type { ModelRecipe } from '../supabase/functions/_shared/imports/modelDraft.ts';

const RECIPE_PAGE = `<html><head><title>Lentil soup</title><meta property="og:site_name" content="Soup Blog">
<meta property="og:image" content="/img/soup.jpg"><link rel="canonical" href="https://soupblog.example/lentil-soup/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":"Recipe","name":"Lentil soup","recipeYield":["4","4 bowls"],"prepTime":"PT10M","cookTime":"PT35M",
"recipeIngredient":["1 cup red lentils","1 onion, diced","4 cups vegetable stock","Salt, to taste"],
"recipeInstructions":[{"@type":"HowToSection","name":"Soup","itemListElement":[{"@type":"HowToStep","text":"Soften the onion."},{"@type":"HowToStep","text":"Add lentils and stock; simmer 30 minutes."}]}]}]}</script>
</head><body></body></html>`;

const PLAIN_PAGE = `<html><head><title>Grandma's pancakes</title></head><body><article><h1>Grandma's pancakes</h1>
<p>These are the pancakes we made every Sunday when I was growing up, and the kids still ask for them.</p>
<h2>Ingredients</h2><ul><li>2 cups flour</li><li>2 eggs</li><li>1 1/2 cups milk</li><li>2 tbsp sugar</li></ul>
<h2>Method</h2><ol><li>Whisk everything together.</li><li>Cook in a hot pan until golden on both sides.</li></ol></article></body></html>`;

const NOTHING_PAGE = '<html><head><title>About us</title></head><body><p>We are a small team who love food and travel. Read our story, follow our newsletter, and say hello any time you like. We post new things every week and love hearing from readers about what they cooked.</p></body></html>';

function deps(pages: Record<string, { body: string; type?: string; status?: number }>, model?: (text: string) => ModelRecipe): ImportDeps & { modelCalls: string[] } {
  const modelCalls: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404 });
    if (page.status && page.status >= 300 && page.status < 400) return new Response(null, { status: page.status, headers: { location: page.body } });
    return new Response(page.body, { status: page.status ?? 200, headers: { 'content-type': page.type ?? 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  const resolve = async (host: string) => (host.startsWith('internal') ? ['10.0.0.8'] : ['93.184.216.34']);
  return {
    modelCalls,
    fetchPage: url => safeFetch(url, { resolve, fetch: fakeFetch }),
    readText: model ? async text => { modelCalls.push(text); return { recipe: model(text), model: 'fake-model' }; } : undefined,
  };
}

const modelRecipe = (over: Partial<ModelRecipe> = {}): ModelRecipe => ({
  is_recipe: true, title: "Grandma's pancakes", title_unsure: false, servings: '', servings_unsure: false, prep_time: '', cook_time: '', total_time: '',
  ingredients: [{ text: '2 cups flour', unsure: 'none' }, { text: '2 eggs', unsure: 'none' }, { text: '1 1/2 cups milk', unsure: 'none' }, { text: '3 tbsp sugar', unsure: 'none' }],
  steps: [{ text: 'Whisk everything together.', unsure: 'none' }, { text: 'Cook in a hot pan until golden on both sides.', unsure: 'none' }],
  notes: '', ...over,
});

test('website: JSON-LD in @graph with sections becomes a draft, without the model', async () => {
  const d = deps({ 'https://soupblog.example/lentil-soup': { body: RECIPE_PAGE } }, () => { throw new Error('model must not be asked'); });
  const r = await importLink('https://soupblog.example/lentil-soup', d);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.method, 'json_ld');
  assert.equal(r.draft.title, 'Lentil soup');
  assert.equal(r.draft.servings, 4);
  assert.equal(r.draft.prep_minutes, 10);
  assert.equal(r.draft.cook_minutes, 35);
  assert.deepEqual(r.draft.ingredients.map(i => [i.quantity, i.unit, i.item, i.note]), [[1, 'cup', 'red lentils', ''], [1, '', 'onion', 'diced'], [4, 'cup', 'vegetable stock', ''], [null, '', 'Salt', 'to taste']]);
  assert.equal(r.draft.steps.length, 2);
  assert.equal(r.draft.source.site_name, 'Soup Blog');
  assert.equal(r.draft.source.url, 'https://soupblog.example/lentil-soup');
  assert.equal(r.draft.image_url, 'https://soupblog.example/img/soup.jpg');
  assert.equal(d.modelCalls.length, 0);
});

test('website: no structured data falls back to the model, which cannot add amounts the page lacks', async () => {
  const d = deps({ 'https://family.example/pancakes': { body: PLAIN_PAGE } }, () => modelRecipe());
  const r = await importLink('https://family.example/pancakes', d);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.method, 'model');
  assert.equal(d.modelCalls.length, 1);
  assert.match(d.modelCalls[0], /2 cups flour/);
  // The page says 2 tbsp sugar; the model said 3. The 3 is dropped and flagged, not kept.
  const sugar = r.draft.ingredients[3];
  assert.equal(sugar.quantity, null);
  assert.deepEqual(r.draft.flags.map(f => [f.field, f.index, f.part]), [['ingredients', 3, 'quantity']]);
  assert.equal(r.draft.ingredients[2].quantity, 1.5);
});

test('website: a page with no recipe says so; a refused page and a bad host are calm failures', async () => {
  const d = deps({ 'https://site.example/about': { body: NOTHING_PAGE }, 'https://closed.example/r': { body: 'no', status: 403 } }, () => modelRecipe({ is_recipe: false, ingredients: [], steps: [] }));
  const none = await importLink('https://site.example/about', d);
  assert.equal(none.status, 'no_recipe');
  const refused = await importLink('https://closed.example/r', d);
  assert.equal(refused.status, 'failed');
  if (refused.status === 'failed') assert.match(refused.message, /didn't let Forka read the page/);
  const missing = await importLink('https://site.example/gone', d);
  assert.equal(missing.status, 'failed');
  if (missing.status === 'failed') assert.match(missing.message, /couldn't be found/);
});

test('website: a redirect to a private address is never fetched', async () => {
  const d = deps({ 'https://short.example/r': { body: 'http://169.254.169.254/latest/meta-data/', status: 302 }, 'https://short.example/s': { body: 'https://internal.corp.example/recipe', status: 301 } });
  for (const url of ['https://short.example/r', 'https://short.example/s', 'http://127.0.0.1/admin', 'https://internal.example/r']) {
    const r = await importLink(url, d);
    assert.equal(r.status, 'failed', url);
    if (r.status === 'failed') assert.match(r.message, /can't be opened from Forka/, url);
  }
});

const TIKTOK = 'https://www.tiktok.com/@cookwithmaya/video/7301234567890123456';
const oembed = (title: string) => JSON.stringify({ title, author_unique_id: 'cookwithmaya', author_url: 'https://www.tiktok.com/@cookwithmaya', thumbnail_url: 'https://p16.example/thumb.jpg' });
const tiktokOembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(TIKTOK)}`;

test('social: a caption with a recipe is read from the caption and credits the creator', async () => {
  const caption = 'Easy garlic noodles in 15 min! Ingredients: 8 oz noodles, 4 tbsp butter, 6 cloves garlic, 2 tbsp soy sauce, 1 tbsp brown sugar. Cook noodles. Melt butter, add garlic, stir in soy sauce and sugar, toss with noodles. #noodles #easydinner';
  const d = deps({ [tiktokOembed]: { body: oembed(caption), type: 'application/json' } }, () => modelRecipe({
    title: 'Easy garlic noodles',
    ingredients: [{ text: '8 oz noodles', unsure: 'none' }, { text: '4 tbsp butter', unsure: 'none' }, { text: '6 cloves garlic', unsure: 'none' }, { text: '2 tbsp soy sauce', unsure: 'none' }, { text: '1 tbsp brown sugar', unsure: 'none' }],
    steps: [{ text: 'Cook noodles.', unsure: 'none' }, { text: 'Melt butter, add garlic, stir in soy sauce and sugar, toss with noodles.', unsure: 'none' }],
  }));
  const r = await importLink(TIKTOK, d);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.method, 'caption');
  assert.deepEqual([r.draft.source.kind, r.draft.source.platform, r.draft.source.handle], ['social', 'tiktok', 'cookwithmaya']);
  assert.equal(r.draft.source.url, 'https://tiktok.com/@cookwithmaya/video/7301234567890123456');
  assert.equal(r.draft.image_url, 'https://p16.example/thumb.jpg');
  assert.ok(r.draft.flags.length === 0);
});

test('social: a caption that links to a recipe page follows it through the website importer', async () => {
  const d = deps({
    [tiktokOembed]: { body: oembed('The soup that got me through winter. Full recipe: https://soupblog.example/lentil-soup/ #soup'), type: 'application/json' },
    'https://soupblog.example/lentil-soup/': { body: RECIPE_PAGE },
  }, () => { throw new Error('a link with JSON-LD needs no model'); });
  const r = await importLink(TIKTOK, d);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.method, 'caption_link');
  assert.equal(r.draft.title, 'Lentil soup');
  assert.equal(r.draft.source.handle, 'cookwithmaya', 'the creator keeps the credit');
  assert.match(r.draft.notes, /Full recipe on Soup Blog: https:\/\/soupblog\.example\/lentil-soup/);
});

test('social: a caption with no recipe and no link says so and offers the other ways in', async () => {
  const d = deps({ [tiktokOembed]: { body: oembed('Sunday dinner with the family 🍝 #pasta #sundayvibes'), type: 'application/json' } }, () => { throw new Error('no model for a caption without a recipe'); });
  const r = await importLink(TIKTOK, d);
  assert.equal(r.status, 'no_recipe');
  if (r.status !== 'no_recipe') return;
  assert.match(r.message, /Paste the recipe text/);
  assert.match(r.message, /screenshots/);
  assert.equal(r.source?.handle, 'cookwithmaya');
  assert.equal(r.source?.platform, 'tiktok');
});

test('pasted text: read by the model, numbers checked against the text, credit kept', async () => {
  const text = 'Pancakes\n2 cups flour\n2 eggs\n1 1/2 cups milk\n2 tbsp sugar\nWhisk everything together. Cook in a hot pan until golden on both sides.';
  const d = deps({}, () => modelRecipe());
  const source = { kind: 'social' as const, url: TIKTOK, site_name: 'TikTok', platform: 'tiktok' as const, handle: 'cookwithmaya' };
  const r = await importText(text, d, source);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.draft.source.handle, 'cookwithmaya');
  assert.equal(r.draft.ingredients[3].quantity, null, 'the model said 3 tbsp; the text says 2');
  const none = await importText('just some words about dinner tonight, nothing else here', deps({}, () => modelRecipe({ is_recipe: false, ingredients: [], steps: [] })));
  assert.equal(none.status, 'no_recipe');
});

test('site suffixes come off titles', async () => {
  const { cleanTitle } = await import('../supabase/functions/_shared/imports/pipeline.ts');
  assert.equal(cleanTitle('The Best Chewy Chocolate Chip Cookies Recipe by Tasty'), 'The Best Chewy Chocolate Chip Cookies');
  assert.equal(cleanTitle('Perfect Guacamole Recipe'), 'Perfect Guacamole');
  assert.equal(cleanTitle('Lentil soup'), 'Lentil soup');
  assert.equal(cleanTitle('Recipe'), 'Recipe');
});

test('review checks: a repeated line is flagged, not merged', async () => {
  const { draftFromModel } = await import('../supabase/functions/_shared/imports/modelDraft.ts');
  const d = draftFromModel(modelRecipe({
    ingredients: ['100 ml milk', '3 eggs', '1 tbs cocoa', '3 eggs'].map(text => ({ text, unsure: 'none' as const })),
  }), { kind: 'photo', url: null, site_name: null }, { photo: true });
  assert.equal(d.ingredients.length, 4, 'both lines kept');
  assert.deepEqual(d.flags.map(f => [f.index, f.reason]), [[3, "This line appears twice (also line 2). Remove one if it's a repeat."]]);
});

test('review checks: an ingredient only in the steps is offered, if the steps really say it', async () => {
  const { draftFromModel } = await import('../supabase/functions/_shared/imports/modelDraft.ts');
  const d = draftFromModel(modelRecipe({
    title: 'DORSET APPLE CAKE',
    ingredients: ['8oz self raising flour', 'Pinch of salt', '4oz butter'].map(text => ({ text, unsure: 'none' as const })),
    steps: ['Rub butter into flour.', 'Eat hot sprinkled with demerara sugar.'].map(text => ({ text, unsure: 'none' as const })),
    // The model also names one the steps don't say, and one already on the list: both ignored.
    only_in_steps: ['demerara sugar', 'vanilla', 'butter'],
  }), { kind: 'photo', url: null, site_name: null }, { photo: true });
  assert.deepEqual(d.flags.map(f => [f.reason, f.add]), [['Demerara sugar is in the steps but not the ingredient list.', 'demerara sugar']]);
  assert.equal(d.title, 'Dorset apple cake');
});

test('review checks: a photo the model found hard has every amount flagged', async () => {
  const { draftFromModel } = await import('../supabase/functions/_shared/imports/modelDraft.ts');
  const hard = draftFromModel(modelRecipe({
    ingredients: [{ text: 'flour', unsure: 'amount_unreadable' }, { text: '2 tablespoons sugar', unsure: 'text_unreadable' }, { text: '1 teaspoon salt', unsure: 'none' }, { text: '1 cup milk', unsure: 'none' }],
    steps: [{ text: 'Whisk the flour.', unsure: 'text_unreadable' }, { text: 'Cook.', unsure: 'none' }],
  }), { kind: 'photo', url: null, site_name: null }, { photo: true });
  // 3 of 6 lines unsure: salt and milk, which looked clear, are flagged too.
  assert.deepEqual(hard.flags.filter(f => f.field === 'ingredients').map(f => f.index).sort(), [0, 1, 2, 3]);
  assert.match(hard.flags.find(f => f.index === 3)!.reason, /hard to read\. Check this amount/);
  const clear = draftFromModel(modelRecipe({
    ingredients: [{ text: '1 T parsley', unsure: 'amount_unreadable' }, ...['1 egg', '1 lb beef', '1/2 c crumbs', '2 garlic cloves'].map(text => ({ text, unsure: 'none' as const }))],
  }), { kind: 'photo', url: null, site_name: null }, { photo: true });
  assert.equal(clear.flags.length, 1, 'one unsure line on a clear photo flags only that line');
});
