import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.103.3';

// Request plumbing shared by the user-facing Edge Functions: CORS, JSON responses,
// user-scoped Supabase clients and the per-user, per-kind rate limit.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  // The app reads how long a limit lasts (a daily cap vs "too many at once").
  'Access-Control-Expose-Headers': 'Retry-After',
};

export function json(obj: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...headers },
  });
}

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

/** Supabase client acting as the caller: PostgREST checks their JWT and RLS applies. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface RateLimit { kind: string; perMinute: number; perDay: number; noun: string }

/** Records one request for the signed-in caller, or throws AppError if they're over a limit. */
export async function claimRequest(db: SupabaseClient, limit: RateLimit): Promise<void> {
  const { data, error } = await db.rpc('claim_request', { p_kind: limit.kind, p_per_minute: limit.perMinute, p_per_day: limit.perDay });
  if (error) {
    if (error.code === 'PGRST301' || /JWT/i.test(error.message)) throw new AppError('Sign in again to continue.', 401);
    console.error('[rate-limit] check failed:', error);
    throw new AppError('This is unavailable right now. Try again in a minute.', 503);
  }
  const wait = Number(data);
  if (wait === -1) throw new AppError('Sign in again to continue.', 401);
  if (wait > 60) {
    const hours = Math.ceil(wait / 3600);
    throw new AppError(`You've used today's ${limit.noun}. More in about ${hours} hour${hours === 1 ? '' : 's'}.`, 429, wait);
  }
  if (wait > 0) throw new AppError(`Too many requests at once. Try again in ${wait} seconds.`, 429, wait);
}

/** Common handling: CORS preflight, POST only, JSON body, AppError -> JSON error response. */
export function serve(handler: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    try {
      return json(await handler(body, req), 200);
    } catch (err) {
      if (err instanceof AppError) {
        return json({ error: err.message }, err.status, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {});
      }
      console.error('[function] unexpected error:', err);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  });
}
