// Server-side fetching for imports: private, loopback and internal addresses are blocked,
// on the first request and after every redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, FetchBlocked, isPrivateAddress, parseIPv4, safeFetch, safeFetchBytes, type SafeFetchOptions } from '../supabase/functions/_shared/imports/safeFetch.ts';

test('private, loopback, link-local and reserved addresses are private', () => {
  const blocked = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.8.9.10',
    '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.168.1.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::a00:1', '64:ff9b::10.0.0.1',
    '2002:7f00:1::', '2130706433', '0x7f.1', '0177.0.0.1', '0x7f000001', '127.1', '017700000001',
    'not-an-ip', '', '1.2.3.4.5', '256.1.1.1', ':::', '1::2::3',
  ];
  for (const ip of blocked) assert.equal(isPrivateAddress(ip), true, ip);
});

test('public addresses are not private', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.0.1', '100.128.0.1', '169.253.1.1',
    '2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808', '[2606:4700::1]']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('numeric IPv4 forms are normalized', () => {
  assert.deepEqual(parseIPv4('2130706433'), [127, 0, 0, 1]);
  assert.deepEqual(parseIPv4('0x7f.1'), [127, 0, 0, 1]);
  assert.deepEqual(parseIPv4('0177.0.0.1'), [127, 0, 0, 1]);
  assert.deepEqual(parseIPv4('10.1'), [10, 0, 0, 1]);
  assert.equal(parseIPv4('example.com'), null);
});

const code = (fn: () => unknown, expected: string) => assert.throws(fn, (err: unknown) => err instanceof FetchBlocked && err.code === expected);

test('checkUrl turns away what may not be fetched', () => {
  for (const u of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'gopher://x.com']) code(() => checkUrl(u), 'bad_url');
  for (const u of [
    'http://localhost/', 'http://LOCALHOST:80/', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://nas.lan/',
    'http://router.home.arpa/', 'http://wiki.corp/', 'http://intranet/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data',
    'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://10.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
    'http://user:pass@example.com/', 'https://user@example.com/', 'http://example.com:8080/', 'https://example.com:22/',
  ]) code(() => checkUrl(u), 'blocked');
  assert.equal(checkUrl('https://www.seriouseats.com/recipe').hostname, 'www.seriouseats.com');
  assert.equal(checkUrl('http://example.com:443/x').hostname, 'example.com');
  assert.equal(checkUrl('http://8.8.8.8/').hostname, '8.8.8.8');
});

// ── safeFetch with a fake network ──────────────────────────────────────────

type Route = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array; hang?: boolean };

