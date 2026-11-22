# Launch status, 21 November 2026 (updated in the evening)

## Ready to launch? Not yet. Close.

The app on tryforka.com works end to end, Forka Pro is merged with billing off, error reporting is live, and the website shows bright, real screenshots. What's left, in order:

1. **Two settings in Sentry (2 minutes, yours).** In Sentry, open **Settings > Projects > forka > Security & Privacy** and turn on **Prevent Storing of IP Addresses**, **Data Scrubber** and **Use Default Scrubbers** (go-live step 4b, item 5). Forka already sends no IP address, but Sentry still works out a city from where an app report came from. I couldn't change this myself: this session's permission check refused it.
2. **Check TheMealDB's terms (with the lawyer).** The app's catalog recipes and photos, and now the website's screenshots, come from TheMealDB. Before taking money, confirm its terms allow commercial use, or take its paid supporter plan if that's what it requires. The site and the app both credit it.
3. **Outside steps**, in this order:
   - lawyer review of the Terms and Privacy drafts (Sentry is now listed in the Privacy draft);
   - live Stripe activation;
   - a support inbox.
4. **Still on the go-live list:** the Supabase paid plan (daily backups) and leaked-password protection (go-live steps 2 and 3).
5. Then follow [docs/launch/go-live.md](launch/go-live.md) to the end, which turns billing on.

