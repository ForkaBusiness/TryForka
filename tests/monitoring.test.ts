// Error reports (Sentry) say what broke, never who the family is or what they cook
// (supabase/functions/_shared/monitoringScrub.ts), and monitoring stays out of the way:
// off without a DSN, loaded after the first screen, wired into every place errors end up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from '../supabase/functions/_shared/monitoringScrub.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('email addresses and tokens are blanked out of messages', () => {
  assert.equal(scrubText('No account for maya.parent+test@example.co.uk'), 'No account for [email]');
  assert.equal(scrubText('JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl expired'), 'JWT [token] expired');
  assert.equal(scrubText('Stripe key sk_live_51Abc123 refused'), 'Stripe key [token] refused');
  assert.equal(scrubText('Authorization: Bearer abc.def-ghi'), 'Authorization: [token]');
  assert.equal(scrubText('Cannot read properties of undefined (reading "map")'), 'Cannot read properties of undefined (reading "map")');
});

test('addresses lose their query string and fragment', () => {
  assert.equal(scrubUrl('https://tryforka.com/app/?share=abc123&checkout=success#top'), 'https://tryforka.com/app/');
  assert.equal(scrubUrl('https://x.supabase.co/rest/v1/recipes?select=*&user_id=eq.8afe'), 'https://x.supabase.co/rest/v1/recipes');
  assert.equal(scrubUrl('/app/'), '/app/');
});

test('click, input and console breadcrumbs are dropped; request ones keep only a clean address', () => {
  assert.equal(scrubBreadcrumb({ category: 'ui.click', message: 'button "Maya"' }), null);
  assert.equal(scrubBreadcrumb({ category: 'ui.input', message: 'input#allergy' }), null);
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'saving notes for Leo' }), null);
  const fetch = scrubBreadcrumb({ category: 'fetch', data: { method: 'POST', url: 'https://x.supabase.co/functions/v1/import-recipe?u=1', status_code: 500, request_body_size: 12, response: '{"recipe":"..."}' } });
  assert.deepEqual(fetch, { category: 'fetch', data: { method: 'POST', url: 'https://x.supabase.co/functions/v1/import-recipe', status_code: 500 } });
  const nav = scrubBreadcrumb({ category: 'navigation', data: { from: '/app/?share=1', to: '/app/?billing=returned' } });
  assert.deepEqual(nav, { category: 'navigation', data: { from: '/app/', to: '/app/' } });
});

test('an event loses the user, request details and personal text, and the original is untouched', () => {
  const event = {
    message: 'Failed for dad@example.com',
    user: { id: 'u1', email: 'dad@example.com', ip_address: '1.2.3.4' },
    server_name: 'edge-1',
    request: { url: 'https://tryforka.com/app/?share=xyz', headers: { Authorization: 'Bearer abc' }, cookies: { sb: '1' }, data: { allergies: ['peanut'] }, query_string: 'share=xyz' },
    transaction: '/app/?checkout=success',
    exception: { values: [{ type: 'Error', value: 'No user dad@example.com' }, { type: 'TypeError' }] },
    breadcrumbs: [{ category: 'ui.click', message: 'Leo' }, { category: 'fetch', data: { url: 'https://a.b/c?d=1' } }],
    extra: { componentStack: 'at Settings', note: 'token eyJa.eyJb.sig' },
    tags: { function: 'import-recipe' },
  };
  const before = JSON.stringify(event);
  const out = scrubEvent(event) as Record<string, unknown>;
  assert.equal(JSON.stringify(event), before, 'the original event is not changed');
  assert.equal(out.user, undefined);
  assert.equal(out.server_name, undefined);
  assert.deepEqual(out.request, { url: 'https://tryforka.com/app/' });
  assert.equal(out.message, 'Failed for [email]');
  assert.equal(out.transaction, '/app/');
  assert.deepEqual((out.exception as { values: unknown[] }).values, [{ type: 'Error', value: 'No user [email]' }, { type: 'TypeError' }]);
  assert.deepEqual(out.breadcrumbs, [{ category: 'fetch', data: { url: 'https://a.b/c' } }]);
  assert.deepEqual(out.extra, { componentStack: 'at Settings', note: 'token [token]' });
  assert.deepEqual(out.tags, { function: 'import-recipe' });
});

