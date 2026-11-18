// Social posts: platform detection, oEmbed and page metadata, recipe links and recipe
// captions, and the creator credit. Text and metadata only, never the video.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionLooksLikeRecipe, creditLine, detectPlatform, fromOembed, fromPageMeta, oembedUrl, pinterestOutboundLink, platformName, recipeLinks,
} from '../supabase/functions/_shared/imports/social.ts';

test('detects the platform of a post link', () => {
  const cases: Array<[string, string | null]> = [
    ['https://www.tiktok.com/@cook/video/7301234567890123456', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    ['https://vt.tiktok.com/ZSabc/', 'tiktok'],
    ['https://m.tiktok.com/v/7301234567890123456.html', 'tiktok'],
    ['https://www.instagram.com/p/C1a2b3c4d5e/', 'instagram'],
    ['https://www.instagram.com/reel/C1a2b3c4d5e/?igsh=abc', 'instagram'],
    ['https://instagram.com/reels/C1a2b3c4d5e/', 'instagram'],
    ['https://www.instagram.com/tv/C1a2b3c4d5e/', 'instagram'],
    ['https://www.instagram.com/someuser/', null],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtube.com/shorts/abc123XYZ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ?si=xyz', 'youtube'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', null],
    ['https://www.youtube.com/@somechannel', null],
    ['https://www.pinterest.com/pin/123456789012345678/', 'pinterest'],
    ['https://pin.it/abc123', 'pinterest'],
    ['https://www.pinterest.co.uk/pin/123/', 'pinterest'],
    ['https://www.facebook.com/watch/?v=123', 'facebook'],
    ['https://m.facebook.com/story.php?id=1', 'facebook'],
    ['https://fb.watch/abc/', 'facebook'],
    ['https://www.seriouseats.com/recipe', null],
    ['not a url', null],
  ];
  for (const [url, platform] of cases) assert.equal(detectPlatform(url), platform, url);
});

test('builds public oEmbed URLs, none for Instagram and Facebook', () => {
  const post = 'https://www.tiktok.com/@cook/video/1';
  assert.equal(oembedUrl('tiktok', post), `https://www.tiktok.com/oembed?url=${encodeURIComponent(post)}`);
  assert.equal(oembedUrl('youtube', 'https://youtu.be/x'), `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://youtu.be/x')}`);
  assert.equal(oembedUrl('pinterest', 'https://pin.it/x'), `https://www.pinterest.com/oembed.json?url=${encodeURIComponent('https://pin.it/x')}`);
  assert.equal(oembedUrl('instagram', 'https://www.instagram.com/p/x/'), null);
  assert.equal(oembedUrl('facebook', 'https://fb.watch/x/'), null);
});

