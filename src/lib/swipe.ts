// Hands-free cooking: turns a stream of hand positions into "next step" and "previous
// step". Pure (no camera, no clock of its own), so it is tested on recorded and synthetic
// sequences in tests/swipe.test.ts.
//
// Positions are in the user's own view: x runs from 0 at the user's left to 1 at their
// right, like looking in a mirror. The front camera's image is the other way round, so
// the caller flips it (x = 1 - cameraX) before calling. A wave to the user's left is
// "next", a wave to their right is "back".
//
// A swipe is a quick, mostly horizontal sweep that covers enough of the frame. A hand
// resting in view, slow drift, small jitter and anything that isn't a hand never add up
// to one. After a swipe there is a cooldown, so one wave (and the hand swinging back)
// moves exactly one step.

export type Swipe = 'next' | 'back';

export interface HandSample {
  /** Milliseconds, increasing. */
  t: number;
  /** Palm center in the user's view (0 = their left, 1 = their right), or null when no hand is seen. */
  x: number | null;
  /** Palm center, 0 = top. */
  y?: number | null;
}

export interface SwipeConfig {
  /** Share of the frame width the hand must cross. */
  minDistance: number;
  /** The crossing must happen within this long. */
  maxDuration: number;
  /** ...and no faster than this (one jumpy frame is not a swipe). */
  minDuration: number;
  /** Frame widths per second. */
  minSpeed: number;
  /** Vertical movement allowed, as a share of the horizontal. */
  maxVerticalRatio: number;
  /** Share of frame-to-frame moves that must go the swipe's way. */
  minConsistency: number;
  /** After a swipe, nothing counts for this long... */
  cooldown: number;
  /**
   * ...nor until the hand has settled (moving slower than `calmSpeed`, frame widths per
   * second, for `calmFor` ms) or left the frame. A hand still waving back and forth is one
   * gesture, however long it keeps going.
   */
  calmSpeed: number;
  calmFor: number;
  /**
   * The hand may go unseen this long and the movement still counts. Trackers often lose a
   * fast hand for the middle of a wave; longer than this, the hand left and starts over.
   */
  maxGap: number;
}

export const SWIPE_DEFAULTS: SwipeConfig = {
  minDistance: 0.22,
  maxDuration: 600,
  minDuration: 60,
  minSpeed: 0.6,
  maxVerticalRatio: 0.7,
  minConsistency: 0.75,
  cooldown: 900,
  calmSpeed: 0.3,
  calmFor: 200,
  maxGap: 500,
};

interface Point { t: number; x: number; y: number | null }

export interface SwipeState {
  trail: Point[];
  cooldownUntil: number;
  /** False from a swipe until the cooldown is over and the hand has settled or left. */
  armed: boolean;
  /** Since when the hand has been still, while waiting to re-arm. */
  calmSince: number | null;
}

export const initialSwipeState = (): SwipeState => ({ trail: [], cooldownUntil: -Infinity, armed: true, calmSince: null });

/**
 * Whether the trail is a swipe: either ending at its last point, or at the point before,
 * with the last point (already on its way back, in a quick wave) confirming it.
 * `exited`: the hand just left the frame after the last point.
 */
function evaluate(trail: readonly Point[], config: SwipeConfig, exited: boolean): Swipe | null {
  return sweep(trail, config, exited ? 'exited' : null)
    ?? (exited || trail.length < 3 ? null : sweep(trail.slice(0, -1), config, trail[trail.length - 1]));
}

/**
 * Whether `trail`, ending at its last point, is a swipe. It has to be confirmed by a second
 * frame on the far side: the one before the end, the one after (`after`), or the hand
 * leaving the frame there ('exited'). One jumpy frame from the tracker never is.
 */
function sweep(full: readonly Point[], config: SwipeConfig, after: Point | 'exited' | null): Swipe | null {
  if (full.length < 2) return null;
  const end = full[full.length - 1];
  const trail = full.filter(p => end.t - p.t <= config.maxDuration);
  // Where the movement began: the last point that was (about) as far as any from where the
  // hand is now. Frames of resting before it don't stretch the timing.
  const far = Math.max(...trail.map(p => Math.abs(end.x - p.x)));
  let s = 0;
  for (let i = 0; i < trail.length; i++) if (Math.abs(end.x - trail[i].x) >= far - 0.015) s = i;
  const start = trail[s];
  const dx = end.x - start.x;
  const dt = end.t - start.t;
  if (Math.abs(dx) < config.minDistance || dt < config.minDuration || dt > config.maxDuration) return null;
  if ((Math.abs(dx) / dt) * 1000 < config.minSpeed) return null;
  if (start.y !== null && end.y !== null && Math.abs(end.y - start.y) > config.maxVerticalRatio * Math.abs(dx)) return null;
  // Mostly one way, from where the movement began.
  let along = 0, moves = 0;
  for (let i = s + 1; i < trail.length; i++) {
    const step = trail[i].x - trail[i - 1].x;
    if (Math.abs(step) < 0.002) continue; // jitter
    moves++;
    if (Math.sign(step) === Math.sign(dx)) along++;
  }
  if (!moves || along / moves < config.minConsistency) return null;
  // A tracker glitch: the hand "jumps" for a frame and comes back to where it was.
  if (trail.slice(0, s).some(p => Math.abs(p.x - end.x) < config.minDistance / 2)) return null;
  const farSide = (p: Point) => Math.sign(p.x - start.x) === Math.sign(dx) && Math.abs(p.x - start.x) >= config.minDistance * 0.6;
  const confirmed = after === 'exited'
    || (after !== null && farSide(after))
    || (trail.length - 2 > s && farSide(trail[trail.length - 2]));
  if (!confirmed) return null;
  return dx < 0 ? 'next' : 'back';
}

