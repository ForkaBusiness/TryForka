// Keeping the screen on in cooking mode: taken on open, taken again when the page comes
// back, never asked for twice at once, and let go on close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepScreenOn, markWakeTipSeen, wakeTipSeen, type WakeLockStatus, type WakeSentinel } from '../src/lib/wakeLock.ts';

function fakes() {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_: 'visibilitychange', l: () => void) => { listeners.add(l); },
    removeEventListener: (_: 'visibilitychange', l: () => void) => { listeners.delete(l); },
    set(state: 'visible' | 'hidden') { this.visibilityState = state; listeners.forEach(l => l()); },
  };
  const sentinels: Array<WakeSentinel & { fire: () => void }> = [];
  let requests = 0;
  let pending: Array<(s: WakeSentinel) => void> = [];
  let auto = true;
  const make = () => {
    const releaseListeners: Array<() => void> = [];
    const s = {
      released: false,
      release: async () => { if (!s.released) { s.released = true; releaseListeners.forEach(l => l()); } },
      addEventListener: (_: 'release', l: () => void) => { releaseListeners.push(l); },
      fire: () => { s.released = true; releaseListeners.forEach(l => l()); },
    };
    sentinels.push(s);
    return s;
  };
  const api = {
    request: () => {
      requests++;
      if (auto) return Promise.resolve(make());
      return new Promise<WakeSentinel>(resolve => { pending.push(resolve); });
    },
  };
  return {
    doc, api, sentinels, listeners,
    get requests() { return requests; },
    hold() { auto = false; },
    resolveAll() { const p = pending; pending = []; p.forEach(r => r(make())); },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('wake lock: taken on open and let go on close', async () => {
  const f = fakes();
  const statuses: WakeLockStatus[] = [];
  const stop = keepScreenOn(f.api, f.doc, s => statuses.push(s));
  await tick();
  assert.equal(f.requests, 1);
  assert.deepEqual(statuses, ['starting', 'on']);
  stop();
  await tick();
  assert.equal(f.sentinels[0].released, true);
  assert.equal(f.listeners.size, 0, 'stops listening for visibility');
});

test('wake lock: taken again when the page becomes visible after the browser dropped it', async () => {
  const f = fakes();
  const statuses: WakeLockStatus[] = [];
  const stop = keepScreenOn(f.api, f.doc, s => statuses.push(s));
  await tick();
  // The phone locks: the browser releases the lock and hides the page.
  f.doc.set('hidden');
  f.sentinels[0].fire();
  await tick();
  assert.equal(f.requests, 1, 'not asked for while hidden');
  assert.equal(statuses.at(-1), 'off');
  f.doc.set('visible');
  await tick();
  assert.equal(f.requests, 2);
  assert.equal(statuses.at(-1), 'on');
  // Visible again while still held: no second request.
  f.doc.set('visible');
  await tick();
  assert.equal(f.requests, 2);
  stop();
});

test('wake lock: never two requests at once, and a lock granted after close is let go', async () => {
  const f = fakes();
  f.hold();
  const stop = keepScreenOn(f.api, f.doc, () => {});
  f.doc.set('visible');
  f.doc.set('visible');
  assert.equal(f.requests, 1);
  stop();
  f.resolveAll();
  await tick();
  assert.equal(f.sentinels[0].released, true);
});

test('wake lock: unsupported and refused are reported (the one-time tip)', async () => {
  const f = fakes();
  const unsupported: WakeLockStatus[] = [];
  keepScreenOn(undefined, f.doc, s => unsupported.push(s))();
  assert.deepEqual(unsupported, ['unsupported']);
  const refused: WakeLockStatus[] = [];
  const stop = keepScreenOn({ request: () => Promise.reject(new Error('NotAllowedError')) }, f.doc, s => refused.push(s));
  await tick();
  assert.deepEqual(refused, ['starting', 'denied']);
  stop();

  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(wakeTipSeen(storage), false);
  markWakeTipSeen(storage);
  assert.equal(wakeTipSeen(storage), true);
  assert.equal(wakeTipSeen(null), false);
});
