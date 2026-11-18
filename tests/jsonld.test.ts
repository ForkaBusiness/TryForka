// Website import: schema.org Recipe JSON-LD parsing (run with `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationMinutes, pageText, parseRecipePage, yieldServings } from '../supabase/functions/_shared/imports/jsonld.ts';

const URL_ = 'https://www.example-recipes.com/recipes/lemon-chicken/';
const page = (head: string, body = '<h1>Recipe</h1>') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (obj: unknown, attrs = 'type="application/ld+json"') => `<script ${attrs}>${typeof obj === 'string' ? obj : JSON.stringify(obj)}</script>`;

test('jsonld: a plain Recipe object (Allrecipes style)', () => {
  const html = page(ld({
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Lemon Chicken',
    recipeYield: ['4', '4 servings'], prepTime: 'PT15M', cookTime: 'PT30M', totalTime: 'PT45M',
    recipeIngredient: ['2 pounds chicken thighs', '1 lemon, juiced', '2 tablespoons olive oil'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Heat the oven to 400°F.' }, { '@type': 'HowToStep', text: 'Roast the chicken for 30 minutes.' }],
    image: { '@type': 'ImageObject', url: 'https://cdn.example.com/lemon.jpg', width: 1200 },
    author: [{ '@type': 'Person', name: 'Jane Cook' }],
  }) + '<meta property="og:site_name" content="Example Recipes">');
  const { recipe, usable } = parseRecipePage(html, URL_);
  assert.equal(usable, true);
  assert.ok(recipe);
  assert.equal(recipe.title, 'Lemon Chicken');
  assert.equal(recipe.servings, 4);
  assert.deepEqual([recipe.prep_minutes, recipe.cook_minutes, recipe.total_minutes], [15, 30, 45]);
  assert.deepEqual(recipe.ingredientLines, ['2 pounds chicken thighs', '1 lemon, juiced', '2 tablespoons olive oil']);
  assert.deepEqual(recipe.steps, ['Heat the oven to 400°F.', 'Roast the chicken for 30 minutes.']);
  assert.equal(recipe.image_url, 'https://cdn.example.com/lemon.jpg');
  assert.equal(recipe.site_name, 'Example Recipes');
  assert.equal(recipe.author, 'Jane Cook');
  assert.equal(recipe.notes, '');
});

test('jsonld: Recipe inside @graph with WebPage and Organization (WordPress / WPRM)', () => {
  const html = page(ld({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Budget Kitchen', '@id': '#org' },
      { '@type': 'WebPage', '@id': URL_, name: 'Lemon pasta' },
      { '@type': 'Article', headline: 'Lemon pasta', mainEntityOfPage: { '@id': URL_ } },
      {
        '@type': 'Recipe', name: 'Lemon Pasta', recipeYield: ['6', '6 servings'], cookTime: 'P0DT0H20M',
        recipeIngredient: ['12 oz spaghetti', '2 lemons', '1/2 cup parmesan'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Boil the pasta.', name: 'Boil the pasta.' }, { '@type': 'HowToStep', text: 'Toss with lemon and cheese.' }],
        publisher: { '@id': '#org' },
      },
    ],
  }));
  const { recipe, usable } = parseRecipePage(html, URL_);
  assert.equal(usable, true);
  assert.equal(recipe?.title, 'Lemon Pasta');
  assert.equal(recipe?.servings, 6);
  assert.equal(recipe?.cook_minutes, 20);
  assert.deepEqual(recipe?.steps, ['Boil the pasta.', 'Toss with lemon and cheese.']);
  // No og:site_name and publisher only by reference: the host name.
  assert.equal(recipe?.site_name, 'example-recipes.com');
});

test('jsonld: @type arrays and schema.org URL types count as Recipe', () => {
  const r1 = parseRecipePage(page(ld({ '@type': ['Recipe', 'NewsArticle'], name: 'Soup', recipeIngredient: ['1 onion', '1 carrot'], recipeInstructions: 'Chop.\nSimmer.' })), URL_);
  assert.equal(r1.recipe?.title, 'Soup');
  assert.deepEqual(r1.recipe?.steps, ['Chop.', 'Simmer.']);
  const r2 = parseRecipePage(page(ld({ '@type': 'http://schema.org/Recipe', name: 'Toast', recipeIngredient: ['bread', 'butter'], recipeInstructions: ['Toast the bread.'] })), URL_);
  assert.equal(r2.usable, true);
});

test('jsonld: HowToSection with two sections prefixes each section name once', () => {
  const html = page(ld({
    '@type': 'Recipe', name: 'Tacos', recipeIngredient: ['1 lb beef', '8 tortillas', '1 cup salsa'],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'For the filling', itemListElement: [
        { '@type': 'HowToStep', text: 'Brown the beef.' }, { '@type': 'HowToStep', text: 'Add the spices.' }] },
      { '@type': 'HowToSection', name: 'To serve', itemListElement: [
        { '@type': 'HowToStep', text: 'Warm the tortillas.' }, { '@type': 'HowToStep', text: 'To serve' }] },
    ],
  }));
  const { recipe } = parseRecipePage(html, URL_);
  assert.deepEqual(recipe?.steps, ['For the filling: Brown the beef.', 'Add the spices.', 'To serve: Warm the tortillas.']);
});

