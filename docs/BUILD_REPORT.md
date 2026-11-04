# Forka build report

Finish-the-build pass, October 15–16, 2026. The plan is in `docs/BUILD_PLAN.md`, the architecture is in `docs/FORKA_OVERVIEW.md`, and screenshots are in `docs/screens/after/desktop` (1440px) and `docs/screens/after/mobile` (390×844).

## Where things stand

Every screen in the brief is rebuilt on the new design system. All of them work with real data for a signed-in user, on desktop and on phone. Recipes now come from a catalog in Supabase, copied from TheMealDB, so the app no longer calls TheMealDB itself. Allergies are a hard database filter everywhere a recipe can reach the user.

What's left needs you: Google and Facebook sign-in need accounts only you can create, plus the TheMealDB paid key, email confirmation and a legal review. See "Actions for you".

## What changed, by phase

### Step 0: map and plan
- Commit `b5f6a9a`.
- `BUILD_PLAN.md` records the codebase map, what was left from the earlier redesign attempt, and the decision to remove it rather than merge two design systems.

### Phase 1: security, data layer, auth
- Commits `9903974` and `960a09f`, plus later sync fixes.
- **Keys.** No Anthropic key was in the browser code before this pass, and none is now. All Claude calls run in Edge Functions. The TheMealDB key moved into the `MEALDB_API_KEY` secret, used only by the sync function. `.gitignore` has the required lines.
- **Recipe catalog.**
  - TheMealDB's terms allow a stored copy ("You can scrape, copy and modify any content returned from the API, as long as you use the official end points"). So this is a permanent catalog, not a 7-day cache.
  - 790 recipes and 946 ingredients, synced weekly by pg_cron. Per recipe:
    - meal role
    - allergens and diets
    - a clean name and subtitle
    - estimated time
    - steps with labeled timers
    - US and metric versions of every measure and step
  - 20 unit tests (`npm test`) cover the conversions, timers, allergens and grocery math.
- **US localization.**
  - Every step shows °F: 0 Celsius or gas-mark mentions left, and 314 steps with Fahrenheit.
  - Measures are US: 900 g becomes 2 lb, 500 ml becomes 2 cups.
  - Ingredients use US names: eggplant, zucchini, cilantro, tomato paste, ground beef and so on.
  - Settings has a US / Metric switch.
- **Auth.**
  - Checked: email sign-up, sign-in, sign-out, staying signed in after a reload, and password reset (new "Set a new password" screen).
  - Google and Facebook are switched off in Supabase, so they can't be tested end to end until you set them up. The buttons say "isn't set up yet" instead of showing a raw error page.

### Phase 2: design system
- Commit `651b17f`.
- **Tokens:** the colors, fonts, radius by role, the spacing scale and motion rules from the brief. Contrast for each text color pair is checked and noted in `src/index.css`.
  - Yolk is only used on dark backgrounds, where it reaches 9.3:1.
- **Components:** 20 in `src/components/ds/`. The dev-only `/styleguide` page shows all of them.
- **Layout:** sidebar on desktop and a 56px tab bar on phones (Meal plan, Groceries, Favorites, Settings); the sidebar suggestions button is gone. The wordmark is unchanged.
- **Cleanup:** removed the old primitives and tokens, 27 unused packages and the stale `yarn.lock`.

### Phases 3 and 4: screens and features
- Commit `b80775a`.
- These are one commit because cooking mode and the recipe page needed the timers to work.
- Every screen listed in the brief, plus Terms and onboarding on the same fields as Settings.
- Copy has no emoji, no AI wording, no em dashes and no middle dots. Headings and buttons are in sentence case.
- **Grocery merge rewrite**, with unit tests built from the screenshot cases:
  - Cilantro across 7 meals now sums every amount.
  - Cherry tomatoes show "1 3/4 lb" and "6 whole" on separate lines.
  - Blackberries with no measure show "for Pavlova".
  - "Chopped onion" merges into "Onion".
- **Timers:**
  - Several run at once and survive a reload, because each is stored as an end time.
  - Finishing plays a sound, vibrates and sends a notification (permission is asked on the first timer).
  - The tray shows on every screen.
- **Photo search:** resize to 1024px, HEIC conversion, an optional description, and Haiku vision through a tool call. Results come from the safe catalog. The image is never stored. Limit 20 per day.

### Phase 5: verification
- Commit `27b8b89` and the docs commit.
- **Build and lint:** `npm run build` passes and `eslint` reports 0 problems. The 3 old errors went with the old screens.
- **Text checks:** no emoji, "AI", "Powered by", "Spoonacular", em dashes or middle dots in the app's text.
- **Keys in the built app:** the only key in `dist/` is the Supabase anon key, which is public by design.
- **Click-through:** every screen at 1440px with the existing QA account, and again at 390×844 as a brand-new user. The new user signed up, set allergies, generated a week, opened tonight's dinner, cooked it with a timer, rated it, wrote a note, used a collection, browsed, used photo search and suggestions, checked off groceries, then deleted the account. All steps passed, with no horizontal overflow.
- **Patatas bravas:**
  - Step 1 shows two chips, "Soak 30 min" and "Dry 5 min", and "400°F".
  - The 20-minute cook timer and the 8-minute fry timer ran together.
  - Both kept the right time across a reload, and the finished one showed "Done".
