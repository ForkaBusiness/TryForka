// Forka Pro billing: webhook signatures, idempotency, and every subscription state the
// webhook can set, run through processEvent with a fake Stripe and database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingView, effectivePlan, FREE_ROW, GRACE_DAYS, signPayload, subscriptionPatch, trialAllowed, verifyStripeSignature,
  type PlanRow, type StripeSubscription,
} from '../supabase/functions/_shared/billing/state.ts';
import { processEvent, type StripeEvent, type WebhookDeps } from '../supabase/functions/_shared/billing/webhook.ts';
import { priceText, trialReminderEmail } from '../supabase/functions/_shared/billing/email.ts';

const SECRET = 'whsec_test_secret';
const DAY = 86_400_000;
const T0 = new Date('2026-12-01T12:00:00Z');
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const later = (days: number) => new Date(T0.getTime() + days * DAY);

// ── Signatures ─────────────────────────────────────────────────────────────

test('signature: a payload Stripe signed is accepted', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const header = await signPayload(body, SECRET, s(T0));
  assert.equal(await verifyStripeSignature(body, header, SECRET, s(T0)), true);
  // Stripe may list several v1 signatures (secret rotation): any match is enough.
  assert.equal(await verifyStripeSignature(body, `t=${s(T0)},v1=deadbeef,${header.split(',')[1]}`, SECRET, s(T0)), true);
});

test('signature: tampering, the wrong secret, old timestamps and missing headers are refused', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const header = await signPayload(body, SECRET, s(T0));
  assert.equal(await verifyStripeSignature(body.replace('evt_1', 'evt_2'), header, SECRET, s(T0)), false, 'body changed');
  assert.equal(await verifyStripeSignature(body, header, 'whsec_other', s(T0)), false, 'wrong secret');
  assert.equal(await verifyStripeSignature(body, header, SECRET, s(T0) + 301), false, 'replayed after 5 minutes');
  assert.equal(await verifyStripeSignature(body, header, SECRET, s(T0) + 299), true, 'within tolerance');
  assert.equal(await verifyStripeSignature(body, null, SECRET, s(T0)), false);
  assert.equal(await verifyStripeSignature(body, `t=${s(T0)}`, SECRET, s(T0)), false, 'no v1');
  assert.equal(await verifyStripeSignature(body, 'garbage', SECRET, s(T0)), false);
  assert.equal(await verifyStripeSignature(body, header, '', s(T0)), false, 'no secret configured');
});

// ── A fake Stripe and database ─────────────────────────────────────────────

function world(row: Partial<PlanRow> = {}) {
  const state = {
    row: { ...FREE_ROW, stripe_customer_id: 'cus_1', ...row } as PlanRow,
    events: new Set<string>(),
    subs: new Map<string, StripeSubscription>(),
    emails: [] as Array<{ to: string; trialEnd: Date; amount: number }>,
    cancelled: [] as string[],
    now: T0,
    failNextUpdate: false,
    updates: 0,
  };
  const deps: WebhookDeps = {
    claim: async id => { if (state.events.has(id)) return false; state.events.add(id); return true; },
    release: async id => { state.events.delete(id); },
    findUser: async ({ customer, userId }) => (customer === state.row.stripe_customer_id || userId === 'user_1' ? { userId: 'user_1', row: state.row, email: 'qa@tryforka.com' } : null),
    updatePlan: async (_id, patch) => {
      if (state.failNextUpdate) { state.failNextUpdate = false; throw new Error('database unavailable'); }
      state.updates++;
      state.row = { ...state.row, ...patch };
    },
    fetchSubscription: async id => { const sub = state.subs.get(id); if (!sub) throw new Error(`no ${id}`); return sub; },
    cancelSubscription: async id => { state.cancelled.push(id); const sub = state.subs.get(id)!; state.subs.set(id, { ...sub, status: 'canceled' }); },
    sendTrialReminder: async (to, d) => { state.emails.push({ to, trialEnd: d.trialEnd, amount: d.amount }); },
    now: () => state.now,
  };
  const sub = (status: StripeSubscription['status'], extra: Partial<StripeSubscription> = {}): StripeSubscription => ({
    id: 'sub_1', status, customer: 'cus_1', cancel_at_period_end: false, metadata: { user_id: 'user_1' },
    items: { data: [{ current_period_end: s(later(30)), price: { recurring: { interval: 'year' }, unit_amount: 3999, currency: 'usd' } }] },
    ...extra,
  });
  let n = 0;
  const event = (type: string, object: Record<string, unknown>): StripeEvent => ({ id: `evt_${++n}`, type, created: s(state.now), data: { object } });
  return { state, deps, sub, event, setSub: (x: StripeSubscription) => state.subs.set(x.id, x) };
}

