// Hands-free swipe detection on synthetic hand-position sequences, sampled like the real
// loop (about 12 frames a second) with tracking noise added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSwipes, palmFromLandmarks, stepSwipe, initialSwipeState, SWIPE_DEFAULTS, type HandSample } from '../src/lib/swipe.ts';

const FRAME = 83; // ms, about 12 fps

/** A deterministic wobble, like landmark jitter (about half a percent of the frame). */
const noise = (i: number, size = 0.005) => Math.sin(i * 12.9898) * size;

/** Positions from `fn(time since start)`, sampled every frame for `ms`, starting at `t0`. */
function sequence(t0: number, ms: number, fn: (t: number) => { x: number | null; y?: number }, jitter = 0.005): HandSample[] {
  const out: HandSample[] = [];
  for (let t = 0, i = 0; t <= ms; t += FRAME, i++) {
    const p = fn(t);
    out.push({ t: t0 + t, x: p.x === null ? null : p.x + noise(i, jitter), y: (p.y ?? 0.5) + noise(i + 7, jitter) });
  }
  return out;
}
/** Hand moves from x0 to x1 in `ms`, easing in and out like a real wave. */
const wave = (t0: number, x0: number, x1: number, ms = 350) =>
  sequence(t0, ms, t => ({ x: x0 + (x1 - x0) * (0.5 - Math.cos(Math.PI * Math.min(1, t / ms)) / 2) }));
const hold = (t0: number, x: number, ms: number) => sequence(t0, ms, () => ({ x }));
const swipes = (samples: HandSample[]) => detectSwipes(samples).map(s => s.swipe);

test('a wave to the left (in the user\'s view) is the next step', () => {
  assert.deepEqual(swipes([...hold(0, 0.75, 300), ...wave(300, 0.75, 0.25)]), ['next']);
});

test('a wave to the right is back', () => {
  assert.deepEqual(swipes([...hold(0, 0.25, 300), ...wave(300, 0.25, 0.75)]), ['back']);
});

test('the camera image is mirrored: a hand moving right in the raw image is moving to the user\'s left', () => {
  const hand = (cameraX: number) => Array.from({ length: 21 }, (_, i) => ({ x: cameraX + (i % 5) * 0.02, y: 0.5 + Math.floor(i / 5) * 0.02 }));
  // Raw camera x goes up as the hand moves to the user's left (the image isn't mirrored).
  const frames = [0.25, 0.35, 0.45, 0.55, 0.65, 0.75].map((cameraX, i) => ({ t: i * FRAME, ...palmFromLandmarks([hand(cameraX)])! }));
  assert.ok(frames[0].x > frames[5].x, 'in the user\'s view the palm moves left');
  assert.deepEqual(swipes(frames), ['next']);
});

test('a hand resting in view never triggers, however long it stays', () => {
  assert.deepEqual(swipes(hold(0, 0.5, 20_000)), []);
  // Even with heavier jitter (low light, steam in front of the lens).
  assert.deepEqual(swipes(sequence(0, 20_000, () => ({ x: 0.5 }), 0.02)), []);
});

test('slow drift across the whole frame never triggers', () => {
  assert.deepEqual(swipes(sequence(0, 3000, t => ({ x: 0.85 - 0.7 * (t / 3000) }))), [], 'across in 3 seconds');
  assert.deepEqual(swipes(sequence(0, 1500, t => ({ x: 0.85 - 0.7 * (t / 1500) }))), [], 'across in 1.5 seconds');
});

test('a short, quick twitch is not a swipe', () => {
  assert.deepEqual(swipes([...hold(0, 0.5, 300), ...wave(300, 0.5, 0.4, 150), ...hold(450, 0.4, 500)]), []);
});

test('two waves within the cooldown move one step, and the swing back does not count', () => {
  // Wave left, swing straight back right, wave left again, all inside the cooldown.
  const t = [...hold(0, 0.75, 250), ...wave(250, 0.75, 0.25, 300), ...wave(550, 0.25, 0.75, 300), ...wave(850, 0.75, 0.25, 300)];
  assert.deepEqual(swipes(t), ['next']);
});

