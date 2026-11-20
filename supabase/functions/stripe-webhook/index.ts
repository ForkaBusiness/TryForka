import { serviceClient } from '../_shared/http.ts';
import { FREE_ROW, verifyStripeSignature, type PlanRow, type StripeSubscription } from '../_shared/billing/state.ts';
import { processEvent, type StripeEvent, type WebhookDeps } from '../_shared/billing/webhook.ts';
import { stripe, stripeMode } from '../_shared/billing/stripe.ts';
import { sendEmail, trialReminderEmail } from '../_shared/billing/email.ts';

// Stripe's webhook: the only thing that ever changes a user's plan. Deployed with
// --no-verify-jwt (Stripe sends no Supabase JWT); every request must carry a valid
// Stripe-Signature for STRIPE_WEBHOOK_SECRET instead, or it is refused. Each event is
// handled once (stripe_events), from the subscription as Stripe has it now
// (_shared/billing/webhook.ts). Logs say what happened, never card or personal details.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, EMAIL_FROM, APP_URL.
// In the Stripe sandbox only, EMAIL_TEST_TO (e.g. Resend's delivered@resend.dev) receives
// the reminders instead of the customer; with a live key it is ignored.

const APP_URL = Deno.env.get('APP_URL') || 'https://tryforka.com/app/';
const COLUMNS = 'user_id, plan, billing_status, billing_interval, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, cancel_at_period_end, pro_until, trial_used, founding, trial_reminder_for';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const payload = await req.text();
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret, Math.floor(Date.now() / 1000)))) {
    console.warn('[stripe] refused: bad or missing signature');
    return reply(400, { error: 'Invalid signature' });
  }
  let event: StripeEvent;
  try { event = JSON.parse(payload); } catch { return reply(400, { error: 'Invalid payload' }); }

  const admin = serviceClient();
  const rowFor = async (userId: string): Promise<PlanRow> => {
    const { data } = await admin.from('user_plans').select(COLUMNS).eq('user_id', userId).maybeSingle();
    return { ...FREE_ROW, ...(data ?? {}) } as PlanRow;
  };
  const deps: WebhookDeps = {
    claim: async (id, type) => {
      const { error } = await admin.from('stripe_events').insert({ id, type });
      if (!error) return true;
      if (error.code === '23505') return false;
      throw new Error(`claim failed: ${error.message}`);
    },
    release: async id => { await admin.from('stripe_events').delete().eq('id', id); },
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
    sendTrialReminder: async (to, details) => {
      const testTo = stripeMode() === 'test' ? Deno.env.get('EMAIL_TEST_TO') : undefined;
      await sendEmail(testTo || to, trialReminderEmail(details, `${APP_URL}?billing=manage`));
      console.log(`[stripe] trial reminder sent${testTo ? ' to the sandbox test inbox' : ''}`);
    },
    now: () => new Date(),
    log: m => console.log(m),
  };
  try {
    return reply(200, await processEvent(event, deps));
  } catch (err) {
    // Not handled: Stripe retries with backoff (the claim was released).
    console.error(`[stripe] ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    return reply(500, { error: 'Not processed, will retry' });
  }
});