/** One frame in, the new state and the swipe it completed (if any) out. */
export function stepSwipe(state: SwipeState, sample: HandSample, config: SwipeConfig = SWIPE_DEFAULTS): { state: SwipeState; swipe: Swipe | null } {
  const last = state.trail[state.trail.length - 1];
  const fresh = !!last && sample.t - last.t <= config.maxGap;
  const swiped = (swipe: Swipe) => ({ state: { trail: [], cooldownUntil: sample.t + config.cooldown, armed: false, calmSince: null }, swipe });

  // After a swipe: track nothing until the hand settles or leaves, so neither the swing
  // back nor more strokes of the same wave count.
  if (!state.armed) {
    const cooled = sample.t >= state.cooldownUntil;
    if (sample.x === null || !Number.isFinite(sample.x)) {
      const gone = !fresh; // unseen for longer than a dropout
      return { state: { ...state, trail: gone ? [] : state.trail, armed: gone && cooled, calmSince: null }, swipe: null };
    }
    const point: Point = { t: sample.t, x: sample.x, y: sample.y ?? null };
    const slow = !!last && fresh && sample.t > last.t && (Math.abs(point.x - last.x) / (sample.t - last.t)) * 1000 < config.calmSpeed;
    const calmSince = slow ? (state.calmSince ?? last.t) : null;
    const armed = cooled && calmSince !== null && sample.t - calmSince >= config.calmFor;
    return { state: { ...state, trail: [point], armed, calmSince }, swipe: null };
  }

  if (sample.x === null || !Number.isFinite(sample.x)) {
    // No hand this frame. A fast hand is often lost for a frame or two: keep the trail
    // briefly. A wave that carries the hand out of view counts as it leaves.
    if (!fresh) return { state: { ...state, trail: [] }, swipe: null };
    const swipe = evaluate(state.trail, config, true);
    if (swipe) return swiped(swipe);
    return { state, swipe: null };
  }
  const point: Point = { t: sample.t, x: sample.x, y: sample.y ?? null };

  // Kept a little longer than a swipe lasts, so a frame after it can still confirm it.
  const trail = [...(fresh ? state.trail.filter(p => sample.t - p.t <= config.maxDuration + config.maxGap) : []), point];
  const swipe = evaluate(trail, config, false);
  if (swipe) return swiped(swipe);
  return { state: { ...state, trail }, swipe: null };
}

/** Runs a whole sequence; every swipe with the time it was recognized. */
export function detectSwipes(samples: readonly HandSample[], config: SwipeConfig = SWIPE_DEFAULTS): Array<{ t: number; swipe: Swipe }> {
  let state = initialSwipeState();
  const out: Array<{ t: number; swipe: Swipe }> = [];
  for (const s of samples) {
    const r = stepSwipe(state, s, config);
    state = r.state;
    if (r.swipe) out.push({ t: s.t, swipe: r.swipe });
  }
  return out;
}

/** MediaPipe hand landmark indexes of the wrist and the knuckle of each finger: their average is the palm. */
const PALM: readonly number[] = [0, 5, 9, 13, 17];
/** A hand smaller than this (index to little-finger knuckle, share of frame width) is someone in the background. */
export const MIN_PALM_WIDTH = 0.05;

type Landmarks = ReadonlyArray<{ x: number; y: number }>;

/**
 * The most prominent hand (the one swipes follow), in the camera's own coordinates, or
 * null when there is no hand near enough to the camera.
 */
export function mainHand(hands: ReadonlyArray<Landmarks>): Landmarks | null {
  let best: { hand: Landmarks; width: number } | null = null;
  for (const hand of hands) {
    if (hand.length < 21) continue;
    const width = Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y);
    if (width < MIN_PALM_WIDTH) continue;
    if (!best || width > best.width) best = { hand, width };
  }
  return best?.hand ?? null;
}

/** The palm center of the main hand, in the user's view (mirrored from the camera image). */
export function palmFromLandmarks(hands: ReadonlyArray<Landmarks>): { x: number; y: number } | null {
  const hand = mainHand(hands);
  if (!hand) return null;
  const x = PALM.reduce((s, i) => s + hand[i].x, 0) / PALM.length;
  const y = PALM.reduce((s, i) => s + hand[i].y, 0) / PALM.length;
  return { x: 1 - x, y };
}
