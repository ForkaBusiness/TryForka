// What an error report may contain, for the app and the Edge Functions alike (Sentry).
//
// A report says what broke and where: the error, its stack, the screen or function, the
// browser. It never carries who the family is or what they cook:
//   - no user, IP address, cookies, headers or request bodies;
//   - addresses without their query strings (they can hold ids, search words, share links);
//   - no click or input breadcrumbs (button text can be a family member's name) and no
//     console breadcrumbs (log lines can hold anything);
//   - email addresses and sign-in tokens are blanked out of every message.
// Pure functions, no Sentry import: the same rules are unit-tested in tests/monitoring.test.ts.

type Obj = Record<string, unknown>;

/** Sentry's own data collection, all off: the scrubbing below is a second line, not the first. */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
} as const;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// JWTs (Supabase sessions), Stripe secrets and bearer tokens.
const TOKENS = /\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:sk|rk|pk|whsec)_(?:live|test)_[\w]+|\bBearer\s+[\w.-]+/g;

/** A message with email addresses and tokens blanked out. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKENS, '[token]');
}

/** An address without its query string or fragment. Anything that isn't a URL is scrubbed as text. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubText(cut === -1 ? url : url.slice(0, cut));
}

const DROPPED_BREADCRUMBS = new Set(['ui.click', 'ui.input', 'ui.keypress', 'console']);

/** A breadcrumb safe to send, or null to drop it. */
export function scrubBreadcrumb<T extends object>(crumb: T): T | null {
  const c = crumb as Obj;
  const category = typeof c.category === 'string' ? c.category : '';
  if (DROPPED_BREADCRUMBS.has(category)) return null;
  const out: Obj = { ...c };
  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (out.data && typeof out.data === 'object') {
    const data: Obj = {};
    for (const [k, v] of Object.entries(out.data as Obj)) {
      // Request and response bodies never leave the device.
      if (/body|payload|input|response/i.test(k)) continue;
      data[k] = typeof v === 'string' ? (/^(url|from|to)$/i.test(k) ? scrubUrl(v) : scrubText(v)) : v;
    }
    out.data = data;
  }
  return out as unknown as T;
}

/** An event safe to send. Returns a copy; the original isn't changed. */
export function scrubEvent<T extends object>(event: T): T {
  const out: Obj = { ...(event as Obj) };
  delete out.user;
  delete out.server_name;
  if (out.request && typeof out.request === 'object') {
    const req = out.request as Obj;
    out.request = typeof req.url === 'string' ? { url: scrubUrl(req.url) } : {};
  }
  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (typeof out.transaction === 'string') out.transaction = scrubUrl(out.transaction);
  const exception = out.exception as { values?: Obj[] } | undefined;
  if (exception?.values) {
    out.exception = {
      ...exception,
      values: exception.values.map(v => (typeof v.value === 'string' ? { ...v, value: scrubText(v.value) } : v)),
    };
  }
  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = (out.breadcrumbs as Obj[]).map(b => scrubBreadcrumb(b)).filter(b => b !== null);
  }
  if (out.extra && typeof out.extra === 'object') {
    const extra: Obj = {};
    for (const [k, v] of Object.entries(out.extra as Obj)) extra[k] = typeof v === 'string' ? scrubText(v) : v;
    out.extra = extra;
  }
  return out as unknown as T;
}
