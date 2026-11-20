// What the Stripe webhook does with each event. Pure apart from `deps` (Stripe, the
// database, email), so tests/billing.test.ts runs every path with fakes. The function in
// supabase/functions/stripe-webhook wires the real ones in.
//
// Durable and idempotent: each event is stored (stripe_events, with its payload) before
// anything is done, then processed from that record under a short lock, and marked
// processed only once the plan is written. A duplicate of a processed event does nothing.
// If handling fails, or the function dies mid-event, the record stays unfinished: Stripe's
// retry, or the daily reconciliation (reconcile below), processes it again. Handling is
// safe to repeat: subscriptions are read fresh, the reminder is sent once per trial.
// Order-proof: subscription events never trust the event's copy; the subscription is read
// fresh from Stripe and the user's row is set from that.

import { customerId, FREE_ROW, LIVE, refundPatch, subscriptionPatch, type PlanRow, type StripeSubscription } from './state.ts';

export interface StripeEvent { id: string; type: string; created: number; data: { object: Record<string, unknown> } }

export interface WebhookDeps {
  /** Stores the event before anything is done: 'new', 'done' (already processed), or 'unfinished' (stored before, not processed yet). */
  record(event: StripeEvent): Promise<'new' | 'done' | 'unfinished'>;
  /** Takes the stored event for processing; false while another delivery holds a lock younger than LOCK_MINUTES. */
  lock(eventId: string): Promise<boolean>;
  /** Marks it processed. */
  finish(eventId: string): Promise<void>;
  /** Marks it failed, with the error, for a retry. */
  fail(eventId: string, error: string): Promise<void>;
  /** The user for a Stripe customer (or the user id Stripe carries in metadata). */
  findUser(ref: { customer?: string | null; userId?: string | null }): Promise<{ userId: string; row: PlanRow; email: string | null } | null>;
  /** Writes billing columns for a user (service role). */
  updatePlan(userId: string, patch: Partial<PlanRow>): Promise<void>;
  fetchSubscription(id: string): Promise<StripeSubscription>;
  cancelSubscription(id: string): Promise<void>;
  /** The subscription a charge paid for, when Stripe can say (via its invoice); null if unknown. */
  chargeSubscription?(charge: Record<string, unknown>): Promise<string | null>;
  /** The "your trial ends on ..." email. */
  sendTrialReminder(to: string, details: { trialEnd: Date; amount: number; currency: string; interval: string; timeZone?: string | null }): Promise<void>;
  now(): Date;
  log?(message: string): void;
}

export type WebhookResult = { status: 'processed' | 'duplicate' | 'ignored' | 'busy'; detail?: string };

/** A lock older than this belongs to a delivery that died: the event may be taken again. */
export const LOCK_MINUTES = 5;

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
  // An older subscription that has ended never overwrites the one the family has now.
  if (user.row.stripe_subscription_id && user.row.stripe_subscription_id !== sub.id && !LIVE.has(sub.status)) {
    return `${user.userId}: ignored ${sub.status} for an earlier subscription`;
  }
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
      // Newer API versions record a cancellation as cancel_at rather than cancel_at_period_end.
      if (sub.cancel_at_period_end || sub.cancel_at) return { status: 'ignored', detail: 'trial already cancelled, nothing will be charged' };
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
      // A refund for an earlier subscription's charge leaves the current one alone.
      const paidFor = deps.chargeSubscription ? await deps.chargeSubscription(obj) : null;
      if (paidFor && user.row.stripe_subscription_id && paidFor !== user.row.stripe_subscription_id) {
        return { status: 'ignored', detail: `refund for an earlier subscription (${paidFor})` };
      }
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

/** One delivery from Stripe: stored first, then processed (unless it already was). */
export async function processEvent(event: StripeEvent, deps: WebhookDeps): Promise<WebhookResult> {
  if ((await deps.record(event)) === 'done') return { status: 'duplicate' };
  return runEvent(event, deps);
}

