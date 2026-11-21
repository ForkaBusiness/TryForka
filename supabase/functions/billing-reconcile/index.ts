import { serviceClient } from '../_shared/http.ts';
import { reportError } from '../_shared/monitoring.ts';
import { reconcile } from '../_shared/billing/webhook.ts';
import { billingDeps } from '../_shared/billing/deps.ts';

// The daily billing reconciliation (pg_cron, 20261126000000_webhook_durability.sql):
// finishes Stripe events a crash or failure left unfinished, then compares every
// subscription in user_plans with Stripe and fixes what differs. Each run is recorded in
// billing_reconciliations. Deployed with --no-verify-jwt; every call must carry
// x-reconcile-secret matching BILLING_RECONCILE_SECRET, or it is refused and nothing runs.

const APP_URL = Deno.env.get('APP_URL') || 'https://tryforka.com/app/';
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time comparison. */
function same(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const secret = Deno.env.get('BILLING_RECONCILE_SECRET') ?? '';
  if (secret.length < 32 || !same(req.headers.get('x-reconcile-secret') ?? '', secret)) {
    console.warn('[reconcile] refused: missing or wrong secret');
    return reply(401, { error: 'Not allowed' });
  }
  const admin = serviceClient();
  try {
    const report = await reconcile(billingDeps(admin, APP_URL));
    const { error } = await admin.from('billing_reconciliations').insert({ checked: report.checked, fixed: report.fixed, events_redone: report.eventsRedone, details: report.details });
    if (error) { console.error('[reconcile] run not recorded:', error.message); await reportError('billing-reconcile', new Error(`run not recorded: ${error.message}`)); }
    console.log(`[reconcile] checked ${report.checked}, fixed ${report.fixed}, events redone ${report.eventsRedone}`);
    return reply(200, report);
  } catch (err) {
    console.error('[reconcile] failed:', err instanceof Error ? err.message : err);
    await reportError('billing-reconcile', err);
    return reply(500, { error: 'Reconciliation failed' });
  }
});
