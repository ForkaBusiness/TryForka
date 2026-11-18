import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitToBox } from '../src/lib/handFit.ts';

const W = 400 / 3, H = 100, PAD = 10;

function bounds(points: { x: number; y: number }[]) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// A rough upright hand: taller than wide.
const hand = (cx: number, cy: number, size: number) =>
  [[0, 0.5], [-0.3, 0], [-0.15, -0.5], [0, -0.55], [0.15, -0.5], [0.3, -0.3]].map(([dx, dy]) => ({ x: cx + dx * size, y: cy + dy * size }));

test('a far (small) hand and a near (big) hand are drawn the same size', () => {
  const far = fitToBox(hand(0.3, 0.6, 0.08), 4 / 3, W, H, PAD);
  const near = fitToBox(hand(0.6, 0.4, 0.5), 4 / 3, W, H, PAD);
  for (let i = 0; i < far.length; i++) {
    assert.ok(Math.abs(far[i].x - near[i].x) < 1e-9 && Math.abs(far[i].y - near[i].y) < 1e-9);
  }
});

test('the hand fills the box up to the padding and is centered', () => {
  const b = bounds(fitToBox(hand(0.3, 0.6, 0.08), 4 / 3, W, H, PAD));
  // Taller than wide, so its height reaches the padding on both ends.
  assert.ok(Math.abs(b.minY - PAD) < 1e-9 && Math.abs(b.maxY - (H - PAD)) < 1e-9);
  assert.ok(b.minX >= PAD - 1e-9 && b.maxX <= W - PAD + 1e-9);
  assert.ok(Math.abs((b.minX + b.maxX) / 2 - W / 2) < 1e-9);
});

test('a wide hand reaches the side padding and stays inside top and bottom', () => {
  const sideways = hand(0.5, 0.5, 0.2).map(p => ({ x: 0.5 + (p.y - 0.5) * 2, y: 0.5 + (p.x - 0.5) * 0.3 }));
  const b = bounds(fitToBox(sideways, 4 / 3, W, H, PAD));
  assert.ok(Math.abs(b.minX - PAD) < 1e-9 && Math.abs(b.maxX - (W - PAD)) < 1e-9);
  assert.ok(b.minY >= PAD - 1e-9 && b.maxY <= H - PAD + 1e-9);
});

test("the hand's proportions are kept, measured in camera pixels", () => {
  // A square in camera pixels on a 4:3 frame is 0.75 wide for every 1 tall in 0..1 units.
  const square = [{ x: 0, y: 0 }, { x: 0.75, y: 0 }, { x: 0.75, y: 1 }, { x: 0, y: 1 }];
  const b = bounds(fitToBox(square, 4 / 3, W, H, PAD));
  assert.ok(Math.abs((b.maxX - b.minX) - (b.maxY - b.minY)) < 1e-9);
});

test('degenerate input does not produce NaN', () => {
  assert.deepEqual(fitToBox([], 4 / 3, W, H, PAD), []);
  const one = fitToBox([{ x: 0.2, y: 0.7 }, { x: 0.2, y: 0.7 }], 4 / 3, W, H, PAD);
  for (const p of one) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const line = fitToBox([{ x: 0.2, y: 0.1 }, { x: 0.2, y: 0.9 }], 4 / 3, W, H, PAD);
  for (const p of line) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
