// Server-side fetching for imports that can't be pointed at our own network. Every URL
// (the one pasted and each redirect hop) is checked before it is requested: http(s) only,
// standard ports, no credentials, no internal hostnames, and every address its hostname
// resolves to must be public. Bodies are read as a stream with a size cap, and the whole
// fetch (all hops together) has one time limit.
//
// Pure TypeScript: DNS and fetch are passed in, so the edge function hands it
// Deno.resolveDns and fetch, and the Node tests hand it fakes.
//
// Known limit: the address is checked, then fetch resolves the name again when it
// connects. A hostname that changes its answer between the two (DNS rebinding) is not
// caught here; the edge runtime itself has no access to our database network, so the
// worst case is a request to some other public address.

export type FetchBlockedCode = 'bad_url' | 'blocked' | 'too_many_redirects' | 'too_large' | 'timeout' | 'http_error' | 'not_html';

export class FetchBlocked extends Error {
  code: FetchBlockedCode;
  status?: number;
  constructor(code: FetchBlockedCode, message: string, status?: number) {
    super(message);
    this.name = 'FetchBlocked';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

// ── Addresses ──────────────────────────────────────────────────────────────

/**
 * An IPv4 address in any form a URL parser accepts ("127.0.0.1", "2130706433", "0x7f.1",
 * "0177.0.0.1") as four bytes, or null when it isn't one.
 */
export function parseIPv4(raw: string): number[] | null {
  const parts = raw.split('.');
  if (parts.length > 4 || parts.some(p => p === '')) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0x[0-9a-f]*$/i.test(p)) n = p.length === 2 ? 0 : parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  const last = nums.pop()!;
  if (nums.some(n => n > 255)) return null;
  const lastBytes = 4 - nums.length;
  if (last >= 256 ** lastBytes) return null;
  const bytes = [...nums];
  for (let i = lastBytes - 1; i >= 0; i--) bytes.push(Math.floor(last / 256 ** i) % 256);
  return bytes;
}

/** An IPv6 address as eight 16-bit groups, or null. Accepts brackets, zone ids and an IPv4 tail. */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  s = s.replace(/%.*$/, '');
  if (!s.includes(':')) return null;
  // An IPv4 tail ("::ffff:127.0.0.1") becomes its two hex groups ("::ffff:7f00:1").
  const lastColon = s.lastIndexOf(':');
  const after = s.slice(lastColon + 1);
  if (after.includes('.')) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(after)) return null;
    const v4 = after.split('.').map(Number);
    if (v4.some(n => n > 255)) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4[0] * 256 + v4[1]).toString(16)}:${(v4[2] * 256 + v4[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === '' ? [] : h.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const hex = (list: string[]) => list.map(g => parseInt(g, 16));
  if (halves.length === 1) return head.length === 8 ? hex(head) : null;
  if (head.length + rest.length >= 8) return null;
  return [...hex(head), ...Array(8 - head.length - rest.length).fill(0), ...hex(rest)];
}

function privateV4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

const v4FromGroups = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** True for any address that isn't a public unicast one, and for anything that isn't an IP at all. */
export function isPrivateAddress(ip: string): boolean {
  const s = ip.trim();
  const v4 = s.includes(':') ? null : parseIPv4(s);
  if (v4) return privateV4(v4);
  const g = parseIPv6(s);
  if (!g) return true;
  const zeroHead = (n: number) => g.slice(0, n).every(x => x === 0);
  if (g.every(x => x === 0)) return true;                                   // ::
  if (zeroHead(7) && g[7] === 1) return true;                               // ::1
  if (zeroHead(5) && g[5] === 0xffff) return privateV4(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d
  if (zeroHead(6)) return true;                                             // IPv4-compatible (deprecated): never public
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return privateV4(v4FromGroups(g[6], g[7])); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true;                              // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true;                              // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true;                              // ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                      // 2001:db8::/32
  if (g[0] === 0x2001 && g[1] === 0x0000) return true;                      // 2001::/32 Teredo (tunnels to anywhere)
  if (zeroHead(4) && g[4] === 0xffff && g[5] === 0) return privateV4(v4FromGroups(g[6], g[7])); // ::ffff:0:a.b.c.d (SIIT)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;          // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x2002) return privateV4(v4FromGroups(g[1], g[2]));          // 6to4 wraps an IPv4
  return false;
}

// ── URLs ───────────────────────────────────────────────────────────────────

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.corp'];

/** The hostname as an IP literal (normalized), or null when it's a name. */
function literalIp(hostname: string): string | null {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (h.includes(':')) return h;
  if (/^[0-9a-fx.]+$/i.test(h) && /^(0x[0-9a-f]*|[0-9]+)(\.(0x[0-9a-f]*|[0-9]+))*$/i.test(h)) {
    const bytes = parseIPv4(h);
    return bytes ? bytes.join('.') : h; // unparsable numeric host: still treated as an IP (and rejected)
  }
  return null;
}

/** The URL if it may be fetched; throws FetchBlocked otherwise. Doesn't look up DNS. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new FetchBlocked('bad_url', 'That is not a web address.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlocked('bad_url', 'Only http and https links can be imported.');
  if (url.username || url.password) throw new FetchBlocked('blocked', 'Links with a user name or password are not allowed.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlocked('blocked', 'That link uses a port that is not allowed.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new FetchBlocked('bad_url', 'That is not a web address.');
  const ip = literalIp(host);
  if (ip !== null) {
    if (isPrivateAddress(ip)) throw new FetchBlocked('blocked', 'That address is not on the public web.');
    return url;
  }
  if (host === 'localhost' || INTERNAL_SUFFIXES.some(s => host.endsWith(s)) || !host.includes('.')) {
    throw new FetchBlocked('blocked', 'That address is not on the public web.');
  }
  return url;
}

// ── Fetching ───────────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  resolve: (host: string) => Promise<string[]>;
  fetch: typeof fetch;
  maxRedirects?: number;
  /** Total time across every hop. */
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  userAgent?: string;
}

async function checkAddresses(url: URL, resolve: SafeFetchOptions['resolve']): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (literalIp(host) !== null) return; // checkUrl already judged the literal
  let addresses: string[];
  try { addresses = await resolve(host); } catch { addresses = []; }
  if (!addresses.length) throw new FetchBlocked('bad_url', "Couldn't find that website.");
  if (addresses.some(isPrivateAddress)) throw new FetchBlocked('blocked', 'That address is not on the public web.');
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function readCapped(res: Response, maxBytes: number, controller: AbortController): Promise<Uint8Array> {
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    controller.abort();
    throw new FetchBlocked('too_large', 'That page is too large to import.');
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      controller.abort();
      throw new FetchBlocked('too_large', 'That page is too large to import.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

async function fetchChecked(raw: string, opts: SafeFetchOptions, defaults: { maxBytes: number; accept: string }): Promise<{ url: string; status: number; contentType: string; bytes: Uint8Array }> {
  const maxRedirects = opts.maxRedirects ?? 4;
  const maxBytes = opts.maxBytes ?? defaults.maxBytes;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FetchBlocked('timeout', 'That page took too long to load.')), opts.timeoutMs ?? 10_000);
  try {
    let url = checkUrl(raw);
    for (let hop = 0; ; hop++) {
      await checkAddresses(url, opts.resolve);
      if (controller.signal.aborted) throw new FetchBlocked('timeout', 'That page took too long to load.');
      let res: Response;
      try {
        res = await opts.fetch(url.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT, Accept: opts.accept ?? defaults.accept, 'Accept-Language': 'en-US,en;q=0.9' },
        });
      } catch (err) {
        if (err instanceof FetchBlocked) throw err;
        if (controller.signal.aborted) throw new FetchBlocked('timeout', 'That page took too long to load.');
        throw new FetchBlocked('http_error', "Couldn't reach that website.");
      }
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) throw new FetchBlocked('http_error', 'That page redirected nowhere.', res.status);
        if (hop >= maxRedirects) throw new FetchBlocked('too_many_redirects', 'That link redirects too many times.');
        let next: string;
        try { next = new URL(location, url).toString(); } catch { throw new FetchBlocked('bad_url', 'That page redirected to a broken address.'); }
        url = checkUrl(next);
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        await res.body?.cancel().catch(() => {});
        throw new FetchBlocked('http_error', `That page answered with an error (${res.status}).`, res.status);
      }
      let bytes: Uint8Array;
      try {
        bytes = await readCapped(res, maxBytes, controller);
      } catch (err) {
        if (err instanceof FetchBlocked) throw err;
        if (controller.signal.aborted) throw new FetchBlocked('timeout', 'That page took too long to load.');
        throw new FetchBlocked('http_error', "Couldn't read that page.");
      }
      return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', bytes };
    }
  } finally {
    clearTimeout(timer);
  }
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const label = charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252' ? 'windows-1252' : 'utf-8';
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

/** A page as text. Follows up to `maxRedirects` redirects, checking every hop. */
export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<{ url: string; status: number; contentType: string; body: string }> {
  const r = await fetchChecked(url, opts, { maxBytes: 3_000_000, accept: DEFAULT_ACCEPT });
  return { url: r.url, status: r.status, contentType: r.contentType, body: decode(r.bytes, r.contentType) };
}

/** An image (or any file) as bytes, with the same checks. */
export async function safeFetchBytes(url: string, opts: SafeFetchOptions): Promise<{ url: string; status: number; contentType: string; bytes: Uint8Array }> {
  return fetchChecked(url, opts, { maxBytes: 6_000_000, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' });
}
