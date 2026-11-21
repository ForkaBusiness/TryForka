# Forka Privacy Policy: draft update for Forka Pro

**Status: draft, not live.** For review by a lawyer before publishing. The live policy is `website/privacy.html` (text in `website/_privacy_text.txt`). Once approved, merge into that page and update the dates.

How to read this draft:

- **Rewritten sections** are given in full below and replace the sections they name. Sections not mentioned stay as they are.
- **`[LAWYER REVIEW: ...]`** marks every point that needs a lawyer's judgment.
- **`[CONFIRM]`** marks a fact the owner should confirm.

This draft describes what the app actually stores and sends, as checked in the code on 2026-11-20.

---

## Corrections to the current policy (no longer accurate)

The current policy names services Forka does not use. Leaving them in overstates what is shared, and it also misses what is actually shared.

- **Spoonacular:** not used. Recipes come from TheMealDB and from families' own recipes.
- **Instacart:** not connected (the button says "coming soon"). Remove until a partner exists.
- **Mailchimp and marketing emails:** not used.
- **Google Analytics and any analytics tools:** none are loaded by the website or the app. Remove, or keep a general sentence if analytics will be added. `[CONFIRM]`
- **Push notifications:** not built. Remove.
- **Facebook sign-in:** not offered. Only email/password and Google.
- **Local storage keys** "forka_onboarding_complete" and "forka_preferences": outdated. See the new section 7.
- **Section 8.1** says accounts are deleted by contacting us. Accounts can now be deleted in the app: **Settings > Delete account**.

---

## Replace Section 2 with: 2. Information we collect

### 2.1 What you give us

