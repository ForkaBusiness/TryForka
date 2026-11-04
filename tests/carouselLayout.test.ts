// Unit tests for the recipe carousel's card sizes (run with `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSizes } from '../src/lib/carouselLayout.ts';

const short = (count: number, active: number, dir: 1 | -1) => cardSizes(count, active, dir).map(s => s[0]).join('');

test('moving forward: strip, active, medium, strip', () => {
  assert.equal(short(8, 3, 1), 'hhsamshh');
});

test('moving back: strip, medium, active, strip', () => {
  assert.equal(short(8, 3, -1), 'hsmashhh');
});

test('ends of the row', () => {
  assert.equal(short(8, 0, 1), 'amsshhhh');
  assert.equal(short(8, 7, 1), 'hhhhssma');
  assert.equal(short(8, 7, -1), 'hhhhssma');
});

test('always one active and four visible, with enough cards', () => {
  for (const dir of [1, -1] as const) {
    for (let active = 0; active < 10; active++) {
      const sizes = cardSizes(10, active, dir);
      assert.equal(sizes.filter(s => s === 'active').length, 1);
      assert.equal(sizes.filter(s => s !== 'hidden').length, 4);
      assert.equal(sizes.filter(s => s === 'medium').length, 1);
    }
  }
});

test('short lists', () => {
  assert.deepEqual(cardSizes(1, 0, 1), ['active']);
  assert.deepEqual(cardSizes(2, 0, 1), ['active', 'medium']);
  assert.deepEqual(cardSizes(2, 1, 1), ['medium', 'active']);
  assert.deepEqual(cardSizes(3, 1, 1), ['strip', 'active', 'medium']);
  assert.deepEqual(cardSizes(4, 1, 1), ['strip', 'active', 'medium', 'strip']);
});