Done today: confirmation emails through Resend (you), the Back button fix and the new website (PRs #9, #10), error reporting with Sentry (PR #11, live), and brighter website photos (PR #12). Details in the section just below.

---

## 21 November, evening: Sentry live and new website photos

### Sentry (error reports): live

| Check | Result |
|---|---|
| The live app carries the DSN, and its connection rule allows exactly one Sentry address | Yes (`o4512471438327808.ingest.us.sentry.io`) |
| A test error raised in the live app reached Sentry | Yes (FORKA-1). Its fake email and fake sign-in token arrived blanked as `[email]` and `[token]`. No account id, share link or query string. |
| A test failure in the nutrition function reached Sentry | Yes (FORKA-2), tagged `function: nutrition`, with no request data. The IP stored on it is the Supabase server's own (AWS, Ashburn), not a family's. |
| The app kept working after the test errors | Yes |
| Cleanup | Both test issues resolved; the project's open list is empty. The Sentry command line has no delete, so they stay in Sentry's history marked resolved. |

How it was set up: your organization (Forka) had no projects, so with your OK I created the project `forka` (React, team forka). The `SENTRY_DSN` secret is set in Supabase and all 11 functions were redeployed with their sign-in settings unchanged. You set `VITE_SENTRY_DSN` in Vercel. The Sentry command line is installed at `~/.local/bin/sentry`, signed in as you. I installed it without its shell-profile, completion and agent-skill extras and didn't run its setup wizard.

### Website photos (PR #12, merged)

- **The hero** now shows **spaghetti bolognese**: a bright, sunlit plate, instantly recognizable, 50 minutes, instead of Irish stew.
- **The rest of the week**, for every screenshot that shows recipe photos: chicken fried rice, sweet and sour chicken, teriyaki chicken casserole, spaghetti carbonara, chicken enchilada casserole, sticky chicken. I picked them from a contact sheet of about 60 nut-free catalog photos, checked by eye and by brightness and color measurements. Anything brown or dull (lasagne's crust, Irish stew, beef roasts) was left out.
- **The Pro day:** pancakes with berries, creamy tomato soup and a mango smoothie.
- **The blog:** three photos failed the same standard (raw potatoes, shopping bags on black, a kitten). They're now real Forka screenshots: the grocery list, the after-dinner check-in and the mango smoothie recipe. The other four blog photos are bright food photos and stay.
- **Credit:** TheMealDB is now credited in the footer of the pages whose screenshots show its photos.
- **Review:** a reviewer with no context from this session judged the new hero a clear improvement. It flagged Sunday's slow-cooker tacos ("4.7 hr"), a pale pizza and an off-topic blog image. All three are fixed.
- **The QA account** was staged for a few minutes (a three-person family and the curated week), then restored exactly: the same family, meal settings, week plan with its original timestamp, grocery list and check-ins.

### Production checks after both changes

| Check | After Sentry went live | After the new photos |
|---|---|---|
| Billing off: nothing limited, no prices, Pro tags, trial or Plan section, checkout refused (403), meal prep opens directly, all 13 founding families keep Pro | 17/17 | 17/17 |
| The Back button, phone and desktop | 22/22 | 22/22 (the phone half timed out once on a slow page load, then passed on a rerun) |
| The website at phone and desktop size: accessibility (axe, WCAG 2.2 AA), no horizontal scroll, no missing files, pricing hidden while billing is off, the Google button hidden | 118/118 | 118/118 |

The new photos are live on tryforka.com, byte-for-byte the merged files.

### Noticed, not changed

- **The blog's made-up author names. Fixed** (PR #13, 21 November): every post is now credited to Forka. The posts' dates are unchanged.
- **Catalog wording shows in the app:** "Spaghetti with seasoned ground beef tomato sauce" as a subtitle, "mince" in a step where the description says ground beef, and preparation notes like "Peeled and Sliced" in the grocery amount column for some recipes.

## Part 1: Phase 4 merged (done)

| Item | Result |
|---|---|
| 1. overnight-polish merged | Yes: PR #7, `7669189`. |
| 2. Phase 4 updated from main, retested, squash-merged with billing off | PR #8, `c6b3838`. Unit tests passed, and the 14 Phase 4 browser suites all passed on the merged code (detailed in the table below). |
| 3. Production checked | 17 of 17 checks passed. tryforka.com/app/ loads at phone and desktop size. The billing switch is off. A normal account isn't limited and sees no prices, Pro tags, trial, refund or Plan section. Checkout is refused by the server (403). Meal prep opens directly. All 13 founding families still get Pro. All 11 deployed Edge Functions match main. |
| 4. Cleanup | Branches `phase-4-pro`, `overnight-polish`, `fix/preference-filtering` and `website-link` deleted, with their worktrees. The QA account and forkabusiness+protest@gmail.com are kept. |

Phase 4 suites on the merged code:

| Suite | Checks passed |
|---|---|
| Monthly subscription | 11/11 |
| Trial whose payment fails | 10/10 |
| Trial that converts | 4/4 |
| Every meal | 40/40 |
| Goals | 26/26 |
| Meal prep | 41/41 |
| Upgrade | 12/12 |
| Free limits | 41/41 |
| Billing switch | 13/13 |
| Webhook durability | 12/12 |
| PDF | 10/10 |
| Emails | 14/14 |
| Refund | 14/14 |
| Hands-free | 18/18 |

## Part 2: launch-readiness sweep (branch `launch-fixes`)

**Preview:** https://try-forka-git-launch-fixes-forkabusiness-2455s-projects.vercel.app/app/ (behind your Vercel login)

### 5. Every major flow, end to end

The flows ran against the real backend with the QA account, at 390x844 and at desktop size. Pro flows (trial, checkout, refund, cancel, lunches, goals, meal prep, emails) were covered by the Phase 4 suites above, with the QA preview flag on. You also tested them yourself on the preview with the protest account.

| Flow | Phone | Desktop |
|---|---|---|
| Sign-up form, onboarding (diet, allergy, skipped ingredient, cook time, people), first week fits the family | Pass | Pass |
| Delete account in Settings | Pass | Pass |
| Week plan | Pass | Pass |
| Swap a dinner | Pass | Pass |
| Check-in after dinner | Pass | Pass |
| Groceries: list, tick, add an item | Pass | Pass |
| Nutrition per serving | Pass | Pass |
| Favorites, notes, rating, collections | Pass | Pass (note and rating confirmed in the database) |
| Print and PDF (PDF uses the app's fonts) | Pass | Pass |
| Cooking mode: step timer, read aloud, hands-free, next step | Pass | Pass |
| Cooking help: Missing something, Make it different | Pass | Same screens as phone |
| Find recipes by what you have | Pass | Pass |
| Library | Pass | Pass |
| Recipe editor (typed recipe saves) | Pass | Pass |
| Import from a recipe site link | Pass (2 s) | Phone only (it calls the model) |
| Import pasted text | Pass (5 s) | Phone only |
| Import a photo | Pass ("Dorset apple cake" from a test photo) | Phone only |
| Import a social post | The clear "caption doesn't include the recipe" message for a TikTok post without one. A post with the recipe in its caption wasn't retried tonight. | Phone only |
| Phone Back button (new) | 11/11 | 11/11 |

How the sign-up test avoids emailing anyone: the real sign-up form is filled in and checked. The one request that would send a confirmation email is answered by the test, which creates the account itself, already confirmed, on an @tryforka.com address. Then the test logs in for real, goes through onboarding, and deletes the account in Settings.

### 6. Sentry and function logs

- **Sentry:** set up and live since the evening of 21 November (see the section at the top).
- **Supabase function logs:** my query was refused by this session's permission check. The exact command is under approval item D.
- **What I checked instead:** the last 7 days of database records for imports, Stripe events and the daily billing check. None showed a real error. In the last 30 days there were 2 new sign-ups, one of them your own test alias. Both confirmed their email and signed in.

### 7. Bugs found and fixed (with tests)

**The phone's Back leaves Forka.** On Android (button or gesture), in a browser, or with an iPhone edge swipe, Back from any recipe, sheet or cooking screen left the app altogether, because the app never told the browser it had moved between screens. Now Back steps back one screen. It stays in step with the app's own back arrow and the tabs. Back from the first screen still leaves the app, as it should.
- Commits `f0c0996` and `a6948ec` on `launch-fixes`.
- 12 new unit tests (the whole suite: 472/472) and 22/22 browser checks at both sizes.
- A fresh-context review found one more case: a reload deep in the app made the next Back do nothing. It's fixed and covered by a test that fails without the fix.

**On `site-refresh`, fixed while rebuilding the website:**
- The live sign-up and log-in pages show "Continue with Google", but Google sign-in is off in Supabase, so the button fails. It now shows only when Google sign-in is on.
- The live sign-up page says "Start your 2-week free trial", which isn't the offer. Replaced.
- Emoji icons on the log-in and reset-password pages were replaced with line icons.
- Text contrast and the terms checkbox label failed accessibility checks on the older pages. Both fixed.

**Not bugs, but worth knowing:**
- Supabase refuses some test-inbox addresses (resend.dev) as invalid. This doesn't affect real people.
- The test browser shows "This browser can't keep your screen on" in cooking mode. Phones that support keeping the screen on don't show it.

**Cosmetic or uncertain, not changed:**
- If an upgrade or checkout sheet is open, Back closes the screen behind it and the sheet stays open. Billing is off, so nobody sees these sheets yet. Worth tidying before launch.
- Some catalog recipes carry their source's wording. "cling ilm" is a typo in one recipe. Egyptian fatteh says "1/4 stick of butter" in a step while listing 1/4 cup.
- The website has no favicon.svg. The new pages use the app icon.

### 8. Review and push

- **launch-fixes:** reviewed by a reviewer with no context from this session, the one finding fixed, pushed, not merged.
- **site-refresh:** pushed, not merged.

## Part 3: the website (branch `site-refresh`)

**Preview:** https://try-forka-git-site-refresh-forkabusiness-2455s-projects.vercel.app/ (behind your Vercel login)

- **Pages:** home, features, pricing, FAQ and about are rewritten in the app's Glazed Pantry look, with the same self-hosted fonts.
- **What they cover:** the family plan that learns, groceries, imports from anywhere, hands-free cooking, and Pro ("Free plans your family's dinners. Pro plans your family's whole week.").
- **Pricing:**
  - The pricing section covers Free vs Pro, $4.99 a month or $39.99 a year with a 14-day trial, and the 14-day refund.
  - It's shown only while the billing switch is on. The page reads the same switch the app uses.
  - To preview it now, add `?preview-pricing` to the address, for example `/pricing.html?preview-pricing`.
- **Screenshots:** seven real app screenshots (plan, check-in, family, groceries, import, cooking, a Pro day). They were taken on production with the QA account, with its family shown as Maya, Sam and Leo for a few minutes, then put back exactly. No stock photos of people.
- **Claims match the app:** nearly 800 recipes, the nine allergens, Pinterest included among the import sources.
- **Copy rules:** your copy rules hold on every page (checked automatically).
- **Checks:** 118 of 118 passed, at phone and desktop size:
  - no serious accessibility issues (axe, WCAG 2.2 AA);
  - no horizontal scroll;
  - no missing files;
  - pricing hidden when billing is off and shown when it's on;
  - the Google button hidden while Google sign-in is off.

## Decisions I made on my own

1. **Back button.** I fixed it on `launch-fixes`, though it predates Phase 4. It's the most common way to navigate on Android.
2. **Sign-up test.** It creates its throwaway account through the admin API on @tryforka.com, so no email is ever sent. Supabase refuses the resend.dev test inbox, and every real sign-up email counts against the hourly limit.
3. **Google button.** It's hidden until Google sign-in is turned on, rather than enabling Google sign-in, which is your call (approval list, item B).
4. **Website color.** The older pages' green moved from #1F8F63 to #1A7552, so small text passes contrast. The new pages use the app's own green.
5. **Screenshot household.** The QA family was staged as Maya, Sam and Leo, then restored from a snapshot. The QA account's week plan was replanned while the Pro shot was taken. It's a test account, and its settings are back to dinner only.
6. **Branch base.** `site-refresh` was moved onto the current main. Phase 4 didn't touch the website.
7. **Report location.** This report was committed straight to main, as you asked. It's a document only.
8. **Sentry project.** I created `forka` in your Forka organization (you said yes), and resolved the two test issues, since the command line can't delete them.
9. **Blog images.** The three failing blog photos became real Forka screenshots rather than new stock photos. Unsplash's search was off limits to this session, and the screenshots need no license.
10. **Website week.** Sunday is sticky chicken and Wednesday teriyaki chicken casserole, after the review flagged the 4.7-hour slow-cooker tacos and a pale pizza.

## Approvals needed, with exact commands

Run these in the Terminal, in the `TryForkaMAIN` folder.

**A. Merge the two branches. Done** (PRs #9 and #10, 21 November). Kept for reference:

```bash
gh pr create --base main --head launch-fixes --title "Launch fixes: Back steps back one screen" --body "See docs/launch-status.md"
gh pr merge launch-fixes --squash --delete-branch
gh pr create --base main --head site-refresh --title "Website for launch" --body "See docs/launch-status.md"
gh pr merge site-refresh --squash --delete-branch
```

**B. Google sign-in (optional; skipped for now, as you asked).** Turn it on in **Supabase > Authentication > Sign In / Providers > Google**. You'll need a Google Cloud OAuth client. The website shows the button by itself once the provider is on. If you'd rather not offer it, nothing needs doing.

**C. Error reporting. Done** (21 November): Sentry is live for the app and the functions. One setting is left for you, item 1 at the top.

**D. Function logs for the last 7 days.** I read the project's auth settings with your Supabase CLI token. That confirmed the email sender facts above, and that leaked-password protection is still off. My query of the function logs was refused by this session's permission check, so here is the command to run yourself. It lists every Edge Function response of 400 or above, per function, for each of the last 7 days:

```bash
RAW=$(security find-generic-password -s "Supabase CLI" -w)
case "$RAW" in go-keyring-base64:*) TOKEN=$(printf %s "${RAW#go-keyring-base64:}" | base64 -d);; *) TOKEN="$RAW";; esac
for d in 0 1 2 3 4 5 6; do
  START=$(date -u -v-$((d+1))d +%Y-%m-%dT%H:%M:%SZ); END=$(date -u -v-${d}d +%Y-%m-%dT%H:%M:%SZ)
  curl -s -G -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/akufkhzzqwjhssmegvof/analytics/endpoints/logs" \
    --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END" \
    --data-urlencode "sql=select m.function_id as fn, r.status_code as status, count(*) as n from function_edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r where r.status_code >= 400 group by fn, status order by n desc"
  echo
done
```

Or open **Supabase > Edge Functions > (each function) > Logs** and filter by status.

## Outside steps, in order

1. **Lawyer review** of [docs/legal/terms-draft.md](legal/terms-draft.md) and [docs/legal/privacy-draft.md](legal/privacy-draft.md). Then publish them (go-live step 9).
2. **Live Stripe activation** (go-live step 1). Business details, representative, bank account, statement descriptor, two-step sign-in.
3. **Resend domain** (go-live step 4). **Done** (21 November): Resend is Supabase's email sender, with the email rate limit raised.
4. **Support inbox.** Create support@tryforka.com. Then set `EMAIL_REPLY_TO` to it (go-live note) and add it to Stripe's customer support details.

Also on the go-live list: the Supabase paid plan (daily backups) and leaked-password protection (go-live steps 2 and 3).