- **Photo search:**
  - A real dish with a description: "Chicken tinga tacos", Mexican chicken dishes first.
  - No description: "Blueberry pancakes", pancake breakfasts.
  - A non-food photo: "Couldn't tell what that dish is. Add a short description and try again."
- **Peanut allergy:** zero peanut recipes in the household's catalog (724 recipes), browse, search ("peanut", "satay"), the saved plan, a newly generated week, suggestions and photo results. Asking for "peanut noodles" shows "You marked peanut as an allergy, so these recipes leave it out."
- **Grocery list:** a full week with correct sums and no mixed-unit lines.
- **Account deletion:** the account had rows in 10 tables; afterwards it has 0 rows, with no orphans.

### Fixes found during verification
- Back after rating from cooking mode reopened step 1. It now returns to the recipe.
- Photo search sometimes rejected a photo even with a description. It now trusts the person's description.
- Some imperial/metric pairs ("2lb/900g") weren't converted. Fixed; no metric units are left in US steps.
- Some cuisines were country names ("France" instead of "French"). Normalized.
- **Suggestion reasons claimed allergens.** The reasons Claude wrote could mention an allergen that was filtered out (it described satay as having peanut sauce). Claude is now told what the household avoids, and the app also scans instructions for allergens. This caught 2 more peanut recipes, "Singapore noodles" and a baklava.
- **Subtitles crossed between recipes, and my first repair made it worse.**
  - The batched classification gave some recipes another dish's subtitle.
  - My first repair step then saved its own explanations as subtitles on about 50 recipes.
  - All 790 subtitles were then rewritten from each recipe's own ingredient list, 10 per call. 0 explanation-style subtitles remain.

## Unfinished, and why

- **Google and Facebook sign-in** need accounts and secrets that only you can create. See actions 1–3.
- **"Who it's for (adults, kids)"** in Settings: the database has no fields for it, as the brief allowed. Household name and number of people are there.
- **Recipe times are estimates.** TheMealDB has no cook times, so Claude estimated one per recipe from the steps. They show as "About 45 min" and drive the weeknight limit. If you'd rather show nothing than an estimate, it's one line in `src/lib/catalog.ts`.
- **Sides, desserts and condiments** don't appear in Build a meal plan, which shows mains and breakfasts as the brief asked. Some of them, like patatas bravas, are good dinners but are classified as sides.
- **After a reload in cooking mode,** you land on the meal plan, not the same step. There's no URL routing (the state machine stays). Running timers are kept.
- **Bundle size:** the app is 529 KB (154 KB compressed). The HEIC converter (1.35 MB) only loads when a HEIC photo needs converting.
- **Claude spend:** an estimated $2–4 in total for this pass (classification, aisles, names, subtitles, and test calls). The function logs didn't return usage totals, so check the Anthropic console for the exact figure.

## Actions for you

1. **Google sign-in:**
   1. Google Cloud Console → APIs & Services → **OAuth consent screen**. Choose External, set the app name to Forka, add your support email, and add your production domain as an authorized domain.
   2. **Credentials → Create credentials → OAuth client ID → Web application.**
      - Authorized JavaScript origins: `http://localhost:5173` and your production URL.
      - Authorized redirect URI: `https://akufkhzzqwjhssmegvof.supabase.co/auth/v1/callback`
   3. Copy the client ID and secret into Supabase → **Authentication → Sign In / Providers → Google**, and turn it on.
2. **Facebook sign-in:**
   1. developers.facebook.com → **Create app**, choosing the use case "Authenticate and request data from users with Facebook Login".
   2. Facebook Login → Settings → Valid OAuth Redirect URIs: `https://akufkhzzqwjhssmegvof.supabase.co/auth/v1/callback`
   3. App settings → Basic: add the privacy policy URL and app domain, then copy the App ID and App Secret.
   4. Switch the app to **Live**.
   5. Paste the ID and secret into Supabase → **Authentication → Sign In / Providers → Facebook**, and turn it on.
