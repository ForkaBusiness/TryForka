import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useHandsFree, type HandShape, type HandsFreeStatus } from '../lib/useHandsFree';
import { handsFreeSupport } from '../lib/handTracking';
import { fitToBox } from '../lib/handFit';
import { useApp } from '../app/AppContext';
import { getRecipe, recipeTitle, type Recipe } from '../lib/catalog';
import { markCooked } from '../lib/cooked';
import { TimerChip } from '../components/Timers';
import { BottomSheet, Button, IconButton, Progress, Skeleton, ToggleChip, cx } from '../components/ds';

// A cookbook propped on the counter: one step per screen in type you can read from a few
// feet away, and big targets for next and back. Arrow keys and space move on desktop; the
// screen stays awake while this is open. With Hands-free on, a wave in front of the camera
// moves a step: left for next, right for back (see useHandsFree and lib/swipe).

const HANDS_FREE_INTRO_KEY = 'forka_hands_free_intro_seen';
const HANDS_FREE_PROMISE = 'Wave left for the next step, right to go back. Your camera only looks for your hand. Nothing is recorded, saved or sent.';

/** Why hands-free isn't running, in plain words, and what still works. */
const HANDS_FREE_PROBLEM: Partial<Record<HandsFreeStatus, string>> = {
  unsupported: "This browser can't use the camera for hands-free. Tap Next and Back instead.",
  denied: 'Camera access is blocked for this site, so hands-free is off. To use it, allow the camera in your browser settings. Until then, tap Next and Back.',
  'no-camera': 'No camera found, so hands-free is off. Tap Next and Back instead.',
  busy: 'Another app is using the camera, so hands-free is off. Close it and try again, or tap Next and Back.',
  failed: "Hands-free couldn't start. Try again, or tap Next and Back.",
  interrupted: 'The camera stopped, so hands-free is off. Turn it on again, or tap Next and Back.',
};

function introSeen(): boolean {
  try { return localStorage.getItem(HANDS_FREE_INTRO_KEY) === '1'; } catch { return false; }
}

/** How long the live preview shows when the camera comes on, to aim the device. */
const AIM_MS = 3000;

/** MediaPipe's hand landmarks joined into a hand: wrist to each fingertip, and across the knuckles. */
const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const PALM_OUTLINE = [0, 1, 5, 9, 13, 17];
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

/** The tile's shape in drawing units (it is 4:3), and the space kept around a fitted hand. */
const TILE_W = 400 / 3;
const TILE_H = 100;
const TILE_PAD = 10;

/**
 * The tracked hand, drawn from its 21 points: nothing when no hand is seen. Normally the hand
 * is scaled to fill the tile, so it reads the same from across the counter as up close. While
 * the preview shows (`overlay`), it is laid over the video the same way the video is (cropped
 * to fill) instead, so the drawing sits on the hand.
 */
function HandDrawing({ subscribe, overlay }: { subscribe: (listener: (hand: HandShape | null) => void) => () => void; overlay: boolean }) {
  const [hand, setHand] = useState<HandShape | null>(null);
  useEffect(() => subscribe(setHand), [subscribe]);
  if (!hand) return null;
  const w = overlay ? 100 * hand.aspect : TILE_W;
  const points = overlay
    ? hand.points.map(p => ({ x: p.x * w, y: p.y * 100 }))
    : fitToBox(hand.points, hand.aspect, TILE_W, TILE_H, TILE_PAD);
  const at = (i: number) => points[i];
  return (
    <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="xMidYMid slice" aria-hidden data-fit={overlay ? 'camera' : 'hand'} className="absolute inset-0 size-full">
      <polygon points={PALM_OUTLINE.map(i => `${at(i).x},${at(i).y}`).join(' ')} className="fill-green-soft/80" />
      {BONES.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={at(a).x} y1={at(a).y} x2={at(b).x} y2={at(b).y} strokeWidth={3} strokeLinecap="round" className="stroke-green" />
      ))}
      {hand.points.map((_, i) => (
        <circle key={i} cx={at(i).x} cy={at(i).y} r={FINGERTIPS.has(i) ? 3.4 : 2} strokeWidth={1.2} className={FINGERTIPS.has(i) ? 'fill-green-deep stroke-surface' : 'fill-surface stroke-green'} />
      ))}
    </svg>
  );
}

/**
 * While hands-free is on: a small tile that shows the camera only while the cook aims the
 * device (a few seconds after it comes on, or while Show camera is on). The rest of the
 * time the video is fully transparent and the tile shows just the tracked hand, drawn from
 * its points. The video stays in place because the tracker reads its frames from it; they
 * are never captured or stored.
 */
