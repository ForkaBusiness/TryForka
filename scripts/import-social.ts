// What the social importer reads from real public posts: caption and credit (oEmbed or
// page metadata, never the video), whether the caption holds a recipe, and the links it
// would follow. No model here; prints one line per post for the accuracy report.
//   node --experimental-strip-types --no-warnings scripts/import-social.ts [url ...]
import { lookup } from 'node:dns/promises';
import { safeFetch } from '../supabase/functions/_shared/imports/safeFetch.ts';
import { importLink, postText } from '../supabase/functions/_shared/imports/pipeline.ts';
import { captionLooksLikeRecipe, creditLine, detectPlatform, recipeLinks } from '../supabase/functions/_shared/imports/social.ts';

const POSTS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://www.tiktok.com/@dadthedish/video/7356680872847838497',
  'https://www.tiktok.com/@yashajj/video/7430634507935468843',
  'https://www.tiktok.com/@hi.itshollyb/video/7449895843156528414',
  'https://www.tiktok.com/@feelgoodfoodie/video/7325261859462876459',
  'https://www.youtube.com/watch?v=6iFTwmZGKIw',
  'https://www.pinterest.com/pin/25-easy-chicken-recipes-for-quick-healthy-dinners--643944446743403202/',
  'https://www.instagram.com/p/C1x2y3z4a5b/',
];
const resolve = async (h: string) => (await lookup(h, { all: true })).map(a => a.address);
const deps = { fetchPage: (url: string) => safeFetch(url, { resolve, fetch }) };

for (const url of POSTS) {
  const platform = detectPlatform(url);
  if (!platform) { console.log(JSON.stringify({ url, error: 'not a social link' })); continue; }
  const { post } = await postText(platform, url, deps);
  const caption = [post.title !== post.caption ? post.title : '', post.caption].filter(Boolean).join('\n\n');
  // Without a model, a recipe link in the caption is still followed through the website importer.
  const result = await importLink(url, deps);
  console.log(JSON.stringify({
    url, platform, credit: creditLine(platform, post.handle), caption_chars: caption.length, caption_start: caption.slice(0, 90),
    looks_like_recipe: captionLooksLikeRecipe(caption), links: recipeLinks(caption), thumbnail: !!post.thumbnail,
    result: result.status, method: 'method' in result ? result.method : undefined, title: 'draft' in result ? result.draft.title : undefined,
  }));
}