test('two waves with a pause between them are two steps', () => {
  // Wave left, bring the hand back slowly, wave left again.
  const t = [...hold(0, 0.75, 250), ...wave(250, 0.75, 0.25), ...hold(600, 0.25, 400), ...wave(1000, 0.25, 0.75, 1400), ...hold(2400, 0.75, 300), ...wave(2700, 0.75, 0.25)];
  assert.deepEqual(swipes(t), ['next', 'next']);
});

test('after the cooldown, a quick wave the other way is a deliberate step back', () => {
  const t = [...hold(0, 0.75, 250), ...wave(250, 0.75, 0.25), ...hold(600, 0.25, 900), ...wave(1500, 0.25, 0.75)];
  assert.deepEqual(swipes(t), ['next', 'back']);
});

test('mostly vertical movement is not a swipe', () => {
  const diagonal = sequence(0, 350, t => ({ x: 0.7 - 0.3 * (t / 350), y: 0.1 + 0.8 * (t / 350) }));
  assert.deepEqual(swipes(diagonal), []);
});

test('a hand that disappears and reappears elsewhere is not a swipe (tracking lost)', () => {
  const t = [...hold(0, 0.8, 300), ...sequence(300, 700, () => ({ x: null })), ...hold(1000, 0.2, 300)];
  assert.deepEqual(swipes(t), []);
  // Frames dropped for a moment (a busy phone): starting over is safer than guessing.
  const gap = [...hold(0, 0.8, 200), ...hold(800, 0.2, 300)];
  assert.deepEqual(swipes(gap), []);
});

test('a single jumpy frame from the tracker is not a swipe', () => {
  const t = hold(0, 0.5, 600).map((s, i) => (i === 4 ? { ...s, x: 0.1 } : s));
  assert.deepEqual(swipes(t), []);
});

// Recorded in Chromium: MediaPipe's hand landmarker following a hand photo moved across a
// 320x240 camera stream (raw camera left to right, so the cook's left) in 380 ms. Palm x as
// the app sees it (mirrored), one frame about every 100 ms. The tracker lost the hand for
// a frame in the middle, as it often does with a fast wave.
const RECORDED_FAST_WAVE: HandSample[] = [
  [6528, 0.772], [6614, 0.772], [6709, 0.772], [6811, 0.700], [6911, 0.696], [7011, null], [7111, 0.303], [7295, 0.242],
  [7395, 0.242], [7495, 0.242], [7595, 0.242], [7695, 0.242], [7778, 0.242], [7880, 0.242], [7978, 0.242], [8080, 0.242],
].map(([t, x]) => ({ t: t as number, x: x as number | null, y: x === null ? null : 0.52 }));

test('recorded: a fast wave the tracker loses for a frame is still one next step', () => {
  assert.deepEqual(swipes(RECORDED_FAST_WAVE), ['next']);
});

test('a wave that carries the hand out of view counts as it leaves', () => {
  // Only one frame on the far side before the hand is gone: no second frame to confirm it.
  const out: HandSample[] = [...hold(0, 0.75, 300), { t: 383, x: 0.75, y: 0.5 }, { t: 466, x: 0.42, y: 0.5 }, { t: 549, x: null }, { t: 632, x: null }];
  assert.deepEqual(swipes(out), ['next']);
  // But a single frame far away, followed by no hand for longer than a dropout, is not enough on its own to be a glitch either way.
  const glitchThenGone: HandSample[] = [...hold(0, 0.5, 300), { t: 383, x: 0.5, y: 0.5 }, { t: 466, x: 0.05, y: 0.9 }, { t: 549, x: null }];
  assert.deepEqual(swipes(glitchThenGone), [], 'mostly vertical: not a swipe');
});

test('a fast wave at a low frame rate (only a few frames) still counts', () => {
  const t = [0, 0.75, 100, 0.75, 200, 0.55, 300, 0.3, 400, 0.25, 500, 0.25];
  const samples = [];
  for (let i = 0; i < t.length; i += 2) samples.push({ t: t[i], x: t[i + 1], y: 0.5 });
  assert.deepEqual(swipes(samples), ['next']);
});

