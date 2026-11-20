// Stripe's REST API from the Edge Functions: form-encoded requests with the secret key,
// no SDK. The key decides sandbox or live (STRIPE_SECRET_KEY); nothing else in the code
// changes between them.

import { AppError } from '../http.ts';

const API = 'https://api.stripe.com/v1';

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects as a[b]=c, arrays as a[0]=c. */
export function encodeForm(params: Params, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(item && typeof item === 'object' ? encodeForm(item as Params, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === 'object') out.push(...encodeForm(v as Params, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new AppError('Payments are not set up yet.', 503);
  const body = encodeForm(params).join('&');
  const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'GET' ? undefined : body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; type?: string; code?: string } }).error;
    console.error('[stripe]', method, path, res.status, err?.type, err?.message);
    throw new StripeError(res.status, err?.code ?? null);
  }
  return json as T;
}

/** A Stripe API error: shown to the family as "not reachable", with Stripe's status and code for callers that need them. */
export class StripeError extends AppError {
  constructor(readonly stripeStatus: number, readonly code: string | null) {
    super("Payments aren't reachable right now. Try again in a minute.", 502);
  }
  /** The object is already gone (deleted earlier, or in the dashboard). */
  get missing() { return this.stripeStatus === 404 || this.code === 'resource_missing'; }
}

/** Live or sandbox, from the key itself. */
export const stripeMode = () => ((Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_live_') ? 'live' : 'test');

/** The two prices, found by lookup key (created by scripts/stripe-setup.mjs in each mode). */
export const PRICE_LOOKUP = { month: 'forka_pro_monthly', year: 'forka_pro_yearly' } as const;
