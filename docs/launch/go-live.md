# Launching Forka Pro: the go-live checklist

Do these in order. Each step says where to do it, what to type or click, and how to tell it worked. Steps marked **Terminal** are typed in the Terminal app, in the Forka project folder (`TryForkaMAIN`). Nothing here needs code changes.

Plan for about two hours, most of it waiting on Stripe and on the domain check. Pick a quiet time of day. Until step 12, nothing changes for anyone using Forka.

---

## Before launch day

### 1. Activate your live Stripe account (a few days ahead)

Stripe needs to know the business before it will take real payments. In the [Stripe dashboard](https://dashboard.stripe.com), turn off **Test mode** (top right), then follow **Activate payments**. Have these ready:

- **The business:** Forka LLC, business type LLC, the EIN, the business address, the website (`https://tryforka.com`), and a one-line description ("Meal planning app for families, sold as a monthly or yearly subscription").
- **An adult representative:** someone who owns or manages Forka LLC and is at least 18. Stripe asks for their legal name, date of birth, home address, phone, email, and the last four digits of their SSN. Stripe may ask for an ID photo.
- **The bank account** that payouts go to, in Forka LLC's name: routing number and account number.
- **How you appear on card statements:** the statement descriptor, for example `FORKA`. Keep it recognizable so families don't dispute the charge.
- **Support details shown to customers:** support email and, optionally, phone.
- **Two-step sign-in on the Stripe account.** Stripe requires it for live mode.

**It worked when:** the dashboard no longer shows "Activate payments", and Settings > Payouts shows the bank account.

### 2. Upgrade Supabase to the paid plan (backups)

In the [Supabase dashboard](https://supabase.com/dashboard), open the Forka project, then **Settings > Billing**, and move to the **Pro** plan. That plan includes daily backups kept for 7 days. Taking people's money means their data must be recoverable.

- Optional: add **Point in Time Recovery** for restores to any minute.
- **It worked when:** **Database > Backups** lists a daily backup.

### 3. Turn on two Supabase sign-in protections

In the Supabase dashboard, go to **Authentication**:

- **Leaked password protection.** Under **Sign In / Providers > Email** (or **Attack Protection**, depending on the dashboard version), turn on **Prevent use of leaked passwords**. Passwords found in known breaches are then refused. This needs the Pro plan from step 2.
- **Email confirmation. Done** (confirmed by the owner, 21 November 2026): **Confirm email** is on, Resend sends the confirmation emails (step 4), the email rate limit is raised, and confirmation emails arrive.

**It worked when:** a new test sign-up gets a confirmation email, and signing up with a well-known leaked password such as `password123` is refused.

### 4. Send email from tryforka.com (Resend). Done

**Done** (confirmed by the owner, 21 November 2026): Resend is connected as Supabase's email sender (custom SMTP), the email rate limit is raised, and sign-up confirmation emails arrive. Kept below for reference.

Trial reminders and receipts should come from `@tryforka.com`, not Resend's test address.

1. In [Resend](https://resend.com), go to **Domains > Add domain** and enter `tryforka.com`.
2. Resend shows a few DNS records (TXT and MX, sometimes CNAME). Add each one where the domain's DNS is managed. For tryforka.com that is Vercel: **Vercel > Domains > tryforka.com > DNS Records**. Copy each value exactly. Wait for Resend to show **Verified**; usually minutes, sometimes a few hours.
3. Optional, recommended for step 3: in Supabase, under **Authentication > Emails > SMTP Settings**, turn on custom SMTP with Resend's SMTP details. Sender `hello@tryforka.com`, name `Forka`.

**It worked when:** Resend shows tryforka.com as **Verified**.

### 4b. Turn on error reports (Sentry)

So you hear about errors before families do. Everything is built and tested; it stays off until it has an address to send to.

1. At [sentry.io](https://sentry.io), sign up (the free plan is enough to start) and create a project. Platform: **React**. Name: `forka`.
2. Sentry shows a **DSN**, an address that looks like `https://abc123@o456.ingest.us.sentry.io/789`. It isn't a secret: it only lets things send reports to your project.
3. **The app:** in **Vercel > the project > Settings > Environment Variables**, add `VITE_SENTRY_DSN` with the DSN, for **Production** (and Preview if you want reports from previews too). Then redeploy: **Deployments > the latest production one > Redeploy**.
4. **The server functions (Terminal):**

```bash
supabase secrets set SENTRY_DSN=https://abc123@o456.ingest.us.sentry.io/789
for f in ai-suggestions analyze-dish billing cooking-help delete-account import-recipe meal-prep nutrition; do supabase functions deploy $f; done
for f in stripe-webhook billing-reconcile sync-recipes; do supabase functions deploy $f --no-verify-jwt; done
```

5. In Sentry, **Settings > Projects > forka > Security & Privacy**: turn on **Data Scrubber** and **Use Default Scrubbers**, and turn on **Prevent Storing of IP Addresses**. Forka already strips personal details before sending; this is a second line.
6. In **Alerts**, keep the default "new issue" email alert, sent to the business inbox.

**It worked when:** a few minutes after the redeploy, open tryforka.com/app/, open the browser's developer console and type `setTimeout(() => { throw new Error('Sentry test') })`. Within a minute, **Issues** in Sentry shows "Sentry test", with the app's address and no personal details.

---

## Launch day

### 5. Set up Pro in live Stripe (Terminal)

Find your live secret key at **Stripe > Developers > API keys**, with Test mode off. It starts with `sk_live_`. Then type this, with your key in place of `sk_live_...`:

```bash
STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs \
  --webhook https://akufkhzzqwjhssmegvof.supabase.co/functions/v1/stripe-webhook \
  --secret-out ./.stripe-webhook-secret.local
```

- **What it creates in live Stripe:** the Forka Pro product, the two prices ($4.99 a month, $39.99 a year), the Customer Portal settings (cancel any time, update card, switch plans) and the webhook.
- **The webhook signing secret** is saved to `.stripe-webhook-secret.local`. That file is never shown on screen and never saved to git.
- **It's safe to run twice:** it only creates what's missing.

**It worked when:** it ends without an error, and **Stripe > Developers > Webhooks** lists the Forka endpoint.

### 6. Give the live keys to Supabase (Terminal)

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET="$(cat .stripe-webhook-secret.local)"
supabase secrets set EMAIL_FROM="Forka <hello@tryforka.com>"
supabase secrets set EMAIL_REPLY_TO="support@tryforka.com"   # where replies to Forka's emails go (see the note below)
supabase secrets unset EMAIL_TEST_TO
```

- `EMAIL_TEST_TO` only sends sandbox reminders to a test inbox. It's ignored with a live key, but removing it keeps things tidy.
- Afterwards, delete the local file: `rm .stripe-webhook-secret.local`.

**Note on replies:** `EMAIL_REPLY_TO` is currently set to `ForkaBusiness@gmail.com` (the business inbox), so replies to the welcome, trial and renewal emails reach you today. Once a `support@tryforka.com` mailbox exists, receiving mail through the tryforka.com domain, switch to it with the command above, then send yourself a test reply. Don't switch before the mailbox exists, or replies will bounce.

**It worked when:** `supabase secrets list` shows `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EMAIL_FROM` and `EMAIL_REPLY_TO` (it shows names, never values).

### 7. Stripe's retry settings for failed payments (revenue recovery)

In Stripe (live mode), go to **Settings > Billing > Revenue recovery** (called **Subscriptions and emails** in some dashboard versions):

- **Smart Retries:** on, retrying for up to **2 weeks**. Forka keeps Pro for 7 days after a failed payment, then pauses it until the card works.
- **If all retries fail:** **cancel the subscription**. Forka then moves the family to Free, and everything they saved stays.
- **Customer emails:** turn on Stripe's **failed payment** email and the **expiring card** email, both with a link to update the card.
- **Receipts:** under **Settings > Customer emails**, turn on **Successful payments**.

**It worked when:** the page shows Smart Retries on and "Cancel the subscription" as the final action.

### 8. Optional: more payment methods

Checkout currently takes cards only. To add Apple Pay, Google Pay or Link, turn them on in **Stripe > Settings > Payment methods**, then ask for the checkout setting to be widened (one line in `supabase/functions/billing/index.ts`).

### 9. Publish the updated Terms and Privacy Policy

The drafts are in `docs/legal/` (`terms-draft.md`, `privacy-draft.md`), with every point a lawyer should check marked. After the lawyer has reviewed them, they replace `website/terms.html` and `website/privacy.html`.

**Don't launch Pro before this.** The Terms must describe the subscription, auto-renewal, the trial and refunds.

### 10. Merge Phase 4 and let it deploy

Merge the `phase-4-pro` pull request into `main` on GitHub. Vercel deploys tryforka.com in a few minutes.

- With the billing switch still off, families see no change: no prices, no limits, every feature on.
- **It worked when:** Vercel shows the new deployment as **Ready**, and the app at `tryforka.com/app/` opens normally.

### 11. Founding families, up to this moment (Terminal)

Everyone who signed up before Pro launches gets Pro for life. Run this right before step 12:

```bash
supabase db query --linked -f supabase/launch/founding_at_launch.sql
```

It prints how many founding families there are. Then ask for `FOUNDING_CUTOFF` in `supabase/functions/_shared/billing/state.ts` to be set to this moment, as a record of the rule. It only affects tests and documentation.

### 12. Turn billing on (the switch) (Terminal)

This is the moment Pro launches. Prices, the trial and Free's limits appear for everyone at once. The first line starts everyone's import count at zero, so imports made before launch don't count toward Free's 20.

```bash
cat > /tmp/billing-on.sql <<'SQL'
-- Imports made before launch don't count toward Free's 20.
update public.user_plans set smart_imports_count = 0, updated_at = now() where smart_imports_count > 0;
update public.app_settings set value = 'true', updated_at = now() where key = 'billing_enabled';
select key, value from public.app_settings;
SQL
supabase db query --linked -f /tmp/billing-on.sql
```

**It worked when:** it prints `billing_enabled | true`. Reload the app and **Settings** shows a **Plan** section.

### 13. A real purchase and refund (your own card)

1. Sign in with your own account (not a founding one; create a new account if yours is founding). In Settings, tap **See Pro**, choose **Monthly**, and pay $4.99 with your real card.
2. Check that the app says **You're on Pro**. In Stripe (live), the payment shows under **Payments**, and the receipt email arrives.
3. In the app, go to **Settings > Plan > Refund my last payment** and confirm. This is the same 14-day, no-questions refund families get. Check that the refund appears in **Stripe > Payments**.
4. Within a minute, the app's Settings shows **Free**. The subscription in Stripe shows **Canceled**.
5. Optional: start the **yearly trial** with your card, check that Settings says **Pro trial**, then cancel from **Settings > Manage plan**. Nothing is charged.

**It worked when:** all of the above happened, and **Supabase > Edge Functions > stripe-webhook > Logs** shows the events with no errors.

### 14. The day after

- **The daily check ran:** in Supabase, under **Database > Cron**, the job `billing-reconcile-daily` (08:17 UTC each day) has a successful run.
  - Each run is also listed in the `billing_reconciliations` table. A run with `fixed` above 0 means a webhook was missed and the run corrected it.
- **No events stuck:** `select status, count(*) from stripe_events group by 1;` should show only `processed`.

---

## If something goes wrong: rolling back

From quickest to most thorough. Most problems only need the first.

1. **Turn billing off (instant, safe).** Everyone gets every feature again, no limits, nothing to buy. Existing subscriptions keep running in Stripe.
   ```bash
   cat > /tmp/billing-off.sql <<'SQL'
   update public.app_settings set value = 'false', updated_at = now() where key = 'billing_enabled';
   SQL
   supabase db query --linked -f /tmp/billing-off.sql
   ```
2. **Stop charging people.** In Stripe (live), go to **Billing > Subscriptions** and cancel each subscription, refunding as appropriate. Or pause collection from the subscription's menu. Do this before anything below, so nobody is billed for something they can't use.
3. **Put the previous app back.** In Vercel, go to **Deployments**, find the deployment before the merge, and choose **Promote to Production** (Instant Rollback). It takes seconds.
4. **Database changes** (rarely needed; the switch already makes them inactive). Each has an undo file in `supabase/rollbacks/`. Run them newest first, and only after step 3:
   ```bash
   supabase db query --linked -f supabase/rollbacks/20261126_webhook_durability_down.sql
   supabase db query --linked -f supabase/rollbacks/20261125_billing_switch_and_limits_down.sql
   ```
   Undoing founding families or the billing columns themselves isn't needed to roll back a launch. Leave those.
5. **Stripe keys.** To fully return to sandbox, set the test key and test webhook secret again with `supabase secrets set` (step 6, with the `sk_test_` key and the sandbox secret).

---

## What's already done (no action needed)

- Pro is built and tested end to end in the Stripe sandbox: checkout, trial, renewal, failed payment and grace period, cancellation, refunds, and the reminder 3 days before a trial ends.
- Every Stripe event is stored before it is handled. A daily job compares every subscription with Stripe and fixes anything that drifted.
- Free's limits (20 recipes of your own, 20 imports) are enforced by the database as well as the app. They only apply once billing is on.
- The founding-family rule, the billing switch and the daily check are already in the production database. They do nothing until step 12.
