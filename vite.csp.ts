/**
 * The app's Content Security Policy (production builds; see vite.config.ts): the app may
 * connect to its own origin and to the Supabase project, and nowhere else. The browser blocks
 * any other fetch, XHR, WebSocket or beacon, which is how a library would phone home, so
 * "nothing is sent" holds for hands-free cooking even if an update tried to. It does not
 * restrict images, fonts, scripts or navigation.
 *
 * With error reporting on (VITE_SENTRY_DSN), exactly one more address is allowed: the Sentry
 * ingest origin named in that DSN, and nothing else at Sentry. Reports carry errors only (see
 * supabase/functions/_shared/monitoringScrub.ts); camera frames are never part of them.
 */
export function connectSrc(supabaseUrl: string | undefined, sentryDsn?: string): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : 'https://*.supabase.co';
  const sources = ["'self'", supabase];
  const sentry = sentryOrigin(sentryDsn);
  if (sentry) sources.push(sentry);
  return `connect-src ${sources.join(' ')} blob: data:`;
}

/** The origin a Sentry DSN sends to ("https://key@o1.ingest.us.sentry.io/2" -> "https://o1.ingest.us.sentry.io"), or null. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn?.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}
