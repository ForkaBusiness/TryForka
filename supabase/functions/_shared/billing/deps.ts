import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.103.3';
import { FREE_ROW, type PlanRow, type StripeSubscription } from './state.ts';
import { LOCK_MINUTES, REPLAY_DAYS, type ReconcileDeps, type StripeEvent } from './webhook.ts';
import { stripe, stripeMode } from './stripe.ts';
import { sendEmail, trialReminderEmail } from './email.ts';

// The real dependencies of the webhook and the daily reconciliation: the database (service
// role), Stripe, and email. The logic that uses them is in webhook.ts (tested with fakes).

const COLUMNS = 'user_id, plan, billing_status, billing_interval, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, cancel_at_period_end, pro_until, trial_used, founding, trial_reminder_for';

export function billingDeps(admin: SupabaseClient, appUrl: string): ReconcileDeps {
  const rowFor = async (userId: string): Promise<PlanRow> => {
    const { data } = await admin.from('user_plans').select(COLUMNS).eq('user_id', userId).maybeSingle();
    return { ...FREE_ROW, ...(data ?? {}) } as PlanRow;
  };
  return {
    record: async (event: StripeEvent) => {
      const { error } = await admin.from('stripe_events').insert({ id: event.id, type: event.type, payload: event, status: 'received' });
      if (!error) return 'new';
      if (error.code !== '23505') throw new Error(`event not stored: ${error.message}`);
      const { data } = await admin.from('stripe_events').select('status').eq('id', event.id).maybeSingle();
      // Stored before this change without a payload: keep it now, so it can be redone.
      if (data?.status !== 'processed') await admin.from('stripe_events').update({ payload: event }).eq('id', event.id).is('payload', null);
      return data?.status === 'processed' ? 'done' : 'unfinished';
    },
    lock: async id => {
      const stale = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
      const { data: current } = await admin.from('stripe_events').select('attempts').eq('id', id).maybeSingle();
      const { data, error } = await admin.from('stripe_events')
        .update({ status: 'processing', locked_at: new Date().toISOString(), attempts: Number(current?.attempts ?? 0) + 1 })
        .eq('id', id)
        .or(`status.in.(received,failed),and(status.eq.processing,locked_at.lt.${stale})`)
        .select('id');
      if (error) throw new Error(`event not locked: ${error.message}`);
      return (data ?? []).length === 1;
    },
    finish: async id => {
      // Processed: the payload (which can hold a name, email or address) is no longer needed.
      const { error } = await admin.from('stripe_events').update({ status: 'processed', processed_at: new Date().toISOString(), last_error: null, payload: null }).eq('id', id);
      if (error) throw new Error(`event not marked processed: ${error.message}`);
    },
    fail: async (id, message) => {
      await admin.from('stripe_events').update({ status: 'failed', last_error: message.slice(0, 500) }).eq('id', id);
    },
    findUser: async ({ customer, userId }) => {
      let id: string | null = null;
      if (customer) {
        const { data } = await admin.from('user_plans').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
        id = (data?.user_id as string | undefined) ?? null;
      }
      id ??= userId ?? null;
      if (!id) return null;
      const { data: user } = await admin.auth.admin.getUserById(id);
      if (!user?.user) return null;
      return { userId: id, row: await rowFor(id), email: user.user.email ?? null };
    },
    updatePlan: async (userId, patch) => {
      const { error } = await admin.from('user_plans').upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw new Error(`plan update failed: ${error.message}`);
    },
    fetchSubscription: id => stripe<StripeSubscription>('GET', `/subscriptions/${id}`),
    cancelSubscription: async id => { await stripe('DELETE', `/subscriptions/${id}`, {}, `refund-cancel-${id}`); },
    // Older API versions put the invoice on the charge; newer ones link them through invoice payments.
    chargeSubscription: async charge => {
      const sid = (inv: Record<string, unknown> | null | undefined) => {
        if (!inv) return null;
        const direct = inv.subscription;
        if (typeof direct === 'string') return direct;
        const parent = inv.parent as { subscription_details?: { subscription?: unknown } } | undefined;
        const nested = parent?.subscription_details?.subscription;
        return typeof nested === 'string' ? nested : null;
      };
      try {
        if (typeof charge.invoice === 'string') return sid(await stripe<Record<string, unknown>>('GET', `/invoices/${charge.invoice}`));
        if (typeof charge.payment_intent === 'string') {
          const found = await stripe<{ data: Array<{ invoice?: unknown }> }>('GET', '/invoice_payments', { 'payment[type]': 'payment_intent', 'payment[payment_intent]': charge.payment_intent, limit: 1, 'expand[]': 'data.invoice' });
          const inv = found.data[0]?.invoice;
          return typeof inv === 'object' ? sid(inv as Record<string, unknown>) : typeof inv === 'string' ? sid(await stripe<Record<string, unknown>>('GET', `/invoices/${inv}`)) : null;
        }
      } catch (err) {
        console.error('[stripe] could not link the refunded charge to a subscription:', err);
      }
      return null;
    },
    sendTrialReminder: async (to, details) => {
      const testTo = stripeMode() === 'test' ? Deno.env.get('EMAIL_TEST_TO') : undefined;
      await sendEmail(testTo || to, trialReminderEmail(details, `${appUrl}?billing=manage`));
      console.log(`[stripe] trial reminder sent${testTo ? ' to the sandbox test inbox' : ''}`);
    },
    unfinishedEvents: async minutes => {
      const before = new Date(Date.now() - minutes * 60_000).toISOString();
      // Older than REPLAY_DAYS: left as they are (failed, with the error) for a person to look at.
      const since = new Date(Date.now() - REPLAY_DAYS * 86_400_000).toISOString();
      const { data, error } = await admin.from('stripe_events').select('payload')
        .neq('status', 'processed').not('payload', 'is', null)
        .or(`locked_at.is.null,locked_at.lt.${before}`).lt('received_at', before).gt('received_at', since)
        .order('received_at').limit(200);
      if (error) throw new Error(`unfinished events not read: ${error.message}`);
      return (data ?? []).map(r => r.payload as StripeEvent);
    },
    subscribedRows: async () => {
      const { data, error } = await admin.from('user_plans').select(COLUMNS).not('stripe_subscription_id', 'is', null).eq('founding', false);
      if (error) throw new Error(`plans not read: ${error.message}`);
      return (data ?? []).map(r => ({ userId: r.user_id as string, row: { ...FREE_ROW, ...r } as PlanRow }));
    },
    updatePlanIf: async (userId, patch, subscriptionId) => {
      const { data, error } = await admin.from('user_plans').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('stripe_subscription_id', subscriptionId).select('user_id');
      if (error) throw new Error(`plan update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
    now: () => new Date(),
    log: m => console.log(m),
  };
}