test('jsonld: a single section is not prefixed; nested ItemList steps are found', () => {
  const html = page(ld({
    '@type': 'Recipe', name: 'Rice', recipeIngredient: ['1 cup rice', '2 cups water'],
    recipeInstructions: [{ '@type': 'HowToSection', name: 'Method', itemListElement: [{ '@type': 'ListItem', item: { text: 'Rinse the rice.' } }, { '@type': 'HowToStep', itemListElement: [{ '@type': 'HowToDirection', text: 'Simmer 18 minutes.' }] }] }],
  }));
  assert.deepEqual(parseRecipePage(html, URL_).recipe?.steps, ['Rinse the rice.', 'Simmer 18 minutes.']);
});

test('jsonld: single-string instructions split by lines or by numbered markers', () => {
  const lines = parseRecipePage(page(ld({ '@type': 'Recipe', name: 'A', recipeIngredient: ['a', 'b'], recipeInstructions: '1. Mix the dry things.\n2. Add the eggs.\n\n3. Bake.' })), URL_);
  assert.deepEqual(lines.recipe?.steps, ['Mix the dry things.', 'Add the eggs.', 'Bake.']);
  const para = parseRecipePage(page(ld({ '@type': 'Recipe', name: 'B', recipeIngredient: ['a', 'b'], recipeInstructions: '1. Mix the dry things. 2. Add the eggs. 3. Bake for 20 minutes.' })), URL_);
  assert.deepEqual(para.recipe?.steps, ['Mix the dry things.', 'Add the eggs.', 'Bake for 20 minutes.']);
  const html = parseRecipePage(page(ld({ '@type': 'Recipe', name: 'C', recipeIngredient: ['a', 'b'], recipeInstructions: '<p>Whisk.</p><p>Fold in the <b>flour</b>.</p>' })), URL_);
  assert.deepEqual(html.recipe?.steps, ['Whisk.', 'Fold in the flour.']);
});

test('jsonld: recipeYield forms', () => {
  assert.equal(yieldServings(4), 4);
  assert.equal(yieldServings('4 servings'), 4);
  assert.equal(yieldServings('Serves 4-6'), 4);
  assert.equal(yieldServings(['8', '8 servings']), 8);
  assert.equal(yieldServings('Makes 1 loaf'), 1);
  assert.equal(yieldServings('a crowd'), null);
  assert.equal(yieldServings('500'), null);
  assert.equal(yieldServings(undefined), null);
});

test('jsonld: ISO 8601 durations', () => {
  assert.equal(durationMinutes('PT1H30M'), 90);
  assert.equal(durationMinutes('P0DT0H20M'), 20);
  assert.equal(durationMinutes('PT90M'), 90);
  assert.equal(durationMinutes('PT45S'), 1);
  assert.equal(durationMinutes('P1D'), 1440);
  assert.equal(durationMinutes(25), 25);
  assert.equal(durationMinutes('25'), 25);
  assert.equal(durationMinutes('PT0M'), null);
  assert.equal(durationMinutes('about an hour'), null);
  assert.equal(durationMinutes(null), null);
});

test('jsonld: image as array, ImageObject list (widest wins) and relative URL', () => {
  const base = { '@type': 'Recipe', name: 'X', recipeIngredient: ['a', 'b'], recipeInstructions: ['Do it.'] };
  const arr = parseRecipePage(page(ld({ ...base, image: ['https://cdn.example.com/1x1.jpg', 'https://cdn.example.com/16x9.jpg'] })), URL_);
  assert.equal(arr.recipe?.image_url, 'https://cdn.example.com/1x1.jpg');
  const objs = parseRecipePage(page(ld({ ...base, image: [{ '@type': 'ImageObject', url: 'https://cdn.example.com/s.jpg', width: 300 }, { '@type': 'ImageObject', url: 'https://cdn.example.com/l.jpg', width: 1600 }] })), URL_);
  assert.equal(objs.recipe?.image_url, 'https://cdn.example.com/l.jpg');
  const rel = parseRecipePage(page(ld({ ...base, image: '/images/x.jpg' })), URL_);
  assert.equal(rel.recipe?.image_url, 'https://www.example-recipes.com/images/x.jpg');
  const og = parseRecipePage(page(ld(base) + '<meta property="og:image" content="https://cdn.example.com/og.jpg">'), URL_);
  assert.equal(og.recipe?.image_url, 'https://cdn.example.com/og.jpg');
});

