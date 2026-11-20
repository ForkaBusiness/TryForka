import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ListChecks, Shuffle, Type, Volume2, X } from 'lucide-react';
import { useHandsFree, type HandShape, type HandsFreeStatus } from '../lib/useHandsFree';
import { handsFreeSupport } from '../lib/handTracking';
import { fitToBox } from '../lib/handFit';
import { useApp } from '../app/AppContext';
import { getRecipe, recipeTitle, type Recipe } from '../lib/catalog';
import { markCooked } from '../lib/cooked';
import { TimerChip } from '../components/Timers';
import { useTimers } from '../lib/timers';
import { keepScreenOn, markWakeTipSeen, wakeTipSeen, type WakeLockApi } from '../lib/wakeLock';
import { cookScale, loadTextSize, saveTextSize, type TextSizeId } from '../lib/cookText';
import { ReadAloudBar, TextSizeSheet, ToolButton } from '../components/cooking/CookTools';
import { useReadAloud } from '../lib/useReadAloud';
import { stepScript } from '../lib/speech';
import { useSystemTextScale } from '../lib/useSystemTextScale';
import { IngredientsSheet, StepIngredients, StepsSheet, type CookIngredient } from '../components/cooking/StepNav';
import { MissingSheet, VariationsSheet } from '../components/cooking/CookingHelp';
import { stepIngredients } from '../lib/stepIngredients';
import { clearSession, loadSession, saveSession } from '../lib/cookSession';
import { BASE_SERVINGS, servingsFor } from '../lib/nutrition';
import { formatMeasure } from '../../supabase/functions/_shared/catalog/units.ts';
import { HiddenRecipe } from '../components/AllergyReminder';
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

const safeStorage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/**
 * Keeps the screen on while cooking mode is open (see lib/wakeLock). Returns true when a
 * small tip should say the screen may dim: the browser can't keep it on and the tip
 * hasn't been shown on this device before. Shown once, never again.
 */
function useWakeLock(): [boolean, () => void] {
  const [tip, setTip] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: WakeLockApi };
    return keepScreenOn(nav.wakeLock, document, status => {
      if ((status === 'unsupported' || status === 'denied') && !wakeTipSeen(safeStorage())) {
        markWakeTipSeen(safeStorage());
        setTip(true);
      }
    });
  }, []);
  return [tip, () => setTip(false)];
}

