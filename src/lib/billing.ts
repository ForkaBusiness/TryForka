import { supabase } from './supabase';
import { callFunction } from './plan';
import { billingView, effectivePlan, FREE_ROW, type BillingView, type Interval, type Plan, type PlanRow } from '../../supabase/functions/_shared/billing/state.ts';

// Forka Pro in the app: reading the plan (user_plans, read-only here), and opening Stripe's
// Checkout and Customer Portal through the billing function. The app never grants Pro: it
// shows what the stripe-webhook function wrote.

export { billingView, effectivePlan, type BillingView, type Interval, type Plan, type PlanRow };

export const PRICES: Record<Interval, { amount: string; per: string; note: string }> = {
  month: { amount: '$4.99', per: 'a month', note: 'Cancel any time.' },
  year: { amount: '$39.99', per: 'a year', note: '14 days free, then $39.99 a year. About $3.33 a month.' },
};

const COLUMNS = 'plan, billing_status, billing_interval, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, cancel_at_period_end, pro_until, trial_used, founding, trial_reminder_for';

/** The household's plan row; Free when there's none (or the database doesn't have billing yet). */
export async function fetchPlanRow(userId: string): Promise<PlanRow> {
  const { data, error } = await supabase.from('user_plans').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) {
    // A database without the billing columns yet: everyone is Free, as before.
    if (error.code === '42703' || error.code === 'PGRST204') return FREE_ROW;
    throw new Error(error.message);
  }
  return { ...FREE_ROW, ...(data ?? {}) } as PlanRow;
}

/** Reads the plan, trying again a few times (a connection blip or a token refresh can fail the first read). */
export async function loadPlanRow(userId: string, tries = 3): Promise<PlanRow> {
  for (let i = 1; ; i++) {
    try { return await fetchPlanRow(userId); } catch (err) {
      if (i >= tries) throw err;
      await new Promise(r => setTimeout(r, 1200 * i));
    }
  }
}

/** Opens Stripe Checkout for a plan (leaves the app). */
export async function startCheckout(interval: Interval): Promise<void> {
  const time_zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
  const { url } = await callFunction<{ url: string }>('billing', { mode: 'checkout', interval, time_zone });
  window.location.assign(url);
}

/** Opens Stripe's page to change plan, update the card or cancel (leaves the app). */
export async function openPortal(): Promise<void> {
  const { url } = await callFunction<{ url: string }>('billing', { mode: 'portal' });
  window.location.assign(url);
}

/** What Stripe's return to the app says: `?checkout=success`, `?checkout=cancelled`, `?billing=manage`, `?billing=returned`. Read once, then cleared from the address bar. */
export type BillingReturn = 'checkout_success' | 'checkout_cancelled' | 'manage' | 'portal_returned' | null;
export function readBillingReturn(): BillingReturn {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  const billing = params.get('billing');
  const ret: BillingReturn = checkout === 'success' ? 'checkout_success' : checkout === 'cancelled' ? 'checkout_cancelled'
    : billing === 'manage' ? 'manage' : billing === 'returned' ? 'portal_returned' : null;
  if (ret) {
    params.delete('checkout');
    params.delete('billing');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }
  return ret;
}

const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '');

/** One calm line about the plan, for Settings. */
export function planLine(v: BillingView): { title: string; detail: string } {
  switch (v.kind) {
    case 'founding': return { title: 'Founding family', detail: 'Pro is yours for life. Thank you for being here early.' };
    case 'free': return v.lapsed
      ? { title: 'Free', detail: 'Your Pro plan has ended. Everything you saved is still here.' }
      : { title: 'Free', detail: 'Dinners planned around your family, groceries, nutrition and cooking mode.' };
    case 'trialing': return v.cancelled
      ? { title: 'Pro trial', detail: `Your trial ends on ${dateFmt(v.endsAt)}. You won't be charged.` }
      : { title: v.ending ? 'Pro trial, ending soon' : 'Pro trial', detail: `Free until ${dateFmt(v.endsAt)}, then $39.99 a year. Cancel before then and you won't be charged.` };
    case 'active': return { title: 'Pro', detail: v.renewsAt ? `Renews on ${dateFmt(v.renewsAt)} at ${v.interval === 'month' ? '$4.99 a month' : '$39.99 a year'}.` : 'Thank you for supporting Forka.' };
    case 'cancelled': return { title: 'Pro, cancelled', detail: `Pro until ${dateFmt(v.endsAt)}. You won't be charged again.` };
    case 'payment_failed': return { title: 'Payment didn\'t go through', detail: `Update your card by ${dateFmt(v.graceUntil)} to keep Pro.` };
  }
}