test('jsonld: entities and HTML in names, ingredients and steps', () => {
  const html = page(ld({
    '@type': 'Recipe', name: 'Mac &amp; Cheese &#8211; Grandma&#39;s',
    recipeIngredient: ['&frac12; cup <strong>milk</strong>', '2&nbsp;cups cheddar', '&#x27;Nduja (optional)'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Stir &amp; serve.<br>Enjoy.' }],
  }));
  const { recipe } = parseRecipePage(html, URL_);
  assert.equal(recipe?.title, 'Mac & Cheese – Grandma\'s');
  assert.deepEqual(recipe?.ingredientLines, ['½ cup milk', '2 cups cheddar', "'Nduja (optional)"]);
  assert.deepEqual(recipe?.steps, ['Stir & serve.', 'Enjoy.']);
});

test('jsonld: a broken block is skipped and the next valid one is used; raw newlines are repaired', () => {
  const broken = '<script type="application/ld+json">{ "@type": "Recipe", "name": </script>';
  const rawNewline = `<script type="application/ld+json" class="yoast-schema-graph">{"@type":"Recipe","name":"Bread","recipeIngredient":["3 cups flour","1 tsp yeast"],"recipeInstructions":"Mix.
Knead."}</script>`;
  const { recipe, usable } = parseRecipePage(page(broken + rawNewline), URL_);
  assert.equal(usable, true);
  assert.equal(recipe?.title, 'Bread');
  assert.deepEqual(recipe?.steps, ['Mix.', 'Knead.']);
});

test('jsonld: type attribute matched loosely, CDATA and comments tolerated', () => {
  const html = page(`<script TYPE='application/ld+json' data-x="1">//<![CDATA[
{"@type":"Recipe","name":"Salad","recipeIngredient":["lettuce","oil"],"recipeInstructions":["Toss."]}
//]]></script>`);
  assert.equal(parseRecipePage(html, URL_).recipe?.title, 'Salad');
});

test('jsonld: the recipe with the most content wins when there are several', () => {
  const small = { '@type': 'Recipe', name: 'Related', recipeIngredient: ['a'], recipeInstructions: [] };
  const main = { '@type': 'Recipe', name: 'Main', recipeIngredient: ['a', 'b', 'c'], recipeInstructions: ['One.', 'Two.'] };
  assert.equal(parseRecipePage(page(ld([small, main])), URL_).recipe?.title, 'Main');
});

test('jsonld: found but incomplete is reported as such', () => {
  const r = parseRecipePage(page(ld({ '@type': 'Recipe', name: 'Teaser', recipeIngredient: ['1 cup flour'] })), URL_);
  assert.equal(r.usable, false);
  assert.equal(r.reason, 'incomplete');
  assert.equal(r.recipe?.title, 'Teaser');
});

test('jsonld: no JSON-LD -> no_recipe, with page metadata from og tags', () => {
  const html = page(`<title>My Blog | Weeknight dinners</title>
    <meta property="og:title" content="Weeknight dinners &amp; more">
    <meta property="og:description" content="Ten ideas.">
    <meta property="og:image" content="/img/hero.jpg">
    <meta property="og:site_name" content="My Blog">
    <meta property="og:type" content="article">
    <link rel="canonical" href="https://myblog.example/weeknight">
    <script type="application/ld+json">{"@type":"Organization","name":"My Blog"}</script>`);
  const r = parseRecipePage(html, 'https://myblog.example/weeknight?utm_source=x');
  assert.equal(r.recipe, null);
  assert.equal(r.usable, false);
  assert.equal(r.reason, 'no_recipe');
  assert.deepEqual(r.meta, {
    title: 'Weeknight dinners & more', description: 'Ten ideas.', image: 'https://myblog.example/img/hero.jpg',
    site_name: 'My Blog', canonical: 'https://myblog.example/weeknight', type: 'article',
  });
});

test('jsonld: Recipe under mainEntity is found', () => {
  const html = page(ld({ '@type': 'WebPage', mainEntity: { '@type': 'Recipe', name: 'Stew', recipeIngredient: ['beef', 'carrots'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Simmer.' }] } }));
  assert.equal(parseRecipePage(html, URL_).recipe?.title, 'Stew');
});

test('pageText: keeps the readable text, drops scripts, menus and footers', () => {
  const html = `<html><head><style>.x{color:red}</style><script>var a = "Ingredients";</script></head><body>
    <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
    <article><h1>Grandma&#39;s Pie</h1><p>Serves 6.</p>
    <h2>Ingredients</h2><ul><li>2 cups flour</li><li>1 cup butter</li></ul>
    <h2>Method</h2><ol><li>Rub the butter into the flour.</li><li>Bake 40 minutes.</li></ol></article>
    <aside>Popular posts</aside><form><input name="email"></form><footer>© 2026</footer></body></html>`;
  const text = pageText(html);
  assert.ok(text.includes("Grandma's Pie"));
  assert.ok(text.includes('2 cups flour\n'));
  assert.ok(text.includes('Bake 40 minutes.'));
  for (const gone of ['color:red', 'var a', 'Home', 'Popular posts', '© 2026', 'About']) assert.ok(!text.includes(gone), gone);
  assert.ok(!/\n\n\n/.test(text));
  assert.equal(pageText(html, 10).length, 10);
});

test('yields in dozens are counted out', async () => {
  const { yieldServings } = await import('../supabase/functions/_shared/imports/jsonld.ts');
  assert.equal(yieldServings('2 1/2 dozen cookies'), 30);
  assert.equal(yieldServings('1½ dozen'), 18);
  assert.equal(yieldServings('Makes 1 dozen'), 12);
  assert.equal(yieldServings('4 servings'), 4);
});