export function CookingMode({ id }: { id: number }) {
  const { prefs, userId, replace, back, billing } = useApp();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hands-free: off every time cooking mode opens.
  const [handsFree, setHandsFree] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [wakeTip, dismissWakeTip] = useWakeLock();
  // The timer tray floats over the bottom of the screen; the step leaves room for it.
  const timerCount = useTimers().length;
  // Text size: the cook's choice on this device, times the device's own setting.
  const [textSize, setTextSizeState] = useState<TextSizeId>(() => loadTextSize(safeStorage()));
  const setTextSize = (v: TextSizeId) => { setTextSizeState(v); saveTextSize(safeStorage(), v); };
  const systemScale = useSystemTextScale();
  const [sheet, setSheet] = useState<'text' | 'steps' | 'ingredients' | 'missing' | 'variations' | null>(null);
  // "Missing something?" opened on one ingredient, or null to pick.
  const [missingStart, setMissingStart] = useState<number | null>(null);
  const openMissing = (index: number | null) => { setMissingStart(index); setSheet('missing'); };
  // One stable close: a sheet re-runs its focus handling whenever onClose changes.
  const closeSheet = useCallback(() => setSheet(null), []);
  // Ingredients ticked off while prepping, and the step this visit picked up at.
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set());
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    getRecipe(id, prefs).then(r => {
      setBlockedBy(r?.blockedBy ?? null);
      const loaded = r?.recipe ?? null;
      // Back to the step (and ticks) from earlier in this cooking session, once per visit.
      if (loaded && !restored.current) {
        restored.current = true;
        const session = loadSession(safeStorage(), id, loaded.steps.length);
        if (session) {
          setStep(session.step);
          setChecked(new Set(session.checked.filter(i => i < loaded.ingredients.length)));
          if (session.step > 0) setResumedAt(session.step);
        }
      }
      setRecipe(loaded);
    }).catch(() => setRecipe(null));
  }, [id, prefs]);

  const total = recipe?.steps.length ?? 0;
  const last = step >= total - 1;

  // Remembered as the cook goes, so leaving and coming back picks up here.
  useEffect(() => {
    if (!recipe || finished || !total) return;
    saveSession(safeStorage(), id, { step, checked: [...checked] });
  }, [recipe, finished, total, id, step, checked]);

  // Amounts for the servings chosen on the recipe page (a catalog recipe serves BASE_SERVINGS as written).
  const baseServings = recipe?.servings ?? BASE_SERVINGS;
  const servings = servingsFor(id, baseServings);
  const ingredients: CookIngredient[] = useMemo(() => (recipe?.ingredients ?? []).map((ing, index) => ({
    index,
    name: ing.name_us || ing.name,
    amount: formatMeasure({ quantity: ing.quantity, quantityMax: ing.quantity_max, unit: ing.unit, note: ing.note }, prefs.units, servings / baseServings),
  })), [recipe, prefs.units, servings, baseServings]);
  const stepText = (i: number) => (recipe ? (prefs.units === 'metric' ? recipe.steps[i].text_metric : recipe.steps[i].text_us) : '');
  const usedHere = useMemo(() => {
    if (!recipe || !total) return [];
    const s = recipe.steps[Math.min(step, total - 1)];
    return stepIngredients(`${s.text_us} ${s.text_metric}`, recipe.ingredients).map(i => ingredients[i]);
  }, [recipe, total, step, ingredients]);
  const toggleChecked = (index: number, on: boolean) => setChecked(prevSet => {
    const nextSet = new Set(prevSet);
    if (on) nextSet.add(index); else nextSet.delete(index);
    return nextSet;
  });
  const startOver = () => { setStep(0); setChecked(new Set()); setResumedAt(null); };

  // Read aloud: off each time cooking mode opens. Once on, every step is read when it
  // shows, whatever moved it (a tap, a key, a wave, the step list).
  const speech = useReadAloud();
  const [reading, setReading] = useState(false);
  const script = recipe && total ? stepScript(step + 1, total, stepText(step), usedHere) : '';
  const spokenStep = useRef<number | null>(null);
  const toggleReading = () => {
    if (reading) { setReading(false); speech.stop(); spokenStep.current = null; return; }
    setReading(true);
    // Spoken from inside the tap: iOS only starts speech that a tap asked for.
    speech.speak(script);
    spokenStep.current = step;
  };
  const { speak, stop: stopSpeech, failed: speechFailed } = speech;
  useEffect(() => {
    if (!reading || finished || !script || spokenStep.current === step) return;
    spokenStep.current = step;
    speak(script);
  }, [reading, finished, step, script, speak]);
  // A device that can't speak turns it off and says so; the step stays on screen.
  useEffect(() => { if (speechFailed) { setReading(false); spokenStep.current = null; } }, [speechFailed]);
  useEffect(() => { if (finished) stopSpeech(); }, [finished, stopSpeech]);

  const finishing = useRef(false);
  const finish = useCallback(async () => {
    if (finishing.current) return; // already saving
    finishing.current = true;
    setSaving(true);
    setError(null);
    try {
      await markCooked(userId, id);
      clearSession(safeStorage(), id);
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
      // A sheet is open: its own buttons get the keys.
      if (sheet || introOpen) return;
      // Space on a focused button presses that button instead.
      if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, finished, sheet, introOpen]);

  // A new step starts at the top, so large text never leaves the cook mid-paragraph.
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  if (blockedBy) return <HiddenRecipe blockedBy={blockedBy} onBack={back} />;
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
    <div className="flex min-h-dvh flex-col bg-cream" style={{ '--cook-scale': cookScale(textSize, systemScale) } as React.CSSProperties}>
      <header className="mx-auto w-full max-w-column px-gutter pt-(--screen-top) md:pt-10">
        <div className="flex items-center gap-3">
          <IconButton icon={X} label="Close cooking mode" variant="outlined" onClick={back} />
          <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-muted">{title}</p>
          <ToggleChip size="lg" selected={handsFree} onToggle={toggleHandsFree}>Hands-free</ToggleChip>
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
        {wakeTip && (
          <div role="status" className="mt-3 flex items-center gap-3 rounded-card border border-line bg-surface py-2 pr-2 pl-4">
            <p className="min-w-0 flex-1 text-small text-ink">This browser can't keep your screen on, so it may dim while you cook. A tap now and then keeps it awake.</p>
            <Button variant="secondary" className="shrink-0" onClick={dismissWakeTip}>Got it</Button>
          </div>
        )}
        <div className="mt-4">
          <Progress value={(step + 1) / total} label={`Step ${step + 1} of ${total}`} />
        </div>
        <div className="mt-4 flex gap-2">
          <ToolButton icon={ListChecks} label="Ingredients" detail={`${ingredients.filter(i => checked.has(i.index)).length}/${ingredients.length}`} onClick={() => setSheet('ingredients')} />
          <ToolButton icon={Type} label="Text size" onClick={() => setSheet('text')} />
          {speech.available && <ToolButton icon={Volume2} label="Read aloud" pressed={reading} onClick={toggleReading} />}
          <ToolButton icon={Shuffle} label="Make it different" onClick={() => (billing.plan === 'pro' ? setSheet('variations') : billing.upgrade('variations'))} />
        </div>
        {reading && (
          <ReadAloudBar
            state={speech.state}
            step={step + 1}
            onRepeat={() => { spokenStep.current = step; speak(script); }}
            onPause={speech.pause}
            onResume={speech.resume}
            onStop={stopSpeech}
          />
        )}
        {speechFailed && !reading && (
          <p role="alert" className="mt-3 text-small text-terracotta-deep">Read aloud stopped because this device couldn't speak the step. The steps are all still here to read.</p>
        )}
        {resumedAt !== null && step === resumedAt && (
          <div role="status" className="mt-3 flex items-center gap-3 rounded-card border border-line bg-surface py-2 pr-2 pl-4">
            <p className="min-w-0 flex-1 text-small text-ink">Picked up where you left off, at step {resumedAt + 1}.</p>
            <Button variant="secondary" className="shrink-0" onClick={startOver}>Start over</Button>
          </div>
        )}
      </header>

      <div className="mx-auto w-full max-w-column flex-1 px-gutter pt-6 pb-6 md:pt-10">
        <button
          type="button"
          onClick={() => setSheet('steps')}
          className="-ml-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 hover:bg-green-soft"
        >
          <span className="label text-ink!" aria-live="polite">Step {step + 1} of {total}</span>
          <span className="sr-only">. Show all steps</span>
          <ChevronDown size={18} strokeWidth={2} aria-hidden className="text-ink-muted" />
        </button>
        <p className="cook-step mt-3 font-medium text-ink">{stepText(step)}</p>
        {current.timers.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-3">
            {current.timers.map(t => <TimerChip key={t.label} timer={t} recipeId={recipe.id} recipeTitle={title} step={step + 1} size="lg" />)}
          </div>
        )}
        <StepIngredients items={usedHere} servings={servings} onMissing={() => openMissing(null)} />
        {error && <p role="alert" className="mt-6 text-body text-terracotta-deep">{error}</p>}
        {timerCount > 0 && <div aria-hidden style={{ height: timerCount * 62 + 24 }} />}
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
      <MissingSheet
        open={sheet === 'missing'}
        start={missingStart}
        ingredients={ingredients}
        raw={recipe.ingredients}
        inStep={usedHere.map(i => i.index)}
        recipeId={recipe.id}
        servings={servings}
        scale={servings / baseServings}
        units={prefs.units}
        prefs={prefs}
        onClose={closeSheet}
      />
      <VariationsSheet open={sheet === 'variations'} recipeId={recipe.id} servings={servings} units={prefs.units} prefs={prefs} onClose={closeSheet} />
      <TextSizeSheet open={sheet === 'text'} value={textSize} onChange={setTextSize} onClose={closeSheet} />
      <StepsSheet
        open={sheet === 'steps'}
        steps={recipe.steps.map((_, i) => stepText(i))}
        current={step}
        onPick={i => { setStep(i); setSheet(null); }}
        onClose={closeSheet}
      />
      <IngredientsSheet
        open={sheet === 'ingredients'}
        items={ingredients}
        checked={checked}
        servings={servings}
        onToggle={toggleChecked}
        onMissing={openMissing}
        onClear={() => setChecked(new Set())}
        onClose={closeSheet}
      />
    </div>
  );
}
