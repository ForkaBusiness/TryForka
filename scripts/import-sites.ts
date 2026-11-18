// Runs the website importer (JSON-LD path, no model) against real recipe pages and prints
// what came out of each, for the per-site accuracy report.
//   node --experimental-strip-types --no-warnings scripts/import-sites.ts [url ...]
// The same fetch rules as the edge function (safeFetch), with Node's DNS.
import { lookup } from 'node:dns/promises';
import { safeFetch } from '../supabase/functions/_shared/imports/safeFetch.ts';
import { importLink } from '../supabase/functions/_shared/imports/pipeline.ts';

export const SITES: Array<[string, string]> = [
  ['Allrecipes', 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/'],
  ['NYT Cooking', 'https://cooking.nytimes.com/recipes/1015819-chocolate-chip-cookies'],
  ['Serious Eats', 'https://www.seriouseats.com/the-food-lab-best-chocolate-chip-cookie-recipe'],
  ['BBC Good Food', 'https://www.bbcgoodfood.com/recipes/best-spaghetti-bolognese-recipe'],
  ['Bon Appetit', 'https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies'],
  ['Food Network', 'https://www.foodnetwork.com/recipes/alton-brown/the-chewy-recipe-1909046'],
  ['Budget Bytes', 'https://www.budgetbytes.com/one-pot-chili-pasta/'],
  ['Simply Recipes', 'https://www.simplyrecipes.com/recipes/perfect_guacamole/'],
  ['Delish', 'https://www.delish.com/cooking/recipe-ideas/a19636089/best-chicken-parmesan-recipe/'],
  ['Tasty', 'https://tasty.co/recipe/the-best-chewy-chocolate-chip-cookies'],
  ['RecipeTin Eats (blog)', 'https://www.recipetineats.com/chicken-chasseur/'],
  ['Cookie and Kate (blog)', 'https://cookieandkate.com/best-lentil-soup-recipe/'],
  ['Minimalist Baker (blog)', 'https://minimalistbaker.com/easy-vegan-lasagna/'],
  ['Just One Cookbook (blog)', 'https://www.justonecookbook.com/teriyaki-chicken/'],
  ['King Arthur Baking', 'https://www.kingarthurbaking.com/recipes/classic-sandwich-bread-recipe'],
  ["Sally's Baking Addiction (blog)", 'https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/'],
  ['Love and Lemons (blog)', 'https://www.loveandlemons.com/guacamole-recipe/'],
  ['Smitten Kitchen (blog)', 'https://smittenkitchen.com/2026/09/simple-chicken-tacos/'],
];

const resolve = async (h: string) => (await lookup(h, { all: true })).map(a => a.address);
const deps = { fetchPage: (url: string) => safeFetch(url, { resolve, fetch }) };

const list = process.argv.slice(2).length ? process.argv.slice(2).map(u => ['', u] as [string, string]) : SITES;
for (const [name, url] of list) {
  const started = Date.now();
  const r = await importLink(url, deps);
  const ms = Date.now() - started;
  if (r.status === 'ok' || r.status === 'partial') {
    const d = r.draft;
    const noAmount = d.ingredients.filter(i => i.quantity === null).length;
    console.log(JSON.stringify({ name, status: r.status, method: r.method, ms, title: d.title, servings: d.servings, prep: d.prep_minutes, cook: d.cook_minutes, total: d.total_minutes,
      ingredients: d.ingredients.length, without_amount: noAmount, steps: d.steps.length, image: !!d.image_url, site_name: d.source.site_name, url: d.source.url,
      sample: d.ingredients.slice(0, 3).map(i => [i.quantity, i.unit, i.item, i.note]), first_step: d.steps[0]?.slice(0, 80), flags: d.flags.length }));
  } else {
    console.log(JSON.stringify({ name, status: r.status, code: 'code' in r ? r.code : undefined, ms, message: r.message }));
  }
}
