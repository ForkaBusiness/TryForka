# Import accuracy

How well imports read real recipes, per source. Website results come from
`scripts/import-sites.ts` (the same pipeline and fetch rules as the import-recipe
function, run from a Mac on 2026-11-18). Photo results are in `photo-eval.md` once
measured.

## Websites (schema.org JSON-LD)

19 pages from 18 sites: 10 large recipe sites, 8 blogs. Each result was checked line by
line against the page.

| Site | Result | What came through | Flagged / left blank | Wrong |
|---|---|---|---|---|
| NYT Cooking (public page) | Imported | Title, 18 servings, total 45 min, 11 ingredients, 4 steps, photo | None | None. "2 cups minus 2 tablespoons cake flour" keeps the "minus" in the note |
| BBC Good Food | Imported | Title, 6 servings, prep 25 / cook 110 min, 20 ingredients, 9 steps, photo | 2 lines without an amount, as on the page ("small pack basil", "crusty bread to serve") | None. Their JSON-LD drops commas ("smoked streaky bacon finely chopped"), so the note stays in the item name |
| Bon Appetit | Imported | Title, 16 servings, 10 ingredients, 6 steps, photo | No times (the page publishes none) | None |
| Food Network | Imported | Title "The Chewy", 24 cookies (from "2 dozen"), prep 20 / cook 30 min, 11 ingredients, 6 steps, photo | None | None after the fix: dozens were first read as 2 servings |
| Delish | Imported | Title, 4 servings, 12 ingredients, 4 steps, photo | Salt, pepper and lemon wedges have no amount, as on the page | None |
| Tasty | Imported | Title (" Recipe by Tasty" trimmed), 12 servings, prep 20 / cook 15 min, 10 ingredients, 9 steps, photo | None | None |
| King Arthur Baking | Imported | Title, 16 servings, prep 12 / cook 40 min, 7 ingredients with gram weights in the note, 10 steps, photo | None | None |
| Allrecipes | Refused (HTTP 403) | Nothing: the site blocks automated reading | The household sees "That site didn't let Forka read the page" with Add screenshots and Paste the recipe text | - |
| Serious Eats | Refused (HTTP 403) | Same as Allrecipes (same publisher) | Same | - |
| Simply Recipes | Refused (HTTP 403) | Same as Allrecipes (same publisher) | Same | - |
| RecipeTin Eats (blog) | Imported | Title, 4 servings, prep 15 / cook 45 min, 19 ingredients, 10 steps, photo | Mashed potato to serve has no amount, as on the page | None. "(Note 1)" references to the page's notes stay in the notes |
| Minimalist Baker (blog) | Imported | Title, 8 servings, prep 10 / cook 60 min, 15 ingredients, 14 steps, photo | Vegan parmesan and herbs have no amount, as on the page | None after the fixes for "((optional))" and "1/3 scant tsp" |
| Just One Cookbook (blog) | Imported | Title, 2 servings, prep 10 / cook 15 min, 10 ingredients, 13 steps, photo | None | None |
| Love and Lemons (blog) | Imported | Title, 4 servings, prep 10 min, 8 ingredients, 3 steps, photo | "Zest and juice of 2 limes" stays as written, with no separate amount | None after the fix: "optional: 1 to 2 Roma tomatoes" first lost its amount |
| Smitten Kitchen (blog) | No structured data | The page has no Recipe JSON-LD, so production sends its text to the model (not measured yet, see below) | - | - |
| Budget Bytes (blog) | Refused (HTTP 403) | Blocks automated reading | As above | - |
| Cookie and Kate (blog) | Refused (HTTP 403) | Blocks automated reading | As above | - |
| Sally's Baking Addiction (blog) | Refused (HTTP 403) | Blocks automated reading | As above | - |

Summary: 11 of 19 pages imported from structured data with no wrong amounts, units or
steps. 6 sites refuse server-side reading (403). Forka does not try to get around that:
the household is offered screenshots or pasted text, which work for any site. Results can
differ from the edge function's network (some sites treat cloud addresses differently);
check `import_events` (outcome, error_code, site) after launch to see which.

Fixed while testing, with tests: doubled brackets and leading commas from WordPress
recipe plugins, footnote asterisks, "scant/heaping" before the unit, "plus/minus N
tablespoons", nested brackets, yields in dozens, " Recipe by Site" in titles.

## Social posts (public text and metadata only)

From `scripts/import-social.ts` on real public posts (2026-11-18). Never the video: only
oEmbed, the page's metadata and, for TikTok and YouTube, the public post data in the page.

| Post | Credit | What was read | Result without a model | In production |
|---|---|---|---|---|
| TikTok @dadthedish (chorizo pasta, recipe in caption) | From @dadthedish on TikTok | Full caption (796 chars), cover | Recognized as a recipe | Caption goes to the model |
| TikTok @yashajj (tomato pasta, numbered steps in caption) | From @yashajj on TikTok | Full caption (1,433 chars), cover | Recognized as a recipe | Caption goes to the model |
| TikTok @hi.itshollyb (link to her blog) | From @hi.itshollyb on TikTok | Caption, the recipe link | Link found and followed; the blog page has no structured data | The page's text goes to the model |
| TikTok @feelgoodfoodie (an ad, no recipe) | From @feelgoodfoodie on TikTok | Caption | No recipe: "This post's caption doesn't include the recipe..." with Paste text / Add screenshots | Same |
| YouTube compilation video | From @herzhaftundlecker on YouTube | Full description (2,010 chars) | No recipe: the description lists ingredients for three dishes but the method is only in the video | Same (offers text or screenshots) |
| Pinterest video pin | From Pinterest | Title and description | No recipe and no outbound link on this pin | Same |
| Instagram | - | Not tested on a real post: Instagram serves little to logged-out readers, and the post address used was made up | - | Caption from og:description when Instagram provides it, else text or screenshots |

Found and fixed: TikTok's oEmbed now returns only the player (no caption, author or
thumbnail), so every TikTok read as "TikTok - Make Your Day". The caption, handle and
cover now come from the post page's public data, with the handle from the URL as a last
resort. TikTok covers are signed links that expire, so the import keeps a private copy.

## Websites without structured data, captions, pasted text, photos

These go to the model. Not measured in this session: measuring needs the project's
Anthropic key, which is only available to the deployed functions. See
`photo-eval.md` and the run command in `scripts/eval-photo-import.ts`.
