// Picking up mid-cook: the step and the ticked ingredients, per recipe, for a cooking session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearSession, loadSession, saveSession, SESSION_MS } from '../src/lib/cookSession.ts';

function memory() {
  const store = new Map<string, string>();
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, store };
}

test('cook session: resumes at the same step with the same ticks, per recipe', () => {
  const s = memory();
  const t0 = 1_800_000_000_000;
  assert.equal(loadSession(s, 7, 6, t0), null);
  saveSession(s, 7, { step: 3, checked: [2, 0, 2] }, t0);
  saveSession(s, 9, { step: 1, checked: [] }, t0);
  assert.deepEqual(loadSession(s, 7, 6, t0 + 60_000), { step: 3, checked: [0, 2], at: t0 });
  assert.equal(loadSession(s, 9, 4, t0)?.step, 1);
});

test('cook session: ends after 12 hours untouched, or when the recipe is finished', () => {
  const s = memory();
  const t0 = 1_800_000_000_000;
  saveSession(s, 7, { step: 2, checked: [1] }, t0);
  assert.ok(loadSession(s, 7, 6, t0 + SESSION_MS - 1));
  assert.equal(loadSession(s, 7, 6, t0 + SESSION_MS), null);
  saveSession(s, 7, { step: 2, checked: [] }, t0);
  clearSession(s, 7, t0 + 1);
  assert.equal(loadSession(s, 7, 6, t0 + 2), null);
});

test('cook session: a step past the end (the recipe was edited) lands on the last step', () => {
  const s = memory();
  saveSession(s, 7, { step: 9, checked: [] }, 1);
  assert.equal(loadSession(s, 7, 4, 2)?.step, 3);
  assert.equal(loadSession(s, 7, 0, 2), null);
});

test('cook session: unreadable or blocked storage never breaks cooking mode', () => {
  const s = memory();
  s.store.set('forka_cook_sessions_v1', '{not json');
  assert.equal(loadSession(s, 7, 4), null);
  s.store.set('forka_cook_sessions_v1', JSON.stringify({ 7: { step: 'two' } }));
  assert.equal(loadSession(s, 7, 4), null);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadSession(blocked, 7, 4), null);
  saveSession(blocked, 7, { step: 1, checked: [] });
  assert.equal(loadSession(null, 7, 4), null);
});