// Recorded in Chromium on a heavily loaded machine: the tracker managed only 4 to 7 frames a
// second and lost the hand mid-wave. A quick wave to the cook's left, straight back and left
// again: one step, not none.
const RECORDED_SLOW_DOUBLE_WAVE: Array<[number, number | null]> = [
  [27400, 0.772], [27530, 0.772], [27650, 0.772], [27790, 0.772], [27920, 0.772],
  [28053, 0.772], [28203, 0.772], [28320, 0.772], [28453, 0.772], [28636, 0.772], [28835, null],
  [29018, 0.241], [29287, null], [29420, 0.771], [29653, null], [29820, 0.241], [30042, 0.242],
  [30161, 0.242], [30278, 0.242], [30400, 0.242], [30520, 0.242],
];

test('a slow device that loses the hand mid-wave still moves exactly one step', () => {
  assert.deepEqual(swipes(RECORDED_SLOW_DOUBLE_WAVE.map(([t, x]) => ({ t, x, y: 0.5 }))), ['next']);
});

// Recorded the same way: the tracker lost the hand for the whole stroke (467 ms) and found it
// again on the far side.
const RECORDED_UNSEEN_STROKE: Array<[number, number | null]> = [
  [7100, 0.772], [7210, 0.772], [7320, 0.772], [7420, 0.772], [7528, 0.772], [7635, 0.772],
  [7733, 0.772], [7842, 0.772], [8009, null], [8176, null], [8309, 0.241], [8543, 0.242],
  [8660, 0.242], [8759, 0.242],
];

// And a quick double wave where the hand was seen only once on the far side before swinging
// back: the next frame, still on the far side, confirms it.
const RECORDED_ONE_FAR_FRAME: Array<[number, number | null]> = [
  [28100, 0.772], [28200, 0.772], [28316, 0.772], [28416, 0.772], [28516, 0.772], [28613, 0.772],
  [28730, 0.772], [28830, 0.772], [28929, 0.658], [29030, null], [29144, 0.241], [29346, 0.336],
  [29446, null], [29546, 0.639], [29746, null], [29859, 0.241], [30098, 0.242], [30237, 0.242],
  [30396, 0.242], [30520, 0.242],
];

test('a hand the tracker loses for the whole stroke still counts once it is seen on the far side', () => {
  assert.deepEqual(swipes(RECORDED_UNSEEN_STROKE.map(([t, x]) => ({ t, x, y: 0.5 }))), ['next']);
});

test('a quick double wave seen only once on the far side still moves exactly one step', () => {
  assert.deepEqual(swipes(RECORDED_ONE_FAR_FRAME.map(([t, x]) => ({ t, x, y: 0.5 }))), ['next']);
});

test('a hand that jumps for one frame and comes straight back is still not a swipe', () => {
  const t: HandSample[] = [...hold(0, 0.5, 400), { t: 483, x: 0.1, y: 0.5 }, { t: 566, x: 0.48, y: 0.5 }, ...hold(649, 0.5, 300)];
  assert.deepEqual(swipes(t), []);
});

test('the step function keeps state between frames and starts each swipe fresh', () => {
  let state = initialSwipeState();
  const results: string[] = [];
  for (const s of [...hold(0, 0.75, 250), ...wave(250, 0.75, 0.25)]) {
    const r = stepSwipe(state, s);
    state = r.state;
    if (r.swipe) results.push(r.swipe);
  }
  assert.deepEqual(results, ['next']);
  assert.equal(state.trail.length > 0 || state.cooldownUntil > 0, true);
  assert.ok(state.cooldownUntil > 0 && state.cooldownUntil - 600 <= SWIPE_DEFAULTS.cooldown);
});

test('palm position ignores hands too small to be the cook (someone in the background)', () => {
  const hand = (cx: number, size: number) => Array.from({ length: 21 }, (_, i) => ({ x: cx + ((i % 5) - 2) * size, y: 0.5 + (Math.floor(i / 5) - 2) * size }));
  assert.equal(palmFromLandmarks([hand(0.5, 0.004)]), null);
  assert.equal(palmFromLandmarks([]), null);
  const near = palmFromLandmarks([hand(0.2, 0.004), hand(0.7, 0.05)])!;
  assert.ok(Math.abs(near.x - (1 - 0.7)) < 0.06, 'the biggest hand, mirrored');
});
