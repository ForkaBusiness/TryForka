// Error reports from the app to Sentry. Off unless VITE_SENTRY_DSN is set at build time
// (Vercel > Settings > Environment Variables). Sentry is loaded a few seconds after the page
// has loaded, in its own file, so the first load stays small; errors before then wait in a
// short queue. Errors only: no session replay and no performance tracing. What a report may
// contain is decided in supabase/functions/_shared/monitoringScrub.ts (never who the family
// is or what they cook).

import { DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from '../../supabase/functions/_shared/monitoringScrub.ts';

type Sentry = typeof import('./sentryClient');

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() || '';
const MAX_EARLY = 20;

let sentry: Sentry | null = null;
const early: Array<{ error: unknown; extra?: Record<string, unknown> }> = [];

/** Reports an error, with optional details (never personal ones). Does nothing when monitoring is off. */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  if (!DSN) return;
  if (sentry) {
    sentry.captureException(error, extra ? { extra } : undefined);
    return;
  }
  if (early.length < MAX_EARLY) early.push({ error, extra });
}

/** Starts monitoring once the page is idle. Call once, after the app has rendered. */
export function startMonitoring(): void {
  if (!DSN || typeof window === 'undefined') return;

  // Until Sentry is here, uncaught errors wait in the queue.
  const onError = (e: Event) => { if (e instanceof ErrorEvent) reportError(e.error ?? e.message); };
  const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const load = () => {
    import('./sentryClient')
      .then(S => {
        const env = import.meta.env as Record<string, string | undefined>;
        S.init({
          dsn: DSN,
          environment: env.VITE_VERCEL_ENV || import.meta.env.MODE,
          release: env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
          dataCollection: { ...DATA_COLLECTION, httpBodies: [] },
          tracesSampleRate: 0,
          beforeSend: event => scrubEvent(event),
          beforeBreadcrumb: crumb => scrubBreadcrumb(crumb),
          ignoreErrors: [
            // Harmless browser layout notices.
            'ResizeObserver loop limit exceeded',
            'ResizeObserver loop completed with undelivered notifications',
          ],
          // Errors from browser extensions aren't Forka's.
          denyUrls: [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-(web-)?extension:\/\//i],
        });
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        sentry = S;
        for (const item of early.splice(0)) reportError(item.error, item.extra);
      })
      .catch(() => {
        // No monitoring this time (offline, blocked by the browser); the app carries on.
      });
  };
  // Out of the way of the app's own start: after the page has loaded, a few seconds more, and
  // then only when the browser is idle.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  const later = () => window.setTimeout(() => (idle ? idle(load, { timeout: 4000 }) : load()), 3000);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