test("Sentry's own collection of personal data is all off", () => {
  assert.deepEqual(DATA_COLLECTION, {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
    genAI: { inputs: false, outputs: false }, databaseQueryData: false, stackFrameVariables: false,
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

test('the app loads Sentry only on demand, errors only, and only with a DSN', () => {
  const src = new URL('../src', import.meta.url).pathname;
  for (const f of files(src)) {
    const text = readFileSync(f, 'utf8');
    // A static import would put Sentry in the first download.
    assert.doesNotMatch(text, /^import\s+(?!type\b)[^;]*from\s+['"]@sentry\//m, f);
    assert.doesNotMatch(text, /^import\s+(?!type\b)[^;]*from\s+['"][./]*(lib\/)?sentryClient['"]/m, f);
  }
  const monitoring = read('src/lib/monitoring.ts');
  assert.match(monitoring, /import\('\.\/sentryClient'\)/);
  // Only what's used, so the build can leave the rest of Sentry out.
  assert.equal(read('src/lib/sentryClient.ts').match(/export \{([^}]*)\} from '@sentry\/react'/)?.[1].trim(), 'init, captureException');
  assert.match(monitoring, /if \(!DSN\) return;/);
  assert.match(monitoring, /tracesSampleRate: 0/);
  assert.match(monitoring, /dataCollection: \{ \.\.\.DATA_COLLECTION/);
  assert.match(monitoring, /beforeSend: event => scrubEvent\(event\)/);
  assert.match(monitoring, /beforeBreadcrumb: crumb => scrubBreadcrumb\(crumb\)/);
  assert.doesNotMatch(monitoring, /replayIntegration|browserTracingIntegration/);
});

test('a crash while drawing shows a way back and is reported', () => {
  const main = read('src/main.tsx');
  assert.match(main, /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/);
  assert.match(main, /startMonitoring\(\)/);
  const boundary = read('src/components/ErrorBoundary.tsx');
  assert.match(boundary, /componentDidCatch[\s\S]*reportError\(/);
  assert.match(boundary, /window\.location\.reload\(\)/);
});

test('the Edge Functions report every unexpected failure, and stay quiet without a DSN', () => {
  const edge = read('supabase/functions/_shared/monitoring.ts');
  assert.match(edge, /if \(!dsn\) return Promise\.resolve\(null\);/);
  assert.match(edge, /dataCollection: \{ \.\.\.DATA_COLLECTION/);
  assert.match(edge, /beforeSend: event => scrubEvent\(event\)/);
  const http = read('supabase/functions/_shared/http.ts');
  assert.match(http, /console\.error\('\[function\] unexpected error:', err\);\s*await reportError\(functionName\(req\), err\);/);
  assert.match(http, /err\.status >= 500\) await reportError/);
  for (const fn of ['stripe-webhook', 'billing-reconcile', 'sync-recipes']) {
    assert.match(read(`supabase/functions/${fn}/index.ts`), new RegExp(`reportError\\('${fn}'`), fn);
  }
});

test('the app may connect only to itself, Supabase and, with reporting on, its one Sentry address', async () => {
  const { connectSrc, sentryOrigin } = await import('../vite.csp.ts');
  const supa = 'https://akufkhzzqwjhssmegvof.supabase.co';
  assert.equal(connectSrc(supa), "connect-src 'self' https://akufkhzzqwjhssmegvof.supabase.co blob: data:");
  assert.equal(connectSrc(supa, ''), connectSrc(supa));
  assert.equal(connectSrc(supa, 'https://abc123@o451.ingest.us.sentry.io/4508'), "connect-src 'self' https://akufkhzzqwjhssmegvof.supabase.co https://o451.ingest.us.sentry.io blob: data:");
  // Never a wildcard, never a plain-http remote address, nothing from a malformed DSN.
  assert.equal(sentryOrigin('http://key@evil.example.com/1'), null);
  assert.equal(sentryOrigin('not a url'), null);
  assert.equal(sentryOrigin('http://key@127.0.0.1:5299/1'), 'http://127.0.0.1:5299');
  assert.doesNotMatch(connectSrc(supa, 'https://k@o1.ingest.sentry.io/2'), /\*/);
});
