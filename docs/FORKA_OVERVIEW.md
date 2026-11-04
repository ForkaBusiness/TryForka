# Forka: product and technical overview

What Forka is and how it works, drawn from the code (`src/`, `supabase/`) and the live Supabase project. Last refreshed 2026-10-15, after the finish-the-build pass (`docs/BUILD_PLAN.md`, `docs/BUILD_REPORT.md`).

## 1. What Forka is

Forka is a meal planner for busy families. It answers three questions for the parent at 5:30pm: what's for dinner, what to buy, and how to cook it.

The core loop:
1. **Set up the household once.** Diet, allergies, ingredients to skip, which meals to plan and the weeknight time limit. Onboarding and Settings write the same fields.
2. **Plan the week.** Suggestions picks a week from the recipe catalog, or you add recipes yourself from Build a meal plan. Every list is filtered for the household's allergies, diet and skipped ingredients in the database.
3. **Shop.** The grocery list builds itself from the week: amounts summed, sorted by aisle, staples tucked away.
4. **Cook.** The recipe page has US units, 1x/2x/3x scaling and timer chips. Cooking mode shows one step per screen and lets several timers run at once.
5. **Remember.** Favorites, collections, notes, ratings and a cooked log, all saved to the account.

## 2. Screens

All screens are in `src/screens/`, built from the design system in `src/components/ds/`. A dev-only reference is at `/styleguide`.

| Screen | File | Notes |
|---|---|---|
| Sign up, Log in, Set a new password | `Auth.tsx` | Basil panel with a real week preview from the catalog. Outlined Google and Facebook buttons, which explain when a provider isn't turned on. Password reset by email. |
| Terms | `Terms.tsx` | Plain-language draft; needs legal review. |
| Onboarding | `Onboarding.tsx` | Four steps: diet, allergies, ingredients you skip, what to plan. |
| Meal plan (home) | `MealPlan.tsx` | Week strip (today marked in yolk), the Tonight hero, breakfast and lunch rows, rest of the week. Header buttons: Grocery list, New week plan, Browse recipes. |
| Suggestions | `SuggestionsPanel.tsx` | A sheet: free-text request, Find meals like a photo, Plan my whole week, starter chips. Swap mode replaces one day's slot. |
| Build a meal plan | `BrowseRecipes.tsx` | Filters, search, a camera button, and tiles; "+" adds a recipe to the next open slot. |
| Recipe | `RecipeDetail.tsx` | Hero photo, tags, allergen warnings, Ingredients/Steps toggle, scaling, timer chips, TheMealDB credit, Start cooking and Mark as cooked. |
| Cooking mode | `CookingMode.tsx` | "Step n of N", arrow and space keys, keeps the screen awake. Done marks the recipe as cooked, then offers a rating. |
| Notes, Rate this recipe, Add to collection | `Notes.tsx`, `RateRecipe.tsx`, `Collections.tsx` | Notes autosave. Ratings go to `recipe_ratings`. |
| Favorites | `Favorites.tsx` | Favorites and Collections tabs; collections open to their recipes. |
| Groceries | `Groceries.tsx` | Aisles, a "Got it" section per aisle, "Probably have it", add your own items, copy and share. The Instacart button is a placeholder. |
| Settings | `Settings.tsx` | Household, allergies, diet, ingredients we skip, planning, units, account (photo, sign out, delete), About. Saves as you go. |
| Photo search | `PhotoSearch.tsx` | Take or choose a photo, add an optional description, get 6 to 8 similar recipes. |

Navigation is a `currentScreen` state machine with a back stack in `src/App.tsx`. Shared state (session, preferences, week plan, favorites) is in `src/app/AppContext.tsx`. Below 768px a 56px bottom tab bar replaces the sidebar. Running timers float in a tray on every screen (`src/components/Timers.tsx`).

## 3. Stack

- Vite, React 19, TypeScript, Tailwind v4. Tokens are in `src/index.css`. Fonts are Bricolage Grotesque and Figtree; icons are `lucide-react`.
- Supabase: auth, Postgres with row-level security, Edge Functions (Deno), storage for avatars, and pg_cron with pg_net for the weekly sync.
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`, overridable with the `CLAUDE_MODEL` secret), called only from Edge Functions.
- TheMealDB as the recipe source, copied into Supabase. Their terms allow it, with credit.
- Hosting: Vercel (static build).

## 4. Recipe catalog

`recipes` and `ingredient_meta` are filled by the `sync-recipes` Edge Function. It runs weekly through pg_cron, or by hand:

```sh
curl -X POST https://akufkhzzqwjhssmegvof.supabase.co/functions/v1/sync-recipes \
  -H "Content-Type: application/json" -H "x-sync-secret: <SYNC_SECRET>" -d '{"step":"all"}'
