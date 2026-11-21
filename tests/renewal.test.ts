import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renewalTerms } from '../src/lib/renewal.ts';

const NOW = new Date('2026-11-20T12:00:00');

test('before paying: price, that it renews until cancelled, how often, the first charge date, how to cancel', () => {
  const trial = renewalTerms('year', true, NOW);
  assert.match(trial, /Free for 14 days/);
  assert.match(trial, /\$39\.99 is charged on December 4, 2026 and every year after, until you cancel/);
  assert.match(trial, /Cancel any time in Settings/);
  assert.match(trial, /cancel before December 4, 2026 and you pay nothing/);
  assert.match(renewalTerms('year', false, NOW), /\$39\.99 every year until you cancel/);
  assert.match(renewalTerms('month', false, NOW), /\$4\.99 every month until you cancel/);
  for (const t of [trial, renewalTerms('month', false, NOW), renewalTerms('year', false, NOW)]) {
    assert.match(t, /Full refund within 14 days of any payment, no questions asked/);
    assert.ok(!/\u2014/.test(t), 'no em dashes');
  }
});
