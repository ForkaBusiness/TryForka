// Cooking mode's text size: three steps up from default, remembered, and multiplied by
// the device's own text size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookScale, loadTextSize, saveTextSize, systemTextScale, TEXT_SIZES } from '../src/lib/cookText.ts';

test('text size: default plus at least three steps up, each larger than the last', () => {
  assert.equal(TEXT_SIZES[0].scale, 1);
  assert.ok(TEXT_SIZES.length >= 4);
  for (let i = 1; i < TEXT_SIZES.length; i++) assert.ok(TEXT_SIZES[i].scale > TEXT_SIZES[i - 1].scale);
});

test('text size: remembered on the device, anything unknown reads as default', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(loadTextSize(storage), 'default');
  saveTextSize(storage, 'larger');
  assert.equal(loadTextSize(storage), 'larger');
  store.set('forka_cook_text_size', 'huge');
  assert.equal(loadTextSize(storage), 'default');
  assert.equal(loadTextSize(null), 'default');
  const broken = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(loadTextSize(broken), 'default');
});

test("text size: the device's setting multiplies the chosen size", () => {
  assert.equal(systemTextScale(null), 1);
  assert.equal(systemTextScale(17), 1);
  assert.equal(systemTextScale(23), 23 / 17);
  assert.equal(systemTextScale(53), 2, 'accessibility sizes are capped so a step still fits');
  assert.equal(systemTextScale(10), 0.85);
  assert.equal(cookScale('default', 1), 1);
  assert.equal(cookScale('largest', 1), 1.65);
  assert.equal(cookScale('large', systemTextScale(21)), 1.48);
});
