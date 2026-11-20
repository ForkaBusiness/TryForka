# Overnight report (2026-11-19 to 11-20)

## Ready, and what needs you

**Ready.** All 12 items are done and verified. Nothing was merged and nothing was pushed to main.

- **Phase 4 (`phase-4-pro`)** is finished and verified:
  - the billing switch, off;
  - Free limits enforced by the database;
  - durable webhooks and a daily reconciliation;
  - the delete-account deploy;
  - a security hardening of the database functions;
  - the go-live checklist and legal drafts.
- **Polish (`overnight-polish`, from main)** is finished and verified: hands-free startup, PDF fonts, the accessibility pass, a smaller first load.

**Nothing is blocked**, and no command is waiting for your approval. Everything that needed deploying is deployed:

- the delete-account deploy you approved;
- three additive production migrations, each after a verified backup and a dry run, each with a rollback file.

**For users on main, nothing changed.** The billing switch is off, so the database and the functions limit nobody. This also closes a gap from yesterday: the Phase 4 functions already in production had started applying Free's limits on the server, which would have hit anyone signing up on main. They don't any more.

**Needs you:**

1. **Review the legal drafts** with a lawyer: `docs/legal/terms-draft.md` and `docs/legal/privacy-draft.md`. Every point needing judgment is marked `[LAWYER REVIEW]`, and every fact to confirm is marked `[CONFIRM]`. Don't launch Pro before the Terms are updated.
2. **Decide two business points the drafts raise:**
   - the refund policy (a window, such as 14 days, or none);
   - whether to send the yearly-renewal reminder and the "welcome to Pro" confirmation email. Several states' auto-renewal laws ask for them; neither is built (see the table at the end of `terms-draft.md`).
3. **One design decision:** white text on the orange "Try Forka Free" button is 2.8:1 contrast, below the 4.5:1 accessibility minimum. Fixing it means a clearly darker orange, around `#CC4A15`. I left it as is.
4. **Review and merge** the two branches when you're ready (see "In the morning").

## Previews

These addresses always show the latest build of each branch, behind your Vercel login:

| Branch | Address | Latest build when written |
|---|---|---|
| `phase-4-pro` | https://try-forka-git-phase-4-pro-forkabusiness-2455s-projects.vercel.app/app/ | `try-forka-d06m3d36p-…` |
| `overnight-polish` | https://try-forka-git-overnight-polish-forkabusiness-2455s-projects.vercel.app/app/ | `try-forka-ozvmb5kr3-…` |

On the Phase 4 preview, billing is off: you'll see every feature and no prices, as families will until launch. To see the paid side as a Free account, turn on `billing_preview` for that one account. That's how the QA account was tested.

---

## Part 1: Finish Phase 4

### 1. Deploy delete-account: done and verified

- **The fix first:** a review found a blocking bug. If deleting the Stripe customer worked but a later step failed, a retry could never finish, because Stripe then answers "no such customer". Fixed: an already-deleted customer counts as removed, and the id is forgotten at once.
- **Deployed:** downloaded back, and identical to the repo.
- **Tested live** on a throwaway account (an `example.invalid` address, created and removed by the test, never the QA account):
  - it refuses without confirmation;
  - it deletes an account whose Stripe customer is already gone;
  - the user and their plan row are gone.

### 2. Webhook durability: done and verified

- **What changed:** every Stripe event is stored, with its full payload, before anything is done, and is processed from that record under a 5-minute lock.
  - It's marked processed only once the plan is written; the payload is then cleared (it can contain a name or address).
  - A crash mid-event leaves it "processing"; once the lock is old, Stripe's retry processes it again.
  - A delivery that finds it still locked answers 503, so Stripe tries again later.
