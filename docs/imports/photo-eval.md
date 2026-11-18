# Photo import: measured accuracy

Model answers saved 2026-11-18 17:41 (UTC), scored 2026-11-18 with the current parsing, review checks and scoring (no model calls; times and costs are in the run's own report). 12 cases from test-imports/. Real photos are listed with scores and flag counts only.

| Model | Cases passed | Wrong amounts, not flagged | Wrong amounts, flagged | Cost per import | Time per import |
|---|---|---|---|---|---|
| claude-haiku-5-5 | 11/12 | 0 | 2 | - | - |

"Flagged" is what the review screen highlights for the household to check. An amount left blank and flagged counts as honest, not wrong. Legibility is the model's own rating of the photo (from runs after 2026-11-18 11:43 CST; "-" before).

| Model | Case | Result | Ingredients right | Steps found | Legibility | Flagged on review | Notes | Time | Cost |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | typed-card.jpg | pass | 10/10 | 4/4 | - | none | all correct | - | - |
| claude-haiku-5-5 | cookbook-page.jpg | pass | 9/9 | 5/5 | - | none | all correct | - | - |
| claude-haiku-5-5 | two-page-1.jpg+two-page-2.jpg | pass | 10/10 | 6/6 | - | 2 in the steps only | all correct | - | - |
| claude-haiku-5-5 | screenshot-1.jpg+screenshot-2.jpg | pass | 7/7 | 5/5 | - | none | all correct | - | - |
| claude-haiku-5-5 | handwritten-neat.jpg | pass | 9/9 | 4/4 | - | 1 amount | all correct | - | - |
| claude-haiku-5-5 | handwritten-messy.jpg | pass | 9/9 | 4/4 | - | 1 amount, 1 in the steps only | all correct | - | - |
| claude-haiku-5-5 | blurry.jpg | FAIL | 6/9 | 5/5 | - | 8 amount, 1 step | wrong: salt: 1 tsp (truth 1/2 teaspoon) [flagged]; milk: 1 cup (truth 3/4 cup) [flagged]. left blank and flagged: all-purpose flour (truth 1 1/2 cups) | - | - |
| claude-haiku-5-5 | dim-angled.jpg | pass | 10/10 | 4/4 | - | none | all correct | - | - |
| claude-haiku-5-5 | no-recipe.jpg | pass | - | - | - | 1 title | said there is no recipe | - | - |
| claude-haiku-5-5 | 533w-q-fDRA-DDIA.jpg.webp (real photo; scores only) | pass | 7/7 | 5/5 | - | 1 repeated line | all correct | - | - |
| claude-haiku-5-5 | Handwritten+Recipe+Book+3.JPG.webp (real photo; scores only) | pass | 5/9 | 6/6 | - | 2 ingredient line, 1 step, 3 amount, 4 in the steps only | 4 only in the method, offered with Add to the list. 2 recipes listed, the expected one picked | - | - |
| claude-haiku-5-5 | images.jpeg (real photo; scores only) | pass | 6/6 | 7/7 | - | 1 in the steps only | all correct | - | - |