test('reads TikTok and YouTube oEmbed answers', () => {
  const tiktok = fromOembed('tiktok', { title: 'Easy pasta! Ingredients: ...', author_name: 'Cook Name', author_url: 'https://www.tiktok.com/@cookname', author_unique_id: 'cookname', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg' });
  assert.equal(tiktok.caption, 'Easy pasta! Ingredients: ...');
  assert.equal(tiktok.handle, 'cookname');
  assert.equal(tiktok.thumbnail, 'https://p16.tiktokcdn.com/x.jpg');
  assert.equal(fromOembed('tiktok', { title: 'x', author_url: 'https://www.tiktok.com/@from.url' }).handle, 'from.url');
  const yt = fromOembed('youtube', { title: 'Best Chili', author_name: 'Chef Channel', author_url: 'https://www.youtube.com/@chefchannel', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
  assert.equal(yt.handle, 'chefchannel');
  assert.equal(yt.title, 'Best Chili');
  assert.equal(fromOembed('youtube', { title: 'x', author_name: 'Chef Channel', author_url: 'https://www.youtube.com/channel/UC123' }).handle, 'Chef Channel');
});

test('reads an Instagram caption and handle from og metadata', () => {
  const post = fromPageMeta('instagram', {
    title: 'Jane Cooks on Instagram: "Lemon pasta"',
    description: '1,234 likes, 56 comments - janecooks on May 1, 2025: "Lemon pasta &amp; peas\nIngredients:\n200g spaghetti". ',
    image: 'https://scontent.cdninstagram.com/x.jpg',
  });
  assert.equal(post.handle, 'janecooks');
  assert.equal(post.caption, 'Lemon pasta & peas\nIngredients:\n200g spaghetti');
  assert.equal(post.author_url, 'https://www.instagram.com/janecooks/');
  assert.equal(post.thumbnail, 'https://scontent.cdninstagram.com/x.jpg');
  const fromTitle = fromPageMeta('instagram', { title: 'Jane Cooks (@janecooks) on Instagram: "Short caption"', description: '' });
  assert.equal(fromTitle.caption, 'Short caption');
  assert.equal(fromTitle.handle, 'janecooks');
});

test('reads the full YouTube description and channel handle from the page', () => {
  const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Chili","shortDescription":"Ingredients:\\n2 lb beef\\n1 can beans\\n\\u0026 more\\n\\"Best\\" chili","author":"Chef"},"microformat":{"ownerProfileUrl":"http://www.youtube.com/@chefchannel"}};</script>';
  const post = fromPageMeta('youtube', { title: 'Chili', description: 'Ingredients: 2 lb beef...' }, html);
  assert.equal(post.caption, 'Ingredients:\n2 lb beef\n1 can beans\n& more\n"Best" chili');
  assert.equal(post.handle, 'chefchannel');
  const fallback = fromPageMeta('youtube', { title: 'Chili', description: 'Short' }, '<html>{"canonicalBaseUrl":"/@otherchef"}</html>');
  assert.equal(fallback.caption, 'Short');
  assert.equal(fallback.handle, 'otherchef');
});

test('finds the page a pin was saved from', () => {
  assert.equal(pinterestOutboundLink('<meta property="og:see_also" content="https://www.budgetbytes.com/chili/">'), 'https://www.budgetbytes.com/chili/');
  assert.equal(pinterestOutboundLink('<script>{"pin":{"link":"https:\\/\\/www.delish.com\\/recipe\\/"}}</script>'), 'https://www.delish.com/recipe/');
  assert.equal(pinterestOutboundLink('<a rel="nofollow" href="https://blog.example.com/soup">Visit</a>'), 'https://blog.example.com/soup');
  assert.equal(pinterestOutboundLink('<script>{"link":"https://www.pinterest.com/pin/1/"}</script>'), null);
  assert.equal(pinterestOutboundLink('<html></html>'), null);
});

test('finds recipe links in a caption, not social or link-in-bio pages', () => {
  const caption = 'So good!! Full recipe: https://www.halfbakedharvest.com/lemon-pasta/. Also on https://www.instagram.com/janecooks and linktr.ee/janecooks (https://linktr.ee/janecooks)';
  assert.deepEqual(recipeLinks(caption), ['https://www.halfbakedharvest.com/lemon-pasta/']);
  assert.deepEqual(recipeLinks('Recipe: myblog.com/chili-recipe!'), ['https://myblog.com/chili-recipe']);
  assert.deepEqual(recipeLinks('Get it here (https://bit.ly/3abc).'), ['https://bit.ly/3abc']);
  assert.deepEqual(recipeLinks('Link in bio! #dinner'), []);
  assert.deepEqual(recipeLinks('https://beacons.ai/cook and https://stan.store/cook'), []);
});

const TIKTOK_RECIPE = `Creamy tuscan chicken in 20 minutes 🍗
Ingredients:
2 chicken breasts
1 tbsp olive oil
3 cloves garlic
1 cup heavy cream
1/2 cup parmesan
Sear the chicken, add garlic, pour in the cream and simmer until thick. #dinner #easyrecipe`;

test('recognizes a recipe in a caption', () => {
  assert.equal(captionLooksLikeRecipe(TIKTOK_RECIPE), true);
  assert.equal(captionLooksLikeRecipe(`Banana bread
- 3 ripe bananas
- 1/3 cup melted butter
- 3/4 cup sugar
- 1 egg
- 1 1/2 cups flour
1. Preheat oven to 350F
2. Mix everything and bake 55 min`), true);
  assert.equal(captionLooksLikeRecipe('Weeknight soup: 2 cups broth, 1 can beans, 3 cloves garlic, 1 tsp cumin. Heat the broth, add everything and simmer for 15 minutes. So cozy.'), true);
});

test('does not mistake a plain caption for a recipe', () => {
  assert.equal(captionLooksLikeRecipe('#food #dinner #yum #easyrecipe #foodtok #cooking #recipe #pasta #fyp #viral #foryou #foodie'), false);
  assert.equal(captionLooksLikeRecipe('Best pasta ever, recipe in bio!'), false);
  assert.equal(captionLooksLikeRecipe('We went to the best Italian place in town tonight and the pasta was unreal. Highly recommend booking ahead on weekends, it gets busy. #nyc #foodie'), false);
  assert.equal(captionLooksLikeRecipe('Ingredients matter so much. I always buy the good olive oil and it makes all the difference in everything I eat, honestly, trust me on this.'), false);
});

test('credits the creator', () => {
  assert.equal(creditLine('tiktok', 'cookname'), 'From @cookname on TikTok');
  assert.equal(creditLine('instagram', '@janecooks'), 'From @janecooks on Instagram');
  assert.equal(creditLine('youtube', null), 'From YouTube');
  assert.equal(platformName('pinterest'), 'Pinterest');
  assert.equal(platformName('facebook'), 'Facebook');
});
