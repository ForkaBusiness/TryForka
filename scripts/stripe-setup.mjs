#!/usr/bin/env node
// Sets up Forka Pro in a Stripe account: the product, the two prices (found by lookup key,
// so the code never hard-codes price ids), the Customer Portal settings and the webhook
// endpoint. Safe to run again: it finds what exists and only creates what's missing.
// Run once in the sandbox, and once with the live key when going live:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs \
//     --webhook https://<project>.supabase.co/functions/v1/stripe-webhook \
//     --secret-out ./.stripe-webhook-secret.local
//
// The webhook signing secret is only shown by Stripe when the endpoint is created. It is
// written to --secret-out (never printed); set it as the STRIPE_WEBHOOK_SECRET secret.

import { writeFileSync } from 'node:fs';

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('Set STRIPE_SECRET_KEY.'); process.exit(1); }
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const WEBHOOK_URL = arg('--webhook');
const SECRET_OUT = arg('--secret-out');
const APP_URL = arg('--app') ?? 'https://tryforka.com/app/';

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed', 'charge.refunded',
];

function form(params, prefix = '') {
  return Object.entries(params).flatMap(([k, v]) => {
    if (v === undefined || v === null) return [];
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) return v.flatMap((x, i) => (x && typeof x === 'object' ? form(x, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`]));
    if (typeof v === 'object') return form(v, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
  });
}
async function api(method, path, params = {}) {
  const body = form(params).join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: method === 'GET' ? undefined : body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message}`);
  return json;
}

const mode = KEY.startsWith('sk_live_') ? 'LIVE' : 'sandbox';
console.log(`Stripe ${mode}`);

// Product
const products = await api('GET', '/products', { active: true, limit: 100 });
let product = products.data.find(p => p.metadata?.forka === 'pro');
if (!product) product = await api('POST', '/products', { name: 'Forka Pro', description: 'Plans your family\'s whole week: every meal, goals for each person, and meal prep.', metadata: { forka: 'pro' } });
console.log(`product ${product.id} (${product.name})`);

// Prices, by lookup key
const PRICES = [
  { lookup_key: 'forka_pro_monthly', unit_amount: 499, interval: 'month', nickname: 'Pro Monthly' },
  { lookup_key: 'forka_pro_yearly', unit_amount: 3999, interval: 'year', nickname: 'Pro Yearly' },
];
const found = await api('GET', '/prices', { lookup_keys: PRICES.map(p => p.lookup_key), active: true, limit: 10 });
const priceIds = {};
for (const p of PRICES) {
  let price = found.data.find(x => x.lookup_key === p.lookup_key);
  if (price && (price.unit_amount !== p.unit_amount || price.recurring?.interval !== p.interval || price.product !== product.id)) {
    console.log(`price ${p.lookup_key} differs; creating a new one and moving the lookup key to it`);
    price = null;
  }
  if (!price) {
    price = await api('POST', '/prices', { product: product.id, currency: 'usd', unit_amount: p.unit_amount, recurring: { interval: p.interval }, lookup_key: p.lookup_key, transfer_lookup_key: true, nickname: p.nickname, tax_behavior: 'unspecified' });
  }
  priceIds[p.interval] = price.id;
  console.log(`price ${p.lookup_key} ${price.id} $${(p.unit_amount / 100).toFixed(2)}/${p.interval}`);
}

// Customer Portal: change plan, update the card, see invoices, cancel (at period end).
const portalSettings = {
  business_profile: { headline: 'Manage your Forka Pro plan', privacy_policy_url: 'https://tryforka.com/privacy', terms_of_service_url: 'https://tryforka.com/terms' },
  default_return_url: APP_URL,
  features: {
    customer_update: { enabled: true, allowed_updates: ['email'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    // No exit survey: cancelling takes no more steps than subscribing.
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', cancellation_reason: { enabled: false, options: [] } },
    subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{ product: product.id, prices: [priceIds.month, priceIds.year] }] },
  },
  metadata: { forka: 'pro' },
};
const configs = await api('GET', '/billing_portal/configurations', { active: true, limit: 100 });
let portal = configs.data.find(c => c.metadata?.forka === 'pro');
portal = portal ? await api('POST', `/billing_portal/configurations/${portal.id}`, portalSettings) : await api('POST', '/billing_portal/configurations', portalSettings);
console.log(`portal configuration ${portal.id}`);

// Webhook endpoint
if (WEBHOOK_URL) {
  const hooks = await api('GET', '/webhook_endpoints', { limit: 100 });
  const existing = hooks.data.find(h => h.url === WEBHOOK_URL);
  if (existing) {
    await api('POST', `/webhook_endpoints/${existing.id}`, { enabled_events: EVENTS, disabled: false });
    console.log(`webhook ${existing.id} updated (its signing secret is unchanged; Stripe shows it in the dashboard)`);
  } else {
    const hook = await api('POST', '/webhook_endpoints', { url: WEBHOOK_URL, enabled_events: EVENTS, description: 'Forka Pro plans', metadata: { forka: 'pro' } });
    if (SECRET_OUT) { writeFileSync(SECRET_OUT, `${hook.secret}\n`, { mode: 0o600 }); console.log(`webhook ${hook.id} created; signing secret written to ${SECRET_OUT}`); }
    else console.log(`webhook ${hook.id} created; pass --secret-out to save its signing secret`);
  }
}
console.log('Done.');
