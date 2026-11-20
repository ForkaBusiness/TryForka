// What the Stripe webhook does with each event. Pure apart from `deps` (Stripe, the
// database, email), so tests/billing.test.ts runs every path with fakes. The function in
// supabase/functions/stripe-webhook wires the real ones in.
//
// Idempotent: each event id is claimed once (stripe_events); a duplicate delivery does
// nothing. If handling fails the claim is released so Stripe's retry runs it again.
// Order-proof: subscription events never trust the event's copy; the subscription is read
// fresh from Stripe and the user's row is set from that.

import { customerId, FREE_ROW, refundPatch, subscriptionPatch, type PlanRow, type StripeSubscription } from './state.ts';

export interface StripeEvent { id: string; type: string; created: number; data: { object: Record<string, unknown> } }

export interface WebhookDeps {
  /** Records the event id; false if it was already there (a duplicate). */
  claim(eventId: string, type: string): Promise<boolean>;
  /** Forgets a claim after a failure, so a retry is processed. */
  release(eventId: string): Promise<void>;
  /** The user for a Stripe customer (or the user id Stripe carries in metadata). */
  findUser(ref: { customer?: string | null; userId?: string | null }): Promise<{ userId: string; row: PlanRow; email: string | null } | null>;
  /** Writes billing columns for a user (service role). */
  updatePlan(userId: string, patch: Partial<PlanRow>): Promise<void>;
  fetchSubscription(id: string): Promise<StripeSubscription>;
  cancelSubscription(id: string): Promise<void>;
  /** The "your trial ends on ..." email. */
  sendTrialReminder(to: string, details: { trialEnd: Date; amount: number; currency: string; interval: string; timeZone?: string | null }): Promise<void>;
  now(): Date;
  log?(message: string): void;
}

export type WebhookResult = { status: 'processed' | 'duplicate' | 'ignored'; detail?: string };

const str = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null);

/** The subscription an invoice belongs to (older and newer API shapes). */
function invoiceSubscription(invoice: Record<string, unknown>): string | null {
  const direct = str(invoice.subscription);
  if (direct) return direct;
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  return str(parent?.subscription_details?.subscription);
}

/**
 * `at` is when Stripe recorded the event: the grace period after a failed payment runs from
 * the failure itself, not from when the webhook happened to be delivered or retried.
 */
async function applySubscription(deps: WebhookDeps, subId: string, hint: { customer?: string | null; userId?: string | null }, at: Date, invoiceTime: Date | null = null): Promise<string> {
  const sub = await deps.fetchSubscription(subId);
  const user = await deps.findUser({ customer: hint.customer ?? customerId(sub.customer), userId: hint.userId ?? sub.metadata?.user_id ?? null });
  if (!user) return `no user for ${customerId(sub.customer)}`;
  // A payment fails when a billing period starts: the grace period runs from there (the
  // failed invoice's own time when the event is an invoice), whenever the event arrives.
  const periodStart = sub.items?.data?.[0]?.current_period_start ?? sub.current_period_start ?? null;
  const when = sub.status === 'past_due' && !invoiceTime && periodStart ? new Date(periodStart * 1000) : invoiceTime ?? at;
  const patch = subscriptionPatch(sub, user.row, when);
  if (Object.keys(patch).length) await deps.updatePlan(user.userId, patch);
  return `${user.userId}: ${sub.status}${sub.cancel_at_period_end ? ' (cancels at period end)' : ''}`;
}

async function handle(event: StripeEvent, deps: WebhookDeps): Promise<WebhookResult> {
  const obj = event.data.object;
  const at = event.created ? new Date(event.created * 1000) : deps.now();
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription') return { status: 'ignored', detail: 'not a subscription checkout' };
      const sub = str(obj.subscription);
      const customer = str(obj.customer);
      const userId = str(obj.client_reference_id);
      if (!sub) return { status: 'ignored', detail: 'no subscription' };
      return { status: 'processed', detail: await applySubscription(deps, sub, { customer, userId }, at) };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const id = str(obj.id);
      if (!id) return { status: 'ignored' };
      return { status: 'processed', detail: await applySubscription(deps, id, { customer: str(obj.customer), userId: (obj.metadata as Record<string, string> | undefined)?.user_id ?? null }, at) };
    }
    case 'customer.subscription.trial_will_end': {
      // Stripe sends this three days before a trial ends: the reminder, once per trial.
      const id = str(obj.id);
      if (!id) return { status: 'ignored' };
      const sub = await deps.fetchSubscription(id);
      const user = await deps.findUser({ customer: customerId(sub.customer), userId: sub.metadata?.user_id ?? null });
      if (!user || !sub.trial_end || sub.status !== 'trialing') return { status: 'ignored', detail: 'no trial to remind about' };
      const trialEnd = new Date(sub.trial_end * 1000).toISOString();
      if (user.row.trial_reminder_for === trialEnd) return { status: 'ignored', detail: 'reminder already sent' };
      if (sub.cancel_at_period_end) return { status: 'ignored', detail: 'trial already cancelled, nothing will be charged' };
      const price = sub.items?.data?.[0]?.price;
      if (!user.email) return { status: 'ignored', detail: 'no email address' };
      await deps.sendTrialReminder(user.email, {
        trialEnd: new Date(sub.trial_end * 1000), amount: price?.unit_amount ?? 0, currency: price?.currency ?? 'usd', interval: price?.recurring?.interval ?? 'year',
        timeZone: sub.metadata?.time_zone ?? null,
      });
      await deps.updatePlan(user.userId, { trial_reminder_for: trialEnd });
      return { status: 'processed', detail: `reminder sent to ${user.userId}` };
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const sub = invoiceSubscription(obj);
      const invoiceTime = typeof obj.created === 'number' ? new Date(obj.created * 1000) : null;
      if (!sub) return { status: 'ignored', detail: 'not a subscription invoice' };
      return { status: 'processed', detail: await applySubscription(deps, sub, { customer: str(obj.customer) }, at, invoiceTime) };
    }
    case 'charge.refunded': {
      // A full refund ends Pro now and cancels the subscription; a partial refund changes nothing.
      const amount = Number(obj.amount ?? 0);
      const refunded = Number(obj.amount_refunded ?? 0);
      if (!(amount > 0 && refunded >= amount)) return { status: 'ignored', detail: 'partial refund' };
      const user = await deps.findUser({ customer: str(obj.customer) });
      if (!user) return { status: 'ignored', detail: 'no user' };
      if (user.row.founding) return { status: 'ignored', detail: 'founding family' };
      if (user.row.stripe_subscription_id) {
        const sub = await deps.fetchSubscription(user.row.stripe_subscription_id);
        if (!['canceled', 'incomplete_expired'].includes(sub.status)) await deps.cancelSubscription(sub.id);
      }
      await deps.updatePlan(user.userId, refundPatch(user.row));
      return { status: 'processed', detail: `${user.userId}: refunded` };
    }
    default:
      return { status: 'ignored', detail: event.type };
  }
}

/** One delivery: claimed once, handled, released on failure so Stripe retries it. */
export async function processEvent(event: StripeEvent, deps: WebhookDeps): Promise<WebhookResult> {
  if (!(await deps.claim(event.id, event.type))) return { status: 'duplicate' };
  try {
    const result = await handle(event, deps);
    deps.log?.(`[stripe] ${event.type} ${event.id}: ${result.status}${result.detail ? ` (${result.detail})` : ''}`);
    return result;
  } catch (err) {
    await deps.release(event.id).catch(() => {});
    throw err;
  }
}

export { FREE_ROW };