```

The steps are:
- `fetch`: every meal from TheMealDB, using `MEALDB_API_KEY`. Each meal is converted with the shared helpers in `supabase/functions/_shared/catalog/`:
  - Steps are split, with timers labeled from the wording ("Soak 30 min").
  - Ingredients are parsed into quantity, unit and note.
  - Text gets US names and units: 400°F, 2 lb, eggplant.
  - Allergens and diets are found from ingredients, the recipe name and the instructions.
- `classify`: Claude sets the meal role, display name, subtitle and an estimated total time, only for rows that don't have them yet. A recipe is never classified twice.
- `aisles`: Claude sorts any new ingredient names into grocery aisles.
- `names`: tidies display names (US words, sentence case).
- `subtitles` (manual): rewrites subtitles from each recipe's own ingredients.

Unit tests for all of this run with `npm test`.

## 5. Data model

Every user table has row-level security that allows owners only, and is removed when the account is deleted.

- **Household settings:**
  - `user_preferences`: diet, allergies (the 9 keys or an ingredient name), ingredients to skip ("never show"), ingredients to avoid ("avoid if possible", ranked last), which meals to plan, weeknight time limit, units, onboarding date. The older onboarding columns are kept but no longer used.
  - `users`: name, household name and size.
- **Plans and shopping:**
  - `week_plans`: one per user, with weekday keys and dates planned and last edited.
  - `grocery_lists`: items, ticked items, items added by hand, and which plan version the list was built from.
- **Recipe history:** `favorites`, `collections` with `collection_recipes`, `notes`, `recipe_ratings` (the old `feedback` table is kept, copied over), and `cooked_recipes`.
- **Photo search and rate limits:**
  - `dish_lookups`: what the photo was identified as. The image itself is never stored.
  - `ai_requests` and `claim_request(kind, per_minute, per_day)`: per-user limits.
- **Catalog:** `recipes` and `ingredient_meta` are readable by everyone, but only the server can write to them.
- **`safe_recipes()`:** the database function every recipe list starts from, a coarse first pass. It removes recipes with the caller's allergens, recipes that don't fit their diet, and recipes using ingredients they skip (whole-word matches).

## 6. Edge Functions

| Function | Auth | What it does |
|---|---|---|
| `ai-suggestions` | user JWT | `suggestions`: Claude picks 6 to 8 recipe ids from the user's safe list; it's told what's filtered and never claims an allergen. `week`: plans the enabled meals for 7 days and checks the weeknight time limit and repeats. Limit 5 per minute, 50 per day. |
| `analyze-dish` | user JWT | Photo plus optional description goes to Haiku vision, which describes the dish through a tool call. Results are scored against the safe catalog and logged in `dish_lookups`. Limit 20 per day. |
| `delete-account` | user JWT | Deletes the user's avatar files, then the auth user. Every table cascades. |
| `sync-recipes` | `x-sync-secret` | The catalog sync (see section 4). Deployed with `--no-verify-jwt`. |

Secrets: `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `SYNC_SECRET`, `MEALDB_API_KEY` (optional; defaults to the test key), `CLAUDE_MODEL` (optional). Vault holds `project_url` and `sync_recipes_secret` for the cron job.

## 7. Allergies

Allergies are a hard filter at every point a recipe can reach the user: browse, search, week plans, suggestions, swaps and photo results. They all read from `safe_recipes()`, then pass through the recipe filter (`supabase/functions/_shared/catalog/recipeFilter.ts`), which is the source of truth. The Edge Functions and the app run the same filter; Claude's prompt lists the exclusions too, but nothing relies on it.

Saved plans are checked again when they load and when settings change. A recipe that no longer fits is replaced with the same kind of meal, or the slot stays empty with a message if nothing fits. After a settings change, the notice offers Undo, which restores the meals and the setting. Undo goes away once the plan is edited or a newer setting is saved, so it can't take back an allergy added later.

Matching over-flags on purpose: ingredient names, the recipe name and the instructions are all checked. A single recipe still opens from a favorite even after an allergy is added, with a warning in the alert color.

Ingredient lists from TheMealDB can be incomplete. The terms page tells users to check labels.