3. **Supabase URL configuration** (Authentication → URL Configuration): set **Site URL** to your production URL. Add Redirect URLs `https://<your domain>/**` and `http://localhost:5173/**`.
4. **Turn email confirmation back on** (Authentication → Sign In / Providers → Email → Confirm email). It's off from testing.
5. **TheMealDB paid key:** run `supabase secrets set MEALDB_API_KEY=<key>`. Then use the sync `curl` in `docs/FORKA_OVERVIEW.md`, section 4, to check it. Keep the TheMealDB credit; it's on every recipe page and in Settings → About.
6. **Vercel environment variables:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, the same values as `.env.local`.
7. **Legal review** of the terms page, `src/screens/Terms.tsx`. Facebook Login also needs a privacy policy URL.
8. **Review the limits** (suggestions 5 per minute and 50 per day; photos 20 per day) and set a spend limit in the Anthropic console.
9. **Delete the QA accounts** if you don't need them. All are on mailinator.com:
   - `forka.qa.1791254295244`
   - `forka.qa.signup.1791254653906`
   - `forka.qa.final1280.1791469442121`
   - `forka.qa.final390.1791469498983`
   - `forka.qa.build.1792121464616`
10. **Push** when you're happy. The work is on local branch `master`, which isn't pushed.

There are no migrations waiting. The three migrations from this pass are applied, and the functions are deployed: `ai-suggestions`, `analyze-dish`, `delete-account` and `sync-recipes`.

## Follow-up pass (2026-10-16)

### Done
- **Allergen audit** (`docs/allergen-audit/<allergen>.md`). Every allergen was tested live the way peanut was, using a fresh account with that allergy set: household catalog, browse search, a generated week, suggestions and photo results. **All 0 leaks.**

  | Allergen | Flagged | Unflagged mentions, reviewed and OK | Live leaks |
  |---|---|---|---|
  | Dairy | 411 | 45 (coconut milk, butter beans, peanut butter) | 0 |
  | Egg | 294 | 10 (eggplant, flax egg, "custard cups") | 0 |
  | Gluten | 519 | 7 (rice, corn, chickpea and tapioca flour; rice noodles) | 0 |
  | Tree nut | 73 | 9 (water chestnut, chestnut mushroom, groundnut oil) | 0 |
  | Soy | 73 | 0 | 0 |
  | Fish | 109 | 0 | 0 |
  | Shellfish | 77 | 2 (oyster mushrooms) | 0 |
  | Sesame | 47 | 0 | 0 |
  | Peanut | 35 | 0 | 0 (tested in the first pass) |

- **Map fixes from the audit:**
  - Dairy: fromage frais, chocolate chips.
  - Egg: custard, "aïoli", "mayo".
  - Gluten: oatmeal, toast, Shaoxing wine, black pudding, sausages, falafel.
  - Soy: fermented black beans.
  - Fish: prahok.
  - Shellfish: Thai curry pastes and shrimp paste.
  - Tree nut: nougat.
- **The allergy note now catches adjectives,** so "creamy cheesy…" shows the dairy note.
- **"Check labels if anyone has a severe allergy."** is now under the ingredients on every recipe page.
- **Photo search** no longer errors when Claude leaves a field out. This was the soy photo failure.
- **Recipe pools** (breakfasts / mains / mains of 30 min or less):

  | Profile | Breakfasts | Mains | Mains ≤ 30 min |
  |---|---|---|---|
  | No restrictions | 38 | 450 | 112 |
  | Vegetarian | 26 | 61 | 16 |
  | **Vegan + tree nut** | **2** | **19** | **4** |
  | Gluten + dairy | 6 | 103 | 21 |
  | Pescatarian + shellfish | 28 | 90 | 29 |

  Vegan with a tree nut allergy has fewer than 21 mains. Planning now never repeats a lunch or dinner within a week and avoids last week's. When the pool is too small, it relaxes the last-week rule first, then the time cap, and tells the household in a note. Tested on that profile with lunch and dinner planned: 0 repeats within a week, 9 from last week (the minimum possible with 19 mains), and the note shown.
- **Sync performance:** the recipe sync now runs one letter at a time with a single combined pattern per allergen, after hitting Supabase's processing limit.

### Not done yet: fix next
1. **Cooking mode after a reload:** save the recipe id and step in localStorage, restore them on load, and clear them on Done.
2. **iPhone timers:**
   - Make the finish sound louder and repeat it every few seconds until dismissed.
   - Flash the whole tray, not just the finished row.
   - Use `navigator.audioSession.type = 'playback'` so the sound plays with the silent switch on.
   - Show a one-time tip in cooking mode: "Keep this screen open so you hear your timers."
   - Add a web app manifest, icons and apple-touch-icon.
   - Background: iOS Safari has no Vibration API, and notifications only work for home-screen web apps. Timers can't alert while the phone is locked without push notifications from a server.
3. **Spot check of 20 recipes** (`docs/spot-check.md`): not written yet.
4. **Small:**
   - The "nutty" adjective doesn't trigger the tree nut note.
   - The Supabase logs API returned no rows, so Claude spend is still an estimate.
   - Duplicate "Weeknight" collections are left over from test runs on the build QA account.
5. **QA accounts to delete:** add `forka.qa.allergy.1792125596983@mailinator.com` to the list above.
