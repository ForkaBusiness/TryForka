// Error reports from the Edge Functions to Sentry. Off unless the SENTRY_DSN secret is set:
//   supabase secrets set SENTRY_DSN=https://...ingest.sentry.io/...
// Sentry is imported the way Supabase documents it (a static import) and started on the
// first error only. A report holds the function's name, the error and its stack, never the
// request (see monitoringScrub.ts). Reporting never changes a response and never throws.

import * as Sentry from 'npm:@sentry/deno@11.11.0';
import { DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from './monitoringScrub.ts';

type SentryDeno = typeof Sentry;

let loading: Promise<SentryDeno | null> | null = null;

function sentry(): Promise<SentryDeno | null> {
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return Promise.resolve(null);
  loading ??= Promise.resolve(Sentry)
    .then(S => {
      S.init({
        dsn,
        // The edge runtime handles requests itself; Sentry's default integrations (global
        // handlers, request capture) don't apply there.
        defaultIntegrations: false,
        dataCollection: { ...DATA_COLLECTION, httpBodies: [] },
        tracesSampleRate: 0,
        environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
        beforeSend: event => scrubEvent(event),
        beforeBreadcrumb: crumb => scrubBreadcrumb(crumb),
      });
      return S;
    })
    .catch(err => {
      console.error('[monitoring] Sentry could not start:', err instanceof Error ? err.message : err);
      return null;
    });
  return loading;
}

/** The function's name, from the request's address ("/functions/v1/import-recipe" -> "import-recipe"). */
export function functionName(req: Request): string {
  try {
    return new URL(req.url).pathname.split('/').filter(Boolean).at(-1) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Sends one error to Sentry, tagged with the function, and waits up to 2 seconds for it to go. */
export async function reportError(fn: string, err: unknown, extra?: Record<string, string | number | boolean>): Promise<void> {
  try {
    const S = await sentry();
    if (!S) return;
    S.withScope(scope => {
      scope.setTag('function', fn);
      const region = Deno.env.get('SB_REGION');
      if (region) scope.setTag('region', region);
      const execution = Deno.env.get('SB_EXECUTION_ID');
      if (execution) scope.setTag('execution_id', execution);
      if (extra) scope.setExtras(extra);
      S.captureException(err);
    });
    await S.flush(2000);
  } catch {
    // Monitoring must never break a request.
  }
}