- **Account:** your name, email address and password. Passwords are stored by our authentication provider as a one-way hash; we never see them. If you sign in with Google, we receive your name, email and Google account identifier. You may add a profile photo.
- **Household food settings:** your household's diet (for example vegetarian), food allergies, ingredients you avoid or never want, which meals to plan, how long weeknight dinners may take, measurement units, and ingredients you tell us you have on hand (kept for a few days).
- **Your family members:** for each person you add: a first name or nickname, whether they are an adult or a child, their allergies, foods they like and dislike, and (Forka Pro) whether a child takes a packed school lunch.
- **Per-person goals (Forka Pro), which may be health-related:** an optional goal for each person, such as "more protein", "lighter", "growing well", or for adults only, a daily calorie or protein target. From these and your planned meals we calculate estimated portions and estimated calories and protein. Children can only have general goals. See section 2.4.
- **Your meal history and feedback:**
  - the meals you plan, lock, swap or remove;
  - meals you mark as cooked;
  - your after-meal check-ins (for each person: whether they loved it, found it fine or didn't eat it, and the date);
  - recipe ratings and notes;
  - favorites and collections;
  - grocery lists (items, ticks, items you add).
  We use this history so the plan learns what your family eats.
- **Recipes you add or import:** recipes you type in, and recipes you import from a link, pasted text, a social media post, or photos. We store the recipe and where it came from (the page address, or the post's account name). We may keep a private copy of a social post's cover image, because those links stop working.
- **Photos you upload:** photos of cookbook pages, handwritten recipe cards or dishes, uploaded to import a recipe or identify a dish. They are stored privately in your account, visible only to you, and deleted when you delete your account. `[CONFIRM: photos are currently kept until the account is deleted; consider deleting them after a successful import]`
- **Payments (Forka Pro):** see section 2.3.
- **Messages to us:** if you email us, your email and message.

### 2.2 What we collect automatically

- **Import records:** for each import attempt:
  - the kind of source (website, photo, social, text);
  - the result, how the recipe was read, and the website's host name (never the full page address);
  - the social platform, how many photos;
  - which fields we flagged for you to check;
  - how long it took.
  This is used to fix imports that fail and to prevent abuse.
- **Usage counters:** how many smart imports you have used, and short-lived records of requests to features with daily limits (kept about one day), to apply fair-use limits.
- **Technical data:** when you use the Service, our hosting providers process your IP address, browser and device type in their logs, for security and reliability. `[CONFIRM: retention of Supabase and Vercel logs on the plans in use]`

### 2.3 Payments (Forka Pro)

Payments are processed by **Stripe**. You enter your card details on Stripe's secure page; Forka never receives or stores your full card number, expiry date or security code.

- **What we receive from Stripe:**
  - your Stripe customer and subscription identifiers;
  - the plan (monthly or yearly);
  - the subscription status (trial, active, payment failed, cancelled);
  - renewal and trial dates;
  - whether a payment was refunded.
- **What we send to Stripe:** your email address and your time zone (so reminder emails show the right date).
- **Stripe's own role:** Stripe processes your payment details under its own privacy policy, and may use them to prevent fraud.

`[LAWYER REVIEW: Stripe acts partly as an independent controller for fraud prevention; wording]`

### 2.4 Sensitive and health-related information

Some of what you tell us can reveal health information about you or your family: **food allergies**, **diets** chosen for health reasons, and **per-person goals** (calorie or protein targets, "lighter", "growing well") with the portions and estimates calculated from them.

- **What we use it for:** only to provide the Service. Allergies filter out recipes; likes and dislikes, goals and portions personalize the plan.
- **What we never do with it:** we do not sell it, use it for advertising, or share it except with the service providers in section 5 that process it for us.
- **Who can see it:** the people in your household who use your account.
- **Removing it:** you can delete a goal, an allergy or a family member at any time in Settings.

`[LAWYER REVIEW: consumer health data laws may apply (e.g. Washington My Health My Data Act, Nevada SB 370, Connecticut). They can require separate consent before collecting consumer health data, a separate health-data privacy policy, and limits on sharing. Decide whether goals and allergies count as "consumer health data" for Forka's users, and whether an explicit consent step is needed when someone first sets a goal or an allergy. Under GDPR, allergy and health-goal data is likely special-category data needing explicit consent (Art. 9(2)(a)).]`

### 2.5 Children

Families can add their children as family members (a first name, allergies, likes and dislikes, a school-lunch setting, and general goals only). This information is provided by the parent or guardian who holds the account, and is used only to plan the family's meals. Children do not have their own accounts.

`[LAWYER REVIEW: COPPA applies to collecting personal information from children under 13; here a parent provides information about a child. Confirm the policy's statements on children and whether additional notice is needed.]`

### 2.6 Hands-free cooking and read aloud: processed on your device

- **Hands-free cooking** uses your camera to recognize a hand wave so you can move between recipe steps without touching the screen.
  - **Camera frames never leave your device.** They are processed in your browser by a hand-tracking model downloaded from Forka's own website, and they are not uploaded, stored or sent to Forka or anyone else.
  - **When the camera is on:** only while hands-free is switched on. It turns off when you switch it off or leave cooking mode.
- **Read aloud** uses your device's built-in speech. The step text is not sent to us for this.

---

## Replace Section 3 with: 3. How we use information

- **Run the Service:** your account, plans, grocery lists, recipes, imports, cooking mode.
- **Personalize:**
  - plan meals around your household's allergies, diet and tastes;
  - learn from check-ins and history;
  - size portions toward each person's goal (Forka Pro).
- **Read and organize recipes you import,** and answer cooking questions (ingredient swaps and variations).
- **Estimate nutrition** for recipes and planned days.
- **Payments and the subscription,** including reminders before a trial ends and messages about failed payments.
- **Keep the Service secure and fair:** prevent abuse and enforce daily limits.
- **Fix problems** and improve how the Service works.
- **Comply with the law.**

We do not sell personal information, and we do not use it for targeted advertising.

---

## Replace Section 5 with: 5. Who we share information with

We share information only with service providers that process it on our behalf, under contracts limiting their use of it:

| Provider | What for | What they receive |
|---|---|---|
| **Supabase** (United States) | Database, sign-in, file storage and server functions | Everything stored in your account |
| **Vercel** (United States) | Hosting the website and app | Requests to the website (IP address, browser) |
| **Anthropic** (United States) | Language-model processing for reading imported recipes (links, text, posts, photos), answering cooking questions, identifying a dish from a photo, suggesting recipes and planning meal-prep sessions | The recipe content, photos or question involved, and the household food settings needed to keep answers safe (allergies, diet). Not your name or email. |
| **Stripe** (United States) | Payments and subscriptions | See section 2.3 |
| **Resend** (United States) | Sending service emails (for example the reminder before a trial ends) | Your email address and the email's content |
| **USDA FoodData Central** (U.S. government) | Nutrition data for ingredients | Ingredient names only, never anything about you |
| **TheMealDB** | The recipe catalog | Nothing about you (we copy the catalog to our own database) |
| **Google** (if you sign in with Google) | Sign-in | Your sign-in event |
| **Websites and social platforms you import from** | Reading a recipe from a link you paste | A request for that page, from our servers, not your device |

`[LAWYER REVIEW: confirm Anthropic's commercial terms on data use (no training on API data; retention period) and reflect them; confirm data processing agreements are in place with each provider]` `[CONFIRM]`

We may also disclose information when required by law, to protect safety or rights, or as part of a business transfer, as described in the current Section 5.

---

## Replace Section 6 with: 6. How long we keep information

- **Your account and everything in it:** while your account exists. When you delete your account in Settings, we delete it and everything in it straight away, including:
  - your family members, goals, allergies, history and recipes;
  - your uploaded photos and profile photo;
  - any Forka Pro subscription, which is cancelled so you are never charged again.
- **Backups:** backups that may contain your information are overwritten on a rolling basis within `[CONFIRM: 7 days on the Supabase Pro plan]`.
- **Payment records:** Stripe keeps records of payments as required for tax and accounting. Forka keeps the payment events it receives from Stripe for `[CONFIRM: a retention period, e.g. 2 years]`.
- **Ingredients on hand:** used for a few days, then no longer used.
- **Daily-limit records:** about one day.
- **Import records:** while your account exists.

`[LAWYER REVIEW: retention periods; the current policy says 90 days after deletion, while the app now deletes at once, which is better for users]`

---

## Replace Section 7 with: 7. Storage on your device

The app stores some things in your browser's local storage, which stays on your device:

- your sign-in session;
- where you are in a recipe in cooking mode, and which ingredients you ticked;
- running cooking timers;
- your text size in cooking mode;
- the servings you chose for a recipe;
- a meal-prep session you planned;
- whether you dismissed a check-in.

Clearing your browser's site data removes these and signs you out. The website and app use no advertising or analytics cookies.

---

## Add to Section 8 (your rights): health data

> You can see, change or delete the health-related information you gave us (allergies, diets, goals) at any time in Settings, and delete a family member and everything about them. Deleting your account deletes all of it.

`[LAWYER REVIEW: rights under state consumer health data laws, e.g. the right to withdraw consent and to have health data deleted, and the response timelines]`