/** Processes a stored event: locked, handled, then marked processed, or failed for a retry. */
export async function runEvent(event: StripeEvent, deps: WebhookDeps): Promise<WebhookResult> {
  if (!(await deps.lock(event.id))) return { status: 'busy', detail: 'another delivery is processing it' };
  try {
    const result = await handle(event, deps);
    await deps.finish(event.id);
    deps.log?.(`[stripe] ${event.type} ${event.id}: ${result.status}${result.detail ? ` (${result.detail})` : ''}`);
    return result;
  } catch (err) {
    await deps.fail(event.id, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

// ── The daily reconciliation ───────────────────────────────────────────────

export interface ReconcileDeps extends WebhookDeps {
  /** Stored events not processed yet whose last attempt is older than `minutes`. */
  unfinishedEvents(minutes: number): Promise<StripeEvent[]>;
  /** Every plan row with a Stripe subscription (founding families excluded). */
  subscribedRows(): Promise<Array<{ userId: string; row: PlanRow }>>;
  /**
   * Writes the patch only if the row still has this subscription: a webhook that changed it
   * since the reconciliation read it (a resubscribe, say) wins. False when it didn't write.
   */
  updatePlanIf?(userId: string, patch: Partial<PlanRow>, subscriptionId: string): Promise<boolean>;
}

/** Events older than this are left for a person to look at, not replayed (Stripe stops retrying after about 3 days too). */
export const REPLAY_DAYS = 3;
/** Subscriptions checked at once. */
const RECONCILE_CONCURRENCY = 8;

export interface ReconcileReport { checked: number; fixed: number; eventsRedone: number; details: Array<{ userId?: string; event?: string; fields?: string[]; error?: string }> }

const sameValue = (a: unknown, b: unknown) => {
  if (a === b || (a == null && b == null)) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a), tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && /\d{4}-\d{2}-\d{2}T/.test(a) && /\d{4}-\d{2}-\d{2}T/.test(b)) return ta === tb;
  }
  return false;
};

/** The fields a patch would actually change. */
export function changedFields(row: PlanRow, patch: Partial<PlanRow>): string[] {
  return Object.keys(patch).filter(k => !sameValue((row as unknown as Record<string, unknown>)[k], (patch as Record<string, unknown>)[k]));
}

/**
 * Finishes events left unfinished (a crash mid-event, a failure), then compares every
 * subscription with Stripe and writes only what differs. Safe to run any time.
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, fixed: 0, eventsRedone: 0, details: [] };
  for (const event of await deps.unfinishedEvents(LOCK_MINUTES * 2)) {
    try {
      const r = await runEvent(event, deps);
      if (r.status !== 'busy') { report.eventsRedone++; report.details.push({ event: `${event.type} ${event.id}: ${r.status}` }); }
    } catch (err) {
      report.details.push({ event: event.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const check = async (userId: string, snapshot: PlanRow) => {
    try {
      // Read again just before checking: a webhook may have changed it since the list was read.
      const fresh = (await deps.findUser({ userId }))?.row ?? snapshot;
      const subId = fresh.stripe_subscription_id;
      if (!subId || fresh.founding) return;
      report.checked++;
      let fields: string[] = [];
      // Writes only what differs, and only if the subscription is still the one checked; the
      // same rules as the webhook (grace kept, older subscriptions ignored).
      const writeIfChanged: WebhookDeps['updatePlan'] = async (id, patch) => {
        fields = changedFields(fresh, patch);
        if (!fields.length) return;
        const diff = Object.fromEntries(fields.map(f => [f, (patch as Record<string, unknown>)[f]])) as Partial<PlanRow>;
        if (deps.updatePlanIf) { if (!(await deps.updatePlanIf(id, diff, subId))) fields = []; }
        else await deps.updatePlan(id, diff);
      };
      await applySubscription({ ...deps, updatePlan: writeIfChanged, findUser: async () => ({ userId, row: fresh, email: null }) }, subId, { customer: fresh.stripe_customer_id, userId }, deps.now());
      if (fields.length) { report.fixed++; report.details.push({ userId, fields }); }
    } catch (err) {
      report.details.push({ userId, error: err instanceof Error ? err.message : String(err) });
    }
  };
  const rows = (await deps.subscribedRows()).filter(r => r.row.stripe_subscription_id && !r.row.founding);
  for (let i = 0; i < rows.length; i += RECONCILE_CONCURRENCY) {
    await Promise.all(rows.slice(i, i + RECONCILE_CONCURRENCY).map(r => check(r.userId, r.row)));
  }
  return report;
}

export { FREE_ROW };