function HandsFreePanel({ videoRef, status, handSeen, swipe, subscribeHand }: {
  videoRef: React.RefObject<HTMLVideoElement | null>; status: HandsFreeStatus; handSeen: boolean; swipe: 'next' | 'back' | null;
  subscribeHand: (listener: (hand: HandShape | null) => void) => () => void;
}) {
  // Keeps the live preview showing until turned off again (and resets with hands-free).
  const [showCamera, setShowCamera] = useState(false);
  // Each time the camera comes on, the preview shows for a moment (from the very first
  // frame), then fades out.
  const [aimed, setAimed] = useState(false);
  useEffect(() => {
    if (status !== 'on') { setAimed(false); return; }
    const t = window.setTimeout(() => setAimed(true), AIM_MS);
    return () => window.clearTimeout(t);
  }, [status]);
  const preview = status === 'on' && (!aimed || showCamera);

  const text = swipe === 'next' ? 'Next step' : swipe === 'back' ? 'Back a step'
    : status === 'paused' ? 'Camera paused'
    // Until the tracker is actually running, it isn't watching yet.
    : status !== 'on' ? 'Starting the camera'
    : preview && !showCamera ? 'Aim the camera at your hand'
    : handSeen ? 'Hand seen' : 'Wave to change steps';
  return (
    <div className="mt-3 flex items-center gap-3">
      <div aria-hidden className="relative aspect-4/3 w-24 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          data-preview={preview ? 'shown' : 'hidden'}
          className={cx('absolute inset-0 size-full -scale-x-100 object-cover transition-opacity duration-700 ease-out', preview ? 'opacity-100' : 'opacity-0')}
        />
        <HandDrawing subscribe={subscribeHand} overlay={preview} />
      </div>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <p className="flex max-w-full items-center gap-2">
          <span aria-hidden className={status === 'on' ? 'size-2 shrink-0 rounded-full bg-green' : 'size-2 shrink-0 rounded-full bg-ink-muted/50'} />
          <span role="status" aria-live="polite" className="truncate text-small font-semibold text-ink">
            {swipe ? <span className="text-green">{text}</span> : text}
            <span className="sr-only">{status === 'on' ? '. Camera on.' : ''}</span>
          </span>
        </p>
        <ToggleChip selected={showCamera} onToggle={() => setShowCamera(v => !v)}>Show camera</ToggleChip>
      </div>
    </div>
  );
}