- **The daily reconciliation** (`billing-reconcile`, 08:17 UTC via pg_cron, authenticated by a secret kept in Vault and in the function's secrets):
  - finishes events left unfinished, for up to 3 days;
  - compares every subscription with Stripe and writes only what differs, checking 8 at a time;
  - follows the webhook's rules: a running grace period is never restarted, and a resubscribe that lands mid-run is never overwritten;
  - records each run in `billing_reconciliations`.
- **Tested:**
  - unit tests: a killed-mid-event case (retried after the lock expires), a reconciliation fix, a crash-lost trial reminder, grace kept, the resubscribe race;
  - live in the Stripe sandbox, 11/11: a real subscription through the new webhook, a plan knocked out of sync then fixed, a killed-mid-event event finished by the reconciliation, a fresh lock left alone, and calls without the secret refused.
- **Migration** `20261126000000_webhook_durability` and its rollback.

### 3. Database-level Free limits: done and verified

- **Recipes:** 20 of a household's own (typed in or imported). A trigger refuses the 21st insert, so calling Supabase directly doesn't get past it. Two inserts at once can't both take the last place.
- **Imports:** 20 smart imports, reserved atomically in the database before the model runs and handed back if the import fails. Clients can't hand one back themselves.
- **Never limited:** Pro and founding families; catalog hearts and collections, which never count or block; and anyone at all while billing is off.
- **Tested:** database tests in a rolled-back transaction, all passing (`supabase/tests/billing_switch_and_limits.sql`), plus the browser suite (below).
- **Migration** `20261125000000_billing_switch_and_limits` and its rollback.

### 4. Billing switch: done and verified

- **The setting:** `app_settings.billing_enabled`, off. Only the service role can change it.
- **While off:**
  - checkout is refused on the server;
  - the app hides the Plan section, the founding badge, the upgrade sheet, every Pro tag and the trial offers;
  - nobody is limited anywhere: database, functions or app;
  - everyone has every feature, as before Pro.
- **Launch:** one statement in `docs/launch/go-live.md`, step 12.
- **Testing without switching it on:** a per-account `billing_preview` turns billing on for one account.
- **Tested both states:** on the server (13/13) and in the browser at both sizes.

### 5. Rerun everything, then a fresh review: done and verified

- **Tests:** unit tests 452/452 on `phase-4-pro`, and the build passes.
- **Browser suites,** all at 390x844 and desktop, QA account, Stripe test cards:

| Suite | Result |
|---|---|
| Billing: monthly (subscribe, cancel, period end, resubscribe, refund) | 11/11 |
| Billing: trial payment fails | 10/10 |
| Billing: trial converts | 4/4 |
| Every meal | 40/40 |
| Goals | 26/26 |
| Meal prep | 41/41 |
| Upgrade | 12/12 |
| Free limits, both switch states | 41/41 |
| Durability | 11/11 |
| Switch, on the server | 13/13 |

- **Fresh-context review:** one blocking issue (delete-account, item 1), fixed. Of the others, these were fixed:
  - the resubscribe race in the reconciliation;
  - failed events replayed forever, now capped at 3 days;
  - payloads kept after processing, now cleared;
  - the reconciliation's run time, now 8 at a time;
  - imports counted before launch, which the launch step now resets;
  - no database tests, now added.
- **Left, as the reviewer suggested:** if an import function is killed mid-run (rare), the reserved import isn't handed back. That costs the family one import, and only once billing is on.
- **Some first runs failed for test-environment reasons,** not app faults:
  - Supabase's sign-in rate limit;
  - a browser clock set 17 hours ahead, so the session looked expired;
  - meal prep's daily cap of 10, reached by the testing itself;
  - a short network outage on this machine.

  I fixed the tests and reran each to a pass.

---

## Part 2: Go-live preparation (drafts on `phase-4-pro`)

### 6. Go-live checklist: done

`docs/launch/go-live.md` is an ordered checklist for a non-developer:

- activating live Stripe (the adult representative, Forka LLC's details and bank account);
- the setup script, with exact commands;
- Supabase secrets;
- Resend domain verification for tryforka.com and `EMAIL_FROM`;
- revenue recovery settings;
- the founding-families launch script and cutoff;
- flipping the switch, which also resets pre-launch import counts;
- a real purchase and refund;
- what to check the day after;
- rolling back, from turning the switch off up to the rollback files;
- the Supabase paid plan for backups, leaked-password protection, and email confirmation.

### 7. Terms and Privacy drafts, and checkout disclosure: done (drafts for a lawyer)

- **Terms** (`docs/legal/terms-draft.md`): a new subscriptions section covering pricing, auto-renewal, the 14-day trial, cancelling online, failed payments, refunds, price changes, founding families' lifetime Pro, and fair use. Also a goals-and-portions health disclaimer, and corrections where the current Terms no longer match the app.
- **Privacy** (`docs/legal/privacy-draft.md`): everything now stored:
  - family members;
  - allergies and per-person goals, treated as sensitive health-related data;
  - check-in history;
  - uploaded photos;
  - import logs;
  - payments through Stripe;
  - every service provider, including the language-model processor;
  - retention;
  - hands-free (camera frames never leave the device).

  It also lists corrections: the current policy names Spoonacular, Instacart, Mailchimp, Google Analytics, push notifications and Facebook sign-in, none of which the app uses.
- **Auto-renewal requirements:** a table at the end of `terms-draft.md`, with where Forka stands on each.
- **Checkout disclosure, built:**
  - Before anyone pays, the Pro page states the price, that it renews until cancelled and how often, the first charge date for the trial, and how to cancel, with links to the Terms and Privacy Policy.
  - Stripe's own checkout page repeats the renewal terms above its button.

### 8. SECURITY DEFINER review: done and verified

`docs/security/security-definer-review.md` reviews all six functions now in production. None could reach another user's data. Tightened with an additive migration (`20261127000000`; dry run, backup, rollback):

- `handle_new_user` (a trigger function) is no longer callable by clients;
- the unused `claim_ai_request` is no longer callable by clients;
- `claim_request`, the rate limiter, could be called directly with huge limits or made-up kinds to fill its table. It now accepts only valid kinds, caps limits, and refuses anyone past 2,000 requests a day.

Answers for the functions' own calls are unchanged, checked in the dry run and live.

---

## Part 3: Polish (`overnight-polish`, from main)

### 9. Hands-free startup: done and verified (18/18)

- **Preload:** the hand model starts loading when cooking mode opens, so hands-free is watching within about 0.2 s of being turned on instead of several seconds.
- **The camera** is never touched until hands-free is on.
- **Other screens** don't download the model.
- **Save Data:** skipped when the device asks to save data.
- **"Getting ready":** if hands-free is turned on before the model is ready, the camera preview shows straight away so the cook can aim, with "Getting ready" and a spinner.

### 10. PDF fonts: done and verified (10/10)

- **The fonts:** downloaded PDFs use Fraunces and Figtree, like the printed page. The static TTFs are made from the exact font files the app ships, at its settings, and cut to the characters recipes use: about 115 KB, loaded only when a PDF is made. `scripts/make-pdf-fonts.py` rebuilds them; the OFL licences are included.
- **Missing characters:** the few characters recipes use that the fonts lack are spelled out (℉ as °F, ⅕ as 1/5).
- **Fallback:** if the fonts can't load, the standard PDF fonts are used rather than failing.
- **Noticed, not changed:** one catalog recipe's text reads "cling ilm"; the typo is in the source data.

### 11. Accessibility pass: done and verified

- **The check:** axe-core, WCAG 2.2 A/AA plus best practices, across 10 main screens at both sizes. The app's own screens had no WCAG failures.
- **Fixed, without changing the design:**
  - sign-in page contrast: the green, the divider and the footer text;
  - a missing main landmark and the heading order on the sign-in page;
  - closed mobile menus on all 11 website pages are now inert, so keyboard users don't land on hidden links;
  - cooking mode has a page heading;
  - the desktop wordmark sits in a header landmark.
- **Keyboard focus order** checked on sign-in and cooking mode.
- **Left for you:** the orange button (see above).

### 12. Smaller first load: done and verified (45/45)

- **Result:** the main file goes from 741 KB to 619 KB (225 to 187 KB compressed, about 17% less).
- **What moved out:** cooking mode, import, the editor, the panels and the rarer screens load when first opened.
- **Cooking mode** is fetched while a recipe page is open, so Start cooking stays instant.
- **After a deploy,** a missing old file makes the app reload once instead of breaking.
- **Checked against the production build** at both sizes:
  - the first load fetches none of these files;
  - every one of them opens without errors.

Unit tests 345/345 on this branch, and the build passes.

---

## Decisions I made on my own

1. **What billing off means:** everyone gets every feature and nothing is limited, as before Pro. The alternative was Free features only, without limits, but main users already plan breakfast and lunch, so that would have taken something away.
2. **Testing billing while it's off:** a per-account `billing_preview`, used only for the QA account, so I never had to switch billing on for everyone.
3. **The Free recipe limit:** "20 recipes of your own" (typed in or imported), as your item 3 described. Hearts and collections no longer count anywhere, including the app's own checks, and the upgrade sheet says so.
4. **Founding badge and Plan section:** hidden while billing is off.
5. **Pre-launch imports:** reset to zero in the launch step, so imports made before launch don't count toward Free's 20.
6. **The reconciliation:** runs daily at 08:17 UTC, replays unfinished events for 3 days, and clears event payloads once processed.
7. **Legal drafts as Markdown in `docs/legal/`,** not edits to `website/`, so nothing unreviewed can go live with a merge. They're written as replacement sections rather than a full rewrite of unchanged boilerplate.
8. **The orange button:** left as is (a brand decision).
9. **Hand model preload:** skipped when the device asks to save data.
10. **PDF fonts:** subset to Latin, Latin Extended, punctuation, fractions and the degree sign, which keeps them small.
11. **Hands-free preload:** waits until the first step is on screen.
12. **Polish work in a separate worktree** (`../TryForka-polish`), so it never touched the Phase 4 working tree.

## Test data and housekeeping

- **QA account, test data only:** its plan, preferences, family, recipes, favorites and week plan were changed during tests and reset afterwards; it's Free again.
  - Its rate-limit counters were cleared so the suites could run.
  - Its meal-prep allowance for today is used up; it resets within a day.
- **Throwaway account:** one was created and deleted to test delete-account.
- **Stripe sandbox:** older QA test clocks remain. Harmless; delete them in the dashboard if you like.
- **Backups:** three, taken before each migration, in `../db-backups/` (outside the repo): `forka-2026-11-20-before-billing-switch`, `-before-webhook-durability`, `-before-definer-hardening`.
- **New secret:** `BILLING_RECONCILE_SECRET`, stored in Supabase function secrets, in Vault (`billing_reconcile_secret`), and in the git-ignored `.billing.local`.

## In the morning, in this order

1. Read this report, then open both previews (links above). On Phase 4, nothing should look different from main except the new Pro features, all switched on.
2. Review `overnight-polish`. It's small and independent of Phase 4, and it can merge first. On a phone, open a recipe, start cooking, and turn hands-free on; download a recipe PDF.
3. Send `docs/legal/terms-draft.md` and `privacy-draft.md` to a lawyer. Decide the refund policy and the two reminder emails.
4. Decide on the orange button.
5. Review `phase-4-pro`, starting with `docs/launch/go-live.md`. Merging it changes nothing for families while the switch is off.
6. When you're ready to launch, follow `docs/launch/go-live.md` from step 1.
