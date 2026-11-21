import { AppError, claimRequest, serve, serviceClient, userClient } from '../_shared/http.ts';
import { effectivePlan, FREE_ROW, LIVE, refundableCharge, trialAllowed, type RefundableCharge, TRIAL_DAYS, type Interval, type PlanRow } from '../_shared/billing/state.ts';
import { PRICE_LOOKUP, stripe } from '../_shared/billing/stripe.ts';
import { REFUND_DAYS } from '../_shared/billing/email.ts';

// Starting and managing Forka Pro, for the signed-in user.
//   { mode: "checkout", interval: "month" | "year" } -> { url }   Stripe Checkout
//   { mode: "portal" }                               -> { url }   Stripe Customer Portal
// This function never grants Pro. It creates the Stripe customer (and records its id) and
// opens Stripe's pages; only the stripe-webhook function changes a plan, when Stripe says
// so. The 14-day trial is offered on yearly only, once per account (user_plans.trial_used,
// and no earlier subscription on the customer in Stripe).
// Secrets: STRIPE_SECRET_KEY, APP_URL (default https://tryforka.com/app/).

const RATE_LIMIT = { kind: 'billing', perMinute: 10, perDay: 60, noun: 'billing requests' };
const DEFAULT_APP = Deno.env.get('APP_URL') || 'https://tryforka.com/app/';
const COLUMNS = 'user_id, plan, billing_status, billing_interval, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, cancel_at_period_end, pro_until, trial_used, founding, trial_reminder_for';

/** Where Stripe sends the household back: the app they came from, if it's ours. */
function appUrl(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  const ours = /^https:\/\/(www\.)?tryforka\.com$/.test(origin)
    || /^https:\/\/try-forka-[a-z0-9-]+-forkabusiness-2455s-projects\.vercel\.app$/.test(origin)
    || /^http:\/\/localhost:\d+$/.test(origin);
  return ours ? `${origin}/app/` : DEFAULT_APP;
}

/** The auto-renewal terms, stated where the family agrees to pay. */
function renewalNotice(interval: Interval, trial: boolean): string {
  const price = interval === 'year' ? '$39.99 a year' : '$4.99 a month';
  const cancel = 'Cancel any time in Forka, under Settings > Manage plan. Full refund within 14 days of any payment, no questions asked.';
  return trial
    ? `Free for 14 days, then ${price}, renewing automatically every year until you cancel. Cancel before the trial ends and you pay nothing. ${cancel}`
    : `${price}, renewing automatically every ${interval} until you cancel. ${cancel}`;
}

