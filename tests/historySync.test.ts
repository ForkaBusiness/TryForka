// The phone's Back steps back one screen instead of leaving Forka (src/lib/historySync.ts).
// A small model of the browser's session history stands in for window.history: entries, an
// index, and popstate fired asynchronously after go(), as browsers do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistorySync, depthOf, withDepth } from '../src/lib/historySync.ts';

class FakeHistory {
  entries: unknown[];
  index: number;
  queued: Array<() => void> = [];
  onPop: (state: unknown) => void = () => {};
  constructor(start: unknown[] = [{ page: 'site' }, null]) { this.entries = [...start]; this.index = start.length - 1; }
  get state() { return this.entries[this.index]; }
  pushState(data: unknown) { this.entries = this.entries.slice(0, this.index + 1); this.entries.push(data); this.index++; }
  replaceState(data: unknown) { this.entries[this.index] = data; }
  go(delta: number) {
    const next = Math.min(this.entries.length - 1, Math.max(0, this.index + delta));
    if (next === this.index) return;
    this.queued.push(() => { this.index = next; this.onPop(this.state); });
  }
  /** The household presses Back. */
  back() { this.go(-1); this.flush(); }
  forward() { this.go(1); this.flush(); }
  flush() { while (this.queued.length) this.queued.shift()!(); }
}

/** The app: a stack of screens, kept in step with the history as App.tsx does. */
function app(history = new FakeHistory()) {
  let stack = ['mealplan'];
  const sync = createHistorySync(history, d => { stack = stack.slice(0, Math.max(1, d)); sync.sync(stack.length); });
  history.onPop = s => sync.popped(s);
  const set = (next: string[]) => { stack = next; sync.sync(stack.length); history.flush(); };
  return {
    history,
    get stack() { return stack; },
    open: (name: string) => set([...stack, name]),
    tab: (name: string) => set([name]),
    appBack: () => set(stack.length > 1 ? stack.slice(0, -1) : ['mealplan']),
    replace: (name: string) => set([...stack.slice(0, -1), name]),
  };
}

test('depthOf reads only the app\'s own entries', () => {
  assert.equal(depthOf(null), null);
  assert.equal(depthOf({ page: 'site' }), null);
  assert.equal(depthOf({ forkaDepth: 0 }), null);
  assert.equal(depthOf({ forkaDepth: 2.5 }), null);
  assert.equal(depthOf({ forkaDepth: '2' }), null);
  assert.equal(depthOf(withDepth({ other: 1 }, 3)), 3);
  assert.deepEqual(withDepth({ other: 1 }, 3), { other: 1, forkaDepth: 3 });
});

test('Back on a recipe returns to the plan, and Back again leaves the app', () => {
  const a = app();
  a.open('recipe');
  assert.deepEqual(a.stack, ['mealplan', 'recipe']);
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan']);
  a.history.back();
  // The page before Forka: the browser is leaving the app, which keeps its stack.
  assert.deepEqual(a.history.state, { page: 'site' });
  assert.deepEqual(a.stack, ['mealplan']);
});

test('Back steps through every open screen, one at a time', () => {
  const a = app();
  a.open('browse'); a.open('recipe'); a.open('notes');
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan', 'browse', 'recipe']);
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan', 'browse']);
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan']);
});

test('the app\'s own back arrow keeps the history in step', () => {
  const a = app();
  a.open('recipe'); a.open('cooking');
  a.appBack();
  assert.deepEqual(a.stack, ['mealplan', 'recipe']);
  assert.equal(depthOf(a.history.state), 2);
  // Back now closes the recipe, not a screen that's already gone.
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan']);
});

test('switching tabs from deep in a screen leaves one entry for the new tab', () => {
  const a = app();
  a.open('browse'); a.open('recipe');
  a.tab('groceries');
  assert.deepEqual(a.stack, ['groceries']);
  assert.equal(depthOf(a.history.state), 1);
  a.open('recipe');
  a.history.back();
  assert.deepEqual(a.stack, ['groceries']);
});

test('replacing a screen (import to editor) adds no entry', () => {
  const a = app();
  a.open('import');
  const before = a.history.entries.length;
  a.replace('editor');
  assert.equal(a.history.entries.length, before);
  a.history.back();
  assert.deepEqual(a.stack, ['mealplan']);
});

test('Forward onto a closed screen goes straight back to where the app is', () => {
  const a = app();
  a.open('recipe');
  a.history.back();
  a.history.forward();
  assert.deepEqual(a.stack, ['mealplan']);
  assert.equal(depthOf(a.history.state), 1);
});

test('several screens opened at once (a share into the app) each get an entry', () => {
  const h = new FakeHistory();
  let stack = ['mealplan'];
  const sync = createHistorySync(h, d => { stack = stack.slice(0, d); });
  h.onPop = s => sync.popped(s);
  stack = ['mealplan', 'browse', 'recipe'];
  sync.sync(stack.length);
  assert.equal(depthOf(h.state), 3);
  h.back();
  assert.deepEqual(stack, ['mealplan', 'browse']);
});

test('the first entry keeps what was already in its state', () => {
  const h = new FakeHistory([{ page: 'site' }, { kept: true }]);
  createHistorySync(h, () => {});
  assert.deepEqual(h.state, { kept: true, forkaDepth: 1 });
});

test('code that rewrites the address keeps the app\'s history entry', () => {
  // A replaceState(null, ...) would erase the depth, and Back would then leave the app.
  for (const file of ['src/lib/incomingShare.ts', 'src/lib/billing.ts']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /replaceState\(\s*null/, file);
  }
});
