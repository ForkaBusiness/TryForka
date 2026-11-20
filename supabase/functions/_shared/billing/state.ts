// Forka Pro billing state. Pure TypeScript (Deno, Vite, Node): the Stripe webhook writes
// plans with it, the app reads them with it, and tests/billing.test.ts covers every
// transition. No imports, no clock of its own: every function takes `now`.
//
// Who can change a plan: only the stripe-webhook function (service role). The app and the
// other functions only read user_plans. A plan is Pro when the webhook said so and any
// grace period hasn't run out; founding families are Pro for life and never touched.

export type Plan = 'free' | 'pro';
/** Where the subscription stands, as the app explains it. */
export type BillingStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'incomplete' | 'paused' | 'ended' | 'refunded' | 'founding';
export type Interval = 'month' | 'year';

/** The billing columns of user_plans. Times are ISO strings. */
export interface PlanRow {
  plan: Plan;
  billing_status: BillingStatus;
  billing_interval: Interval | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  /** App only: whether billing applies to this account (the billing switch). Not a column. */
  billing_on?: boolean;
  /** Past due: Pro until here, then Free. */
  pro_until: string | null;
  /** One trial per account, ever. */
  trial_used: boolean;
  founding: boolean;
  /** The trial_end the "trial ends soon" email was sent for (sent once per trial). */
  trial_reminder_for: string | null;
}

export const FREE_ROW: PlanRow = {
  plan: 'free', billing_status: 'none', billing_interval: null, stripe_customer_id: null, stripe_subscription_id: null,
  current_period_end: null, trial_end: null, cancel_at_period_end: false, pro_until: null, trial_used: false, founding: false,
  trial_reminder_for: null,
};

/** After a payment fails, Pro stays this long while Stripe retries the card. */
/** Statuses of a subscription that still counts (or may still be charged). */
export const LIVE: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

export const GRACE_DAYS = 7;
export const TRIAL_DAYS = 14;
/** The trial counts as "ending" (and the reminder goes out) this close to its end. */
export const TRIAL_ENDING_DAYS = 3;
const DAY = 86_400_000;

// ── Stripe's subscription, the parts we read ───────────────────────────────

export interface StripeSubscription {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused';
  customer: string | { id: string };
  cancel_at_period_end: boolean;
  /** Seconds. Newer API versions record a cancellation (from the portal) as a date here instead of cancel_at_period_end. */
  cancel_at?: number | null;
  /** Seconds. Older API versions put it here; newer ones on each item. */
  current_period_end?: number | null;
  current_period_start?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data: Array<{ current_period_start?: number | null; current_period_end?: number | null; price?: { recurring?: { interval?: string } | null; unit_amount?: number | null; currency?: string } | null }> };
}

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
export const customerId = (c: StripeSubscription['customer']) => (typeof c === 'string' ? c : c.id);

function periodEnd(sub: StripeSubscription): string | null {
  return iso(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null);
}

function interval(sub: StripeSubscription): Interval | null {
  const i = sub.items?.data?.[0]?.price?.recurring?.interval;
  return i === 'month' || i === 'year' ? i : null;
}

/**
 * The plan a subscription means, as a patch for the user's row. Founding families are
 * never changed. Trialing and active are Pro. Past due stays Pro for GRACE_DAYS from the
 * first failure, then reads as Free (see effectivePlan) until the card works or Stripe
 * gives up and cancels. Canceled, unpaid and expired are Free. Cancelling at period end
 * stays Pro until the period ends (Stripe then sends the cancellation).
 */
export function subscriptionPatch(sub: StripeSubscription, prev: PlanRow, now: Date): Partial<PlanRow> {
  if (prev.founding) return {};
  // Cancelling shows either way Stripe records it: the flag, or a cancel date (then Pro lasts until that date).
  const cancelling = !!sub.cancel_at_period_end || !!sub.cancel_at;
  const base: Partial<PlanRow> = {
    stripe_customer_id: customerId(sub.customer),
    stripe_subscription_id: sub.id,
    billing_interval: interval(sub),
    current_period_end: sub.cancel_at ? iso(sub.cancel_at) : periodEnd(sub),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: cancelling,
  };
  switch (sub.status) {
    case 'trialing':
      return { ...base, plan: 'pro', billing_status: 'trialing', trial_used: true, pro_until: null };
    case 'active':
      // A subscription that started with a trial has used it, even if the event saying so was missed.
      return { ...base, plan: 'pro', billing_status: 'active', pro_until: null, ...(sub.trial_end ? { trial_used: true } : {}) };
    case 'past_due': {
      const graceEnd = prev.billing_status === 'past_due' && prev.pro_until ? prev.pro_until : new Date(now.getTime() + GRACE_DAYS * DAY).toISOString();
      return { ...base, plan: 'pro', billing_status: 'past_due', pro_until: graceEnd, ...(sub.trial_end ? { trial_used: true } : {}) };
    }
    case 'incomplete':
      return { ...base, plan: 'free', billing_status: 'incomplete', pro_until: null };
    case 'paused':
      return { ...base, plan: 'free', billing_status: 'paused', pro_until: null };
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
    default:
      // A refund cancels the subscription; the cancellation that follows keeps saying "refunded".
      return { ...base, plan: 'free', billing_status: prev.billing_status === 'refunded' && prev.stripe_subscription_id === sub.id ? 'refunded' : 'ended', pro_until: null, cancel_at_period_end: false, ...(sub.trial_end ? { trial_used: true } : {}) };
  }
}

