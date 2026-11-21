import { serviceClient } from '../_shared/http.ts';
import { reportError } from '../_shared/monitoring.ts';
import { verifyStripeSignature } from '../_shared/billing/state.ts';
import { processEvent, type StripeEvent } from '../_shared/billing/webhook.ts';
import { billingDeps } from '../_shared/billing/deps.ts';

// Stripe's webhook: the only thing that ever changes a user's plan. Deployed with
// --no-verify-jwt (Stripe sends no Supabase JWT); every request must carry a valid
// Stripe-Signature for STRIPE_WEBHOOK_SECRET instead, or it is refused. Each event is
// stored before it is handled and marked processed only after (stripe_events), from the
// subscription as Stripe has it now (_shared/billing/webhook.ts); anything left unfinished
// is redone by Stripe's retry or by billing-reconcile. Logs say what happened, never card or personal details.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, EMAIL_FROM, APP_URL.
// In the Stripe sandbox only, EMAIL_TEST_TO (e.g. Resend's delivered@resend.dev) receives
// the reminders instead of the customer; with a live key it is ignored.

const APP_URL = Deno.env.get('APP_URL') || 'https://tryforka.com/app/';

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

  const deps = billingDeps(serviceClient(), APP_URL);
  try {
    const result = await processEvent(event, deps);
    // Another delivery holds it right now: not acknowledged, so Stripe tries again later.
    if (result.status === 'busy') return reply(503, { error: 'In progress, will retry' });
    return reply(200, result);
  } catch (err) {
    // Not handled: stored as failed; Stripe retries with backoff, and the daily reconciliation redoes it.
    console.error(`[stripe] ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    await reportError('stripe-webhook', err, { event_type: event.type, event_id: event.id });
    return reply(500, { error: 'Not processed, will retry' });
  }
});