function network(routes: Record<string, Route>, dns: Record<string, string[]>) {
  const requested: string[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    assert.equal(init?.redirect, 'manual', 'redirects are followed by hand so every hop is checked');
    const route = routes[url];
    if (!route) return new Response('missing', { status: 404 });
    if (route.hang) {
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  const opts: SafeFetchOptions = {
    fetch: fetchFake,
    resolve: async host => {
      if (!(host in dns)) throw new Error('NXDOMAIN');
      return dns[host];
    },
  };
  return { opts, requested };
}

const PUBLIC = ['93.184.216.34'];

test('fetches a public page', async () => {
  const { opts } = network({ 'https://recipes.example.com/soup': { body: '<html>soup</html>' } }, { 'recipes.example.com': PUBLIC });
  const page = await safeFetch('https://recipes.example.com/soup', opts);
  assert.equal(page.body, '<html>soup</html>');
  assert.equal(page.status, 200);
  assert.equal(page.url, 'https://recipes.example.com/soup');
});

test('a redirect to a loopback address is blocked before it is requested', async () => {
  const { opts, requested } = network({ 'https://a.example.com/': { status: 302, headers: { location: 'http://127.0.0.1/admin' } } }, { 'a.example.com': PUBLIC });
  await assert.rejects(safeFetch('https://a.example.com/', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'blocked');
  assert.deepEqual(requested, ['https://a.example.com/']);
});

test('a redirect to a name that resolves to a private address is blocked', async () => {
  const { opts, requested } = network(
    { 'https://a.example.com/': { status: 301, headers: { location: 'https://evil.example.net/x' } }, 'https://evil.example.net/x': { body: 'secret' } },
    { 'a.example.com': PUBLIC, 'evil.example.net': ['10.0.0.5'] },
  );
  await assert.rejects(safeFetch('https://a.example.com/', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'blocked');
  assert.deepEqual(requested, ['https://a.example.com/']);
});

test('one private address among the answers is enough to block', async () => {
  const { opts, requested } = network({ 'https://mixed.example.com/': { body: 'x' } }, { 'mixed.example.com': ['93.184.216.34', '::1'] });
  await assert.rejects(safeFetch('https://mixed.example.com/', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'blocked');
  assert.deepEqual(requested, []);
});

test('a name that does not resolve is a bad link', async () => {
  const { opts } = network({}, {});
  await assert.rejects(safeFetch('https://nowhere.example.org/', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'bad_url');
});

test('a redirect loop stops at the limit', async () => {
  const { opts, requested } = network(
    { 'https://loop.example.com/a': { status: 302, headers: { location: '/b' } }, 'https://loop.example.com/b': { status: 302, headers: { location: '/a' } } },
    { 'loop.example.com': PUBLIC },
  );
  await assert.rejects(safeFetch('https://loop.example.com/a', { ...opts, maxRedirects: 3 }), (e: unknown) => e instanceof FetchBlocked && e.code === 'too_many_redirects');
  assert.equal(requested.length, 4, 'the first request plus three redirects');
});

test('relative Location headers resolve against the current page', async () => {
  const { opts } = network(
    { 'https://site.example.com/r/123': { status: 308, headers: { location: '../recipes/soup?x=1' } }, 'https://site.example.com/recipes/soup?x=1': { body: 'ok' } },
    { 'site.example.com': PUBLIC },
  );
  const page = await safeFetch('https://site.example.com/r/123', opts);
  assert.equal(page.url, 'https://site.example.com/recipes/soup?x=1');
  assert.equal(page.body, 'ok');
});

test('a body larger than the cap is refused', async () => {
  const { opts } = network({ 'https://big.example.com/': { body: 'x'.repeat(5000), headers: { 'content-type': 'text/html' } } }, { 'big.example.com': PUBLIC });
  await assert.rejects(safeFetch('https://big.example.com/', { ...opts, maxBytes: 1000 }), (e: unknown) => e instanceof FetchBlocked && e.code === 'too_large');
});

test('a Content-Length over the cap is refused before reading', async () => {
  const { opts } = network({ 'https://big.example.com/': { body: 'small', headers: { 'content-type': 'text/html', 'content-length': '999999999' } } }, { 'big.example.com': PUBLIC });
  await assert.rejects(safeFetch('https://big.example.com/', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'too_large');
});

test('a page that never answers times out', async () => {
  const { opts } = network({ 'https://slow.example.com/': { hang: true } }, { 'slow.example.com': PUBLIC });
  const started = Date.now();
  await assert.rejects(safeFetch('https://slow.example.com/', { ...opts, timeoutMs: 50 }), (e: unknown) => e instanceof FetchBlocked && e.code === 'timeout');
  assert.ok(Date.now() - started < 2000);
});

test('an error status is an http_error with the status', async () => {
  const { opts } = network({}, { 'gone.example.com': PUBLIC });
  await assert.rejects(safeFetch('https://gone.example.com/x', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'http_error' && e.status === 404);
});

test('latin-1 pages are decoded with their charset', async () => {
  const bytes = new Uint8Array([0x63, 0x72, 0xe8, 0x6d, 0x65]); // "crème" in latin-1
  const { opts } = network({ 'https://fr.example.com/': { body: bytes, headers: { 'content-type': 'text/html; charset=ISO-8859-1' } } }, { 'fr.example.com': PUBLIC });
  assert.equal((await safeFetch('https://fr.example.com/', opts)).body, 'crème');
});

test('images come back as bytes with the same checks', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const { opts } = network({ 'https://img.example.com/a.png': { body: png, headers: { 'content-type': 'image/png' } } }, { 'img.example.com': PUBLIC });
  const img = await safeFetchBytes('https://img.example.com/a.png', opts);
  assert.equal(img.contentType, 'image/png');
  assert.deepEqual([...img.bytes], [...png]);
  await assert.rejects(safeFetchBytes('http://192.168.0.1/a.png', opts), (e: unknown) => e instanceof FetchBlocked && e.code === 'blocked');
});