/** A full refund ends Pro straight away (the subscription is cancelled too). */
export function refundPatch(prev: PlanRow): Partial<PlanRow> {
  if (prev.founding) return {};
  return { plan: 'free', billing_status: 'refunded', pro_until: null, cancel_at_period_end: false };
}

/** The plan the app and the functions honor. */
export function effectivePlan(row: Pick<PlanRow, 'plan' | 'founding' | 'pro_until'> | null | undefined, now: Date): Plan {
  if (!row) return 'free';
  if (row.founding) return 'pro';
  if (row.plan !== 'pro') return 'free';
  return row.pro_until && new Date(row.pro_until).getTime() <= now.getTime() ? 'free' : 'pro';
}

/** What the app shows about the plan. */
export type BillingView =
  | { kind: 'founding' }
  /** owed: past the grace period while Stripe still retries the card (fixed in the portal, not a new checkout). */
  | { kind: 'free'; lapsed: boolean; owed?: boolean }
  | { kind: 'trialing'; endsAt: string; ending: boolean; cancelled: boolean; interval: Interval | null }
  | { kind: 'active'; renewsAt: string | null; interval: Interval | null }
  | { kind: 'cancelled'; endsAt: string | null; interval: Interval | null }
  | { kind: 'payment_failed'; graceUntil: string; interval: Interval | null };

/**
 * The plan the app gives the family: while billing is off (before launch, the billing
 * switch), everyone has every feature and nothing is limited, as before Pro existed.
 */
export const appPlan = (row: PlanRow | null | undefined, now: Date): Plan => (row?.billing_on ? effectivePlan(row, now) : 'pro');

export function billingView(row: PlanRow | null | undefined, now: Date): BillingView {
  if (!row) return { kind: 'free', lapsed: false };
  if (row.founding) return { kind: 'founding' };
  if (effectivePlan(row, now) === 'free') {
    return { kind: 'free', lapsed: ['ended', 'refunded', 'past_due'].includes(row.billing_status), owed: row.billing_status === 'past_due' };
  }
  if (row.billing_status === 'trialing' && row.trial_end) {
    const ending = new Date(row.trial_end).getTime() - now.getTime() <= TRIAL_ENDING_DAYS * DAY;
    return { kind: 'trialing', endsAt: row.trial_end, ending, cancelled: row.cancel_at_period_end, interval: row.billing_interval };
  }
  if (row.billing_status === 'past_due' && row.pro_until) return { kind: 'payment_failed', graceUntil: row.pro_until, interval: row.billing_interval };
  if (row.cancel_at_period_end) return { kind: 'cancelled', endsAt: row.current_period_end, interval: row.billing_interval };
  return { kind: 'active', renewsAt: row.current_period_end, interval: row.billing_interval };
}

/** Whether a new checkout may include the 14-day trial: yearly only, once per account. */
export const trialAllowed = (row: Pick<PlanRow, 'trial_used'> | null | undefined, chosen: Interval) => chosen === 'year' && !row?.trial_used;

// ── Webhook signatures ─────────────────────────────────────────────────────

/** Stripe's default tolerance for a signature's timestamp. */
export const SIGNATURE_TOLERANCE_S = 300;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

/** A Stripe-Signature header for `payload`, as Stripe would sign it (tests and local checks). */
export async function signPayload(payload: string, secret: string, timestamp: number): Promise<string> {
  return `t=${timestamp},v1=${await hmac(secret, `${timestamp}.${payload}`)}`;
}

/**
 * Checks a Stripe-Signature header against the raw body: HMAC-SHA256 of "t.body" with the
 * endpoint's secret, any of the v1 signatures may match, and the timestamp must be within
 * the tolerance (replays of old events are refused).
 */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds: number, toleranceS = SIGNATURE_TOLERANCE_S): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(nowSeconds - t) > toleranceS) return false;
  const expected = await hmac(secret, `${t}.${payload}`);
  return signatures.some(s => same(s, expected));
}

// ── Founding families ──────────────────────────────────────────────────────

/** Accounts created before this moment, when Forka Pro launched, are founding families. */
export const FOUNDING_CUTOFF = '2026-11-19T18:00:00Z';

export interface AccountForFounding { id: string; created_at: string; app_metadata?: { test_account?: boolean } | null }

/**
 * Who becomes a founding family: every account that existed before Pro, except test
 * accounts. The same rule as migration 20261123000000_founding_families.
 */
export function isFoundingFamily(user: AccountForFounding, cutoff = FOUNDING_CUTOFF): boolean {
  if (user.app_metadata?.test_account === true) return false;
  return new Date(user.created_at).getTime() < new Date(cutoff).getTime();
}

/** A founding family's row: Pro for life, never touched by Stripe. */
export const FOUNDING_PATCH: Partial<PlanRow> = { plan: 'pro', billing_status: 'founding', founding: true, pro_until: null };