serve(async (body, req) => {
  const db = userClient(req);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new AppError('Sign in again to continue.', 401);
  const user = auth.user;
  await claimRequest(db, RATE_LIMIT);

  const admin = serviceClient();
  const { data } = await admin.from('user_plans').select(COLUMNS).eq('user_id', user.id).maybeSingle();
  const row = { ...FREE_ROW, ...(data ?? {}) } as PlanRow;
  const base = appUrl(req);

  if (body.mode === 'portal') {
    if (!row.stripe_customer_id) throw new AppError("There's no subscription to manage yet.", 404);
    // Forka's portal settings (scripts/stripe-setup.mjs tags them), in sandbox and live alike.
    const configs = await stripe<{ data: Array<{ id: string; metadata?: Record<string, string> }> }>('GET', '/billing_portal/configurations', { active: true, limit: 100 });
    const configuration = configs.data.find(c => c.metadata?.forka === 'pro')?.id;
    const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${base}?billing=returned`, ...(configuration ? { configuration } : {}) });
    return { url: session.url };
  }

  // A full refund of a payment from the last 14 days, no questions asked. The webhook
  // (charge.refunded) then ends Pro and cancels the subscription, as for any refund.
  if (body.mode === 'refund') {
    if (row.founding) return { status: 'none', message: "You're a founding family: nothing has been charged." };
    if (!row.stripe_customer_id) return { status: 'none', message: "There's no payment to refund." };
    const charges = await stripe<{ data: RefundableCharge[] }>('GET', '/charges', { customer: row.stripe_customer_id, limit: 20 });
    const charge = refundableCharge(charges.data, new Date(), REFUND_DAYS);
    if (!charge) {
      const paid = charges.data.filter(c => c.status === 'succeeded');
      const open = paid.some(c => !c.refunded && c.amount_refunded < c.amount);
      return {
        status: 'none',
        message: open
          ? `Your last payment was more than ${REFUND_DAYS} days ago, so it can't be refunded here. You can still cancel any time in Manage plan.`
          : paid.length
            ? 'Your payment has already been refunded. It reaches your card in 5 to 10 days.'
            : "There's no payment to refund. A free trial isn't charged: cancel before it ends and you pay nothing.",
      };
    }
    await stripe('POST', '/refunds', { charge: charge.id, reason: 'requested_by_customer', metadata: { user_id: user.id, forka: 'no_questions_14_days' } }, `refund-${charge.id}`);
    console.log(`[billing] refund of ${charge.amount} ${charge.currency}`);
    return { status: 'refunded', amount: charge.amount, currency: charge.currency };
  }

  if (body.mode !== 'checkout') throw new AppError('Unknown request.', 400);
  // The billing switch: no checkout before launch (the account's billing preview aside).
  const { data: billingOn, error: switchError } = await db.rpc('billing_on');
  if (switchError || billingOn !== true) throw new AppError("Forka Pro isn't available yet.", 403);
  const interval: Interval = body.interval === 'year' ? 'year' : body.interval === 'month' ? 'month' : (() => { throw new AppError('Choose monthly or yearly.', 400); })();
  if (row.founding) throw new AppError("You're a founding family: Pro is yours for life.", 409);
  if (effectivePlan(row, new Date()) === 'pro') throw new AppError('You already have Pro. Manage it from Settings.', 409);

  // One Stripe customer per account, created once (the id is recorded; the plan isn't touched).
  let customer = row.stripe_customer_id;
  if (!customer) {
    const created = await stripe<{ id: string }>('POST', '/customers', { email: user.email, metadata: { user_id: user.id } }, `customer-${user.id}`);
    customer = created.id;
    const { error } = await admin.from('user_plans').upsert({ user_id: user.id, stripe_customer_id: customer }, { onConflict: 'user_id' });
    if (error) throw new AppError("Couldn't start checkout. Try again.", 502);
  }

  const timeZone = typeof body.time_zone === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(body.time_zone) ? body.time_zone.slice(0, 64) : null;
  const prices = await stripe<{ data: Array<{ id: string }> }>('GET', '/prices', { lookup_keys: [PRICE_LOOKUP[interval]], active: true, limit: 1 });
  const price = prices.data[0]?.id;
  if (!price) throw new AppError('Pro is not set up yet.', 503);

  // One subscription per family: one that's still live (a payment being retried, say) is
  // fixed in the portal, never replaced by a second one that would bill twice.
  const existing = await stripe<{ data: Array<{ status: string }> }>('GET', '/subscriptions', { customer, status: 'all', limit: 20 });
  if (existing.data.some(s => LIVE.has(s.status))) {
    throw new AppError('Your subscription is still open. Update your payment method from Settings to keep Pro.', 409);
  }
  // The trial: yearly, never used, and no earlier subscription on this customer in Stripe.
  const trial = trialAllowed(row, interval) && existing.data.length === 0;

  const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    payment_method_collection: 'always',
    // Cards only (Apple Pay and Google Pay are cards too): one clear way to pay for a subscription.
    payment_method_types: ['card'],
    subscription_data: {
      // The family's time zone, so emails name their dates (the trial ends on their calendar day).
      metadata: { user_id: user.id, ...(timeZone ? { time_zone: timeZone } : {}) },
      ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
    },
    metadata: { user_id: user.id },
    // Shown above Stripe's pay button: the renewal terms and how to cancel, right where the family agrees.
    custom_text: { submit: { message: renewalNotice(interval, trial) } },
    success_url: `${base}?checkout=success`,
    cancel_url: `${base}?checkout=cancelled`,
  });
  console.log(`[billing] checkout ${interval}${trial ? ' with trial' : ''}`);
  return { url: session.url, trial };
});