function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let active = true;
    const acquire = async () => {
      try { if (active && document.visibilityState === 'visible') lock = await nav.wakeLock!.request('screen'); } catch { /* denied or unsupported */ }
    };
    // The lock drops when the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export function CookingMode({ id }: { id: number }) {
  const { prefs, userId, replace, back } = useApp();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hands-free: off every time cooking mode opens.
  const [handsFree, setHandsFree] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useWakeLock();

  useEffect(() => { getRecipe(id).then(setRecipe).catch(() => setRecipe(null)); }, [id]);

  const total = recipe?.steps.length ?? 0;
  const last = step >= total - 1;

  const finishing = useRef(false);
  const finish = useCallback(async () => {
    if (finishing.current) return; // already saving
    finishing.current = true;
    setSaving(true);
    setError(null);
    try {
      await markCooked(userId, id);
      setFinished(true);
    } catch {
      setError("Couldn't mark it as cooked. Check your connection and try again.");
    } finally {
      finishing.current = false;
      setSaving(false);
    }
  }, [userId, id]);

  const next = useCallback(() => { if (last) void finish(); else setStep(s => Math.min(total - 1, s + 1)); }, [last, finish, total]);
  const prev = useCallback(() => setStep(s => Math.max(0, s - 1)), []);

  // The camera runs only while hands-free is on and there are steps to move through.
  const handsFreeOn = handsFree && !finished && total > 0;
  // A wave never finishes the recipe: on the last step only a tap on Done does, so a hand
  // reaching across the counter can't mark it cooked.
  const camera = useHandsFree(handsFreeOn, swipe => {
    if (swipe === 'back') { if (step === 0) return false; prev(); return true; }
    if (last) return false;
    next();
    return true;
  });
  const { status: cameraStatus, lastSwipe, clearSwipe } = camera;
  // A camera that can't be used turns hands-free off and says why; touch keeps working.
  useEffect(() => {
    const message = HANDS_FREE_PROBLEM[cameraStatus];
    if (message) { setProblem(message); setHandsFree(false); }
  }, [cameraStatus]);
  // Swipe feedback shows for a moment.
  useEffect(() => {
    if (!lastSwipe) return;
    const t = window.setTimeout(clearSwipe, 900);
    return () => window.clearTimeout(t);
  }, [lastSwipe, clearSwipe]);

  const toggleHandsFree = () => {
    setProblem(null);
    if (handsFree) { setHandsFree(false); return; }
    // No point explaining the camera to a browser that can't use one.
    if (handsFreeSupport() !== 'ok') { setProblem(HANDS_FREE_PROBLEM.unsupported!); return; }
    if (introSeen()) setHandsFree(true); else setIntroOpen(true);
  };
  const startAfterIntro = () => {
    try { localStorage.setItem(HANDS_FREE_INTRO_KEY, '1'); } catch { /* shown again next time */ }
    setIntroOpen(false);
    setHandsFree(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Space on a focused button presses that button instead.
      if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, finished]);

  if (recipe === undefined) {
    return (
      <div aria-busy aria-label="Loading recipe" className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-12">
        <Skeleton className="h-11 w-11 rounded-full" />
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
        <Skeleton className="mt-12 h-5 w-24 rounded-full" />
        <Skeleton className="mt-5 h-40 w-full rounded-card" />
      </div>
    );
  }
  if (!recipe || !total) {
    return (
      <div className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-12">
        <IconButton icon={X} label="Close cooking mode" variant="outlined" onClick={back} />
        <h1 className="display mt-6 text-title text-ink">{recipe ? 'No steps to cook from' : "Couldn't load this recipe"}</h1>
        <p className="mt-2 text-body text-ink-muted">{recipe ? 'This recipe has no written steps.' : 'Check your connection, then try again.'}</p>
      </div>
    );
  }

  const title = recipeTitle(recipe);
  const current = recipe.steps[step];

  if (finished) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-column flex-col justify-center px-gutter py-10">
        <p className="label">Marked as cooked</p>
        <h1 className="display mt-2 text-display text-ink">{title} is done. Enjoy.</h1>
        <p className="mt-3 text-body text-ink-muted">How did it turn out? A rating helps us suggest what your household likes.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => replace({ name: 'rate', id })}>Rate this recipe</Button>
          <Button size="lg" variant="secondary" onClick={back}>Back to recipe</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-10">
        <div className="flex items-center gap-3">
          <IconButton icon={X} label="Close cooking mode" variant="outlined" onClick={back} />
          <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-muted">{title}</p>
          <ToggleChip selected={handsFree} onToggle={toggleHandsFree}>Hands-free</ToggleChip>
        </div>
        {handsFree && (
          <HandsFreePanel
            videoRef={camera.videoRef}
            status={cameraStatus}
            handSeen={camera.handSeen}
            swipe={lastSwipe?.swipe ?? null}
            subscribeHand={camera.subscribeHand}
          />
        )}
        {problem && <p role="alert" className="mt-3 text-small text-terracotta-deep">{problem}</p>}
        <div className="mt-4">
          <Progress value={(step + 1) / total} label={`Step ${step + 1} of ${total}`} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-column flex-1 px-gutter pt-8 pb-6 md:pt-12">
        <p className="label" aria-live="polite">Step {step + 1} of {total}</p>
        <p className="mt-4 text-step font-medium text-ink md:text-step-lg">
          {prefs.units === 'metric' ? current.text_metric : current.text_us}
        </p>
        {current.timers.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-3">
            {current.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} size="lg" />)}
          </div>
        )}
        {error && <p role="alert" className="mt-6 text-body text-terracotta-deep">{error}</p>}
      </div>

      <div className="sticky bottom-0 bg-linear-to-t from-cream from-75% to-cream/0">
        <div className="mx-auto flex w-full max-w-column gap-3 px-gutter pt-5 pb-(--bottombar-pad)">
          <Button size="lg" variant="secondary" icon={ArrowLeft} className="h-16 flex-1" onClick={prev} disabled={step === 0}>Back</Button>
          <Button size="lg" iconEnd={last ? Check : ArrowRight} className="h-16 flex-2" onClick={next} loading={saving}>{last ? 'Done' : 'Next'}</Button>
        </div>
      </div>

      <BottomSheet
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        title="Hands-free cooking"
        side="bottom"
        footer={
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button size="lg" variant="secondary" onClick={() => setIntroOpen(false)}>Not now</Button>
            <Button size="lg" onClick={startAfterIntro}>Turn on camera</Button>
          </div>
        }
      >
        <p className="text-body text-ink">{HANDS_FREE_PROMISE}</p>
      </BottomSheet>
    </div>
  );
}