// ── Idempotency ────────────────────────────────────────────────────────────

test('idempotency: the same event delivered twice is applied once', async () => {
  const w = world();
  w.setSub(w.sub('active'));
  const e = w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
  assert.equal((await processEvent(e, w.deps)).status, 'processed');
  const updates = w.state.updates;
  assert.equal((await processEvent(e, w.deps)).status, 'duplicate');
  assert.equal(w.state.updates, updates, 'no second write');
});

test('idempotency: a failure releases the event, so Stripe\'s retry applies it', async () => {
  const w = world();
  w.setSub(w.sub('active'));
  const e = w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
  w.state.failNextUpdate = true;
  await assert.rejects(processEvent(e, w.deps), /database unavailable/);
  assert.equal(w.state.row.plan, 'free');
  assert.equal((await processEvent(e, w.deps)).status, 'processed', 'the retry is not a duplicate');
  assert.equal(w.state.row.plan, 'pro');
});

test('order: an out-of-date event can\'t undo a newer state (the subscription is read fresh)', async () => {
  const w = world();
  w.setSub(w.sub('canceled'));
  // An old "updated: active" arrives after the cancellation: Stripe now says canceled.
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', status: 'active' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
});

// ── Every state ────────────────────────────────────────────────────────────

test('yearly trial: checkout starts a 14-day trial, Pro at once, the trial is used up', async () => {
  const w = world({ stripe_customer_id: null });
  w.setSub(w.sub('trialing', { trial_end: s(later(14)) }));
  await processEvent(w.event('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'user_1' }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  assert.equal(w.state.row.billing_status, 'trialing');
  assert.equal(w.state.row.trial_used, true);
  assert.equal(w.state.row.stripe_customer_id, 'cus_1', 'the customer is linked to the user');
  assert.equal(w.state.row.billing_interval, 'year');
  const v = billingView(w.state.row, T0);
  assert.equal(v.kind, 'trialing');
  assert.equal(v.kind === 'trialing' && v.ending, false);
  assert.equal(billingView(w.state.row, later(11.5)).kind === 'trialing' && (billingView(w.state.row, later(11.5)) as { ending: boolean }).ending, true, 'trial ending in the last 3 days');
  assert.equal(trialAllowed(w.state.row, 'year'), false, 'one trial per account');
});

test('trial reminder: sent once, three days before, with the date and price; not if the trial was cancelled', async () => {
  const w = world();
  w.setSub(w.sub('trialing', { trial_end: s(later(14)) }));
  w.state.now = later(11);
  const e1 = w.event('customer.subscription.trial_will_end', { id: 'sub_1' });
  assert.equal((await processEvent(e1, w.deps)).status, 'processed');
  assert.equal(w.state.emails.length, 1);
  assert.equal(w.state.emails[0].trialEnd.toISOString(), later(14).toISOString());
  assert.equal(w.state.emails[0].amount, 3999);
  // A second, different event for the same trial (Stripe can resend): no second email.
  await processEvent(w.event('customer.subscription.trial_will_end', { id: 'sub_1' }), w.deps);
  assert.equal(w.state.emails.length, 1);
  const c = world();
  c.setSub(c.sub('trialing', { trial_end: s(later(14)), cancel_at_period_end: true }));
  await processEvent(c.event('customer.subscription.trial_will_end', { id: 'sub_1' }), c.deps);
  assert.equal(c.state.emails.length, 0, 'nothing will be charged, so no reminder');
});

test('trial ends and the card is charged: still Pro, now active', async () => {
  const w = world({ plan: 'pro', billing_status: 'trialing', trial_used: true });
  w.setSub(w.sub('active', { trial_end: s(later(14)) }));
  w.state.now = later(14);
  await processEvent(w.event('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  assert.equal(w.state.row.billing_status, 'active');
  assert.equal(billingView(w.state.row, w.state.now).kind, 'active');
});

test('monthly: subscribe, then renew (newer invoice shape)', async () => {
  const w = world();
  w.setSub(w.sub('active', { items: { data: [{ current_period_end: s(later(31)), price: { recurring: { interval: 'month' }, unit_amount: 499, currency: 'usd' } }] } }));
  await processEvent(w.event('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'user_1' }), w.deps);
  assert.equal(w.state.row.billing_interval, 'month');
  assert.equal(w.state.row.trial_used, false, 'monthly has no trial');
  assert.equal(trialAllowed(w.state.row, 'month'), false, 'no trial on monthly');
  assert.equal(trialAllowed(w.state.row, 'year'), true, 'the yearly trial is still available');
  w.setSub(w.sub('active', { items: { data: [{ current_period_end: s(later(62)), price: { recurring: { interval: 'month' }, unit_amount: 499, currency: 'usd' } }] } }));
  w.state.now = later(31);
  await processEvent(w.event('invoice.paid', { parent: { subscription_details: { subscription: 'sub_1' } }, customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.current_period_end, later(62).toISOString());
});

test('failed payment: Pro for a 7-day grace period, then Free; a working card brings Pro back', async () => {
  const w = world({ plan: 'pro', billing_status: 'active' });
  w.setSub(w.sub('past_due'));
  await processEvent(w.event('invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.billing_status, 'past_due');
  assert.equal(w.state.row.pro_until, later(GRACE_DAYS).toISOString());
  assert.equal(effectivePlan(w.state.row, later(6)), 'pro');
  assert.equal(billingView(w.state.row, later(6)).kind, 'payment_failed');
  // Stripe retries and fails again on day 3: the grace period doesn't restart.
  w.state.now = later(3);
  await processEvent(w.event('invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.pro_until, later(GRACE_DAYS).toISOString());
  // After the grace period: Free (nothing deleted; see limits), and the view says it lapsed.
  assert.equal(effectivePlan(w.state.row, later(GRACE_DAYS)), 'free');
  assert.deepEqual(billingView(w.state.row, later(8)), { kind: 'free', lapsed: true });
  // The card is updated and the invoice paid: Pro again.
  w.setSub(w.sub('active'));
  w.state.now = later(9);
  await processEvent(w.event('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(effectivePlan(w.state.row, later(9)), 'pro');
  assert.equal(w.state.row.pro_until, null);
});

test('failed payment: the grace period runs from when Stripe recorded the failure, not from a late delivery', async () => {
  const w = world({ plan: 'pro', billing_status: 'active' });
  w.setSub(w.sub('past_due'));
  const e = w.event('invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' });
  // Delivered (or retried) two days after the failure.
  w.state.now = later(2);
  await processEvent(e, w.deps);
  assert.equal(w.state.row.pro_until, later(GRACE_DAYS).toISOString());
});

test('failed payment: the grace period runs from the failed invoice, even when the event is stamped later (Stripe test clocks)', async () => {
  const w = world({ plan: 'pro', billing_status: 'trialing' });
  w.setSub(w.sub('past_due'));
  // The renewal invoice was created when the trial ended (day 14); the event is stamped today.
  await processEvent(w.event('invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1', created: s(later(14)) }), w.deps);
  assert.equal(w.state.row.pro_until, later(14 + GRACE_DAYS).toISOString());
});

test('failed payment: a past-due update without an invoice counts from the start of the billing period', async () => {
  const w = world({ plan: 'pro', billing_status: 'active' });
  w.setSub(w.sub('past_due', { items: { data: [{ current_period_start: s(later(30)), current_period_end: s(later(60)), price: { recurring: { interval: 'month' }, unit_amount: 499, currency: 'usd' } }] } }));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.pro_until, later(30 + GRACE_DAYS).toISOString());
});

test('failed payment: Stripe gives up and cancels: Free', async () => {
  const w = world({ plan: 'pro', billing_status: 'past_due', pro_until: later(7).toISOString() });
  w.setSub(w.sub('unpaid'));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.billing_status, 'ended');
});

test('cancel: Pro until the period ends, then Free', async () => {
  const w = world({ plan: 'pro', billing_status: 'active' });
  w.setSub(w.sub('active', { cancel_at_period_end: true }));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(effectivePlan(w.state.row, T0), 'pro');
  const v = billingView(w.state.row, T0);
  assert.equal(v.kind, 'cancelled');
  assert.equal(v.kind === 'cancelled' && v.endsAt, later(30).toISOString());
  w.setSub(w.sub('canceled'));
  w.state.now = later(30);
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.cancel_at_period_end, false);
  assert.deepEqual(billingView(w.state.row, later(30)), { kind: 'free', lapsed: true });
});

test('cancel from the portal on newer API versions (a cancel date, not the flag): still Pro until that date', async () => {
  const w = world({ plan: 'pro', billing_status: 'active' });
  w.setSub(w.sub('active', { cancel_at_period_end: false, cancel_at: s(later(30)) }));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  const v = billingView(w.state.row, T0);
  assert.equal(v.kind, 'cancelled');
  assert.equal(v.kind === 'cancelled' && v.endsAt, later(30).toISOString());
  // "Don't cancel" in the portal clears it.
  w.setSub(w.sub('active'));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(billingView(w.state.row, T0).kind, 'active');
});

test('cancel during the trial: Pro until the trial ends, then Free, never charged', async () => {
  const w = world();
  w.setSub(w.sub('trialing', { trial_end: s(later(14)), cancel_at_period_end: true }));
  await processEvent(w.event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  const v = billingView(w.state.row, T0);
  assert.equal(v.kind === 'trialing' && v.cancelled, true);
  w.setSub(w.sub('canceled', { trial_end: s(later(14)) }));
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.trial_used, true, 'and the trial stays used');
});

test('resubscribe after cancelling: Pro again, no second trial', async () => {
  const w = world({ plan: 'free', billing_status: 'ended', trial_used: true });
  assert.equal(trialAllowed(w.state.row, 'year'), false);
  w.setSub({ ...w.sub('active'), id: 'sub_2' });
  await processEvent(w.event('checkout.session.completed', { mode: 'subscription', subscription: 'sub_2', customer: 'cus_1', client_reference_id: 'user_1' }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  assert.equal(w.state.row.stripe_subscription_id, 'sub_2');
});

test('refund: a full refund ends Pro now and cancels the subscription; a partial refund changes nothing', async () => {
  const w = world({ plan: 'pro', billing_status: 'active', stripe_subscription_id: 'sub_1' });
  w.setSub(w.sub('active'));
  await processEvent(w.event('charge.refunded', { customer: 'cus_1', amount: 3999, amount_refunded: 1000 }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  await processEvent(w.event('charge.refunded', { customer: 'cus_1', amount: 3999, amount_refunded: 3999 }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.billing_status, 'refunded');
  assert.deepEqual(w.state.cancelled, ['sub_1']);
  // Stripe then sends the cancellation: still Free, still marked refunded.
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.billing_status, 'refunded');
});

test('founding families are never changed by Stripe', async () => {
  const w = world({ plan: 'pro', billing_status: 'founding', founding: true });
  w.setSub(w.sub('canceled'));
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  await processEvent(w.event('charge.refunded', { customer: 'cus_1', amount: 499, amount_refunded: 499 }), w.deps);
  assert.equal(effectivePlan(w.state.row, T0), 'pro');
  assert.equal(billingView(w.state.row, T0).kind, 'founding');
  assert.deepEqual(subscriptionPatch(w.sub('canceled'), w.state.row, T0), {});
});

test('checkout pending (incomplete) and paused are Free; unknown events are ignored', async () => {
  const w = world();
  w.setSub(w.sub('incomplete'));
  await processEvent(w.event('customer.subscription.created', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.equal(w.state.row.billing_status, 'incomplete');
  w.setSub(w.sub('paused'));
  await processEvent(w.event('customer.subscription.paused', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.billing_status, 'paused');
  assert.equal((await processEvent(w.event('customer.created', {}), w.deps)).status, 'ignored');
  assert.equal((await processEvent(w.event('checkout.session.completed', { mode: 'payment' }), w.deps)).status, 'ignored');
});

test('nobody is Pro by default, and the app reads Free for a missing row', () => {
  assert.equal(effectivePlan(null, T0), 'free');
  assert.equal(effectivePlan(FREE_ROW, T0), 'free');
  assert.deepEqual(billingView(null, T0), { kind: 'free', lapsed: false });
  assert.equal(trialAllowed(null, 'year'), true);
});

test('trial reminder email: the date, the price, a one-tap link to manage or cancel, in the app\'s voice', () => {
  const e = trialReminderEmail({ trialEnd: new Date('2026-12-15T12:00:00Z'), amount: 3999, currency: 'usd', interval: 'year' }, 'https://tryforka.com/app/?billing=manage');
  assert.equal(e.subject, 'Your Forka Pro trial ends on Tuesday, December 15');
  assert.match(e.text, /ends on Tuesday, December 15\. After that, Pro is \$39\.99 a year/);
  assert.match(e.text, /https:\/\/tryforka\.com\/app\/\?billing=manage/);
  assert.match(e.text, /Cancel before December 15 and you won't be charged\./);
  assert.match(e.html, /href="https:\/\/tryforka\.com\/app\/\?billing=manage"[^>]*>Manage or cancel Pro</);
  for (const s of [e.subject, e.text, e.html]) assert.ok(!/[\u2014\u2013]|\bAI\b|\p{Extended_Pictographic}/u.test(s));
  assert.equal(priceText(499, 'usd', 'month'), '$4.99 a month');
  // The family's own date: a trial that ends at 03:56 UTC on December 4 ends on December 3 in New York or Los Angeles.
  const late = { trialEnd: new Date('2026-12-04T03:56:00Z'), amount: 3999, currency: 'usd', interval: 'year' };
  assert.match(trialReminderEmail({ ...late, timeZone: 'America/Los_Angeles' }, 'x').subject, /Thursday, December 3$/);
  assert.match(trialReminderEmail({ ...late, timeZone: 'Europe/Rome' }, 'x').subject, /Friday, December 4$/);
  assert.match(trialReminderEmail({ ...late, timeZone: 'Not/AZone' }, 'x').subject, /Thursday, December 3$/, 'unknown zones fall back to US Eastern');
});

test('founding families: every account from before Pro, never the test account, Pro for life', async () => {
  const { FOUNDING_CUTOFF, FOUNDING_PATCH, isFoundingFamily } = await import('../supabase/functions/_shared/billing/state.ts');
  const before = new Date(new Date(FOUNDING_CUTOFF).getTime() - 1000).toISOString();
  const after = new Date(new Date(FOUNDING_CUTOFF).getTime() + 1000).toISOString();
  assert.equal(isFoundingFamily({ id: 'a', created_at: '2026-10-01T00:00:00Z' }), true);
  assert.equal(isFoundingFamily({ id: 'b', created_at: before }), true);
  assert.equal(isFoundingFamily({ id: 'c', created_at: after }), false, 'signed up after Pro launched');
  assert.equal(isFoundingFamily({ id: 'qa', created_at: '2026-11-19T10:00:00Z', app_metadata: { test_account: true } }), false, 'the QA account');
  const row = { ...FREE_ROW, ...FOUNDING_PATCH } as PlanRow;
  assert.equal(effectivePlan(row, new Date('2040-01-01')), 'pro', 'for life');
  assert.equal(billingView(row, T0).kind, 'founding');
  // Stripe never changes them, even a stray subscription or refund.
  assert.deepEqual(subscriptionPatch({ id: 'sub_x', status: 'canceled', customer: 'cus_x', cancel_at_period_end: false }, row, T0), {});
});

// ── One subscription at a time ─────────────────────────────────────────────

test('an earlier subscription that ended never overwrites the current one', async () => {
  const w = world({ plan: 'free', billing_status: 'ended', stripe_subscription_id: 'sub_1', trial_used: true });
  w.setSub(w.sub('canceled'));
  w.setSub({ ...w.sub('active'), id: 'sub_2' });
  await processEvent(w.event('checkout.session.completed', { mode: 'subscription', subscription: 'sub_2', customer: 'cus_1', client_reference_id: 'user_1' }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  // A late event about the old, cancelled subscription: ignored.
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  assert.equal(w.state.row.billing_status, 'active');
  assert.equal(w.state.row.stripe_subscription_id, 'sub_2');
  // The current subscription's own end still applies.
  w.setSub({ ...w.sub('canceled'), id: 'sub_2' });
  await processEvent(w.event('customer.subscription.deleted', { id: 'sub_2', customer: 'cus_1' }), w.deps);
  assert.equal(w.state.row.plan, 'free');
});

test('trial reminder: not sent when the trial was cancelled with a cancel date (newer API versions)', async () => {
  const w = world();
  w.setSub(w.sub('trialing', { trial_end: s(later(14)), cancel_at: s(later(14)) }));
  w.state.now = later(11);
  assert.equal((await processEvent(w.event('customer.subscription.trial_will_end', { id: 'sub_1' }), w.deps)).status, 'ignored');
  assert.equal(w.state.emails.length, 0);
});

test('refund: a refunded charge from an earlier subscription leaves the current one alone', async () => {
  const w = world({ plan: 'pro', billing_status: 'active', stripe_subscription_id: 'sub_2' });
  w.setSub({ ...w.sub('active'), id: 'sub_2' });
  w.deps.chargeSubscription = async charge => (charge.id === 'ch_old' ? 'sub_1' : 'sub_2');
  await processEvent(w.event('charge.refunded', { id: 'ch_old', customer: 'cus_1', amount: 499, amount_refunded: 499 }), w.deps);
  assert.equal(w.state.row.plan, 'pro');
  assert.deepEqual(w.state.cancelled, []);
  await processEvent(w.event('charge.refunded', { id: 'ch_new', customer: 'cus_1', amount: 3999, amount_refunded: 3999 }), w.deps);
  assert.equal(w.state.row.plan, 'free');
  assert.deepEqual(w.state.cancelled, ['sub_2']);
});
