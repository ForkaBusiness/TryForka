# Photo import test set

`test-imports/` did not exist when imports were built (2026-11-18), so this set was made for
it. Every image is rendered from a recipe written for the test, so `truth.json` holds the
exact ground truth. It is synthetic: the "handwriting" is handwriting fonts on a lined card,
not a real hand. Add real photos here (and their truth in `truth.json`) and re-run the eval.

| File | What it tests |
|---|---|
| typed-card.jpg | Typed recipe card, two columns |
| typed-card.heic | The same card as HEIC (iPhone format; the app converts it) |
| cookbook-page.jpg | Cookbook page: headnote, two columns, page number |
| two-page-1.jpg + two-page-2.jpg | One recipe across two pages, read as one import |
| screenshot-1.jpg + screenshot-2.jpg | Two phone screenshots of a recipe blog, with ads and reader comments that must be left out |
| handwritten-neat.jpg | Neat handwriting, "c" and "t" abbreviations, a line with no amount |
| handwritten-messy.jpg | Cursive, slanted, "T" for tablespoon, and one amount faded almost to nothing: it must be flagged or read right, never guessed |
| blurry.jpg | The cookbook page, badly blurred: must be refused or flagged, never invented |
| dim-angled.jpg | The typed card, dim and photographed at an angle |
| no-recipe.jpg | A food photo with no recipe in it |

Real photos: put them here with their ground truth in `truth.local.json` (same format as
`truth.json`). Both are git-ignored and stay on the machine that has them; the report lists
them with scores and flag counts only, never their recipe text.

Run: `ANTHROPIC_API_KEY=... deno run --allow-env --allow-read --allow-write --allow-net scripts/eval-photo-import.ts`
(writes `docs/imports/photo-eval.md`, and the model's raw answers to the git-ignored `eval-raw.json`).
Re-score the last run's answers with the current rules, without calling the model:
`deno run --allow-env --allow-read --allow-write scripts/eval-photo-import.ts --rescore`.
