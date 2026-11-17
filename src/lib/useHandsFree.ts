import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_CONSTRAINTS, cameraProblem, createHandTracker, handsFreeSupport, type CameraProblem, type HandTracker } from './handTracking';
import { initialSwipeState, palmFromLandmarks, stepSwipe, type Swipe } from './swipe';

// Runs the camera and the hand tracker while hands-free is on, and reports swipes.
//
// The camera is on only while `enabled` is true and the tab is visible: it stops when the
// toggle goes off, when the tab is hidden (and starts again on return), and when the
// component using this unmounts (leaving cooking mode). Frames are read from the video
// element by the tracker in memory and dropped; nothing is recorded, stored or sent.

export type HandsFreeStatus = 'off' | 'starting' | 'on' | 'paused' | 'unsupported' | 'interrupted' | CameraProblem;

/** Every frame of the 15 fps camera, at most about 16 a second: plenty to follow a wave, easy on the battery. */
const FRAME_MS = 60;
/** Starting (camera, download, tracker) that takes longer than this is given up, not left spinning. */
const START_LIMIT_MS = 30_000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** `onSwipe` returns false when it ignored the swipe, so no feedback is shown for it. */
export function useHandsFree(enabled: boolean, onSwipe: (swipe: Swipe) => boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<HandsFreeStatus>('off');
  const [handSeen, setHandSeen] = useState(false);
  const [lastSwipe, setLastSwipe] = useState<{ swipe: Swipe; at: number } | null>(null);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const tracker = useRef<Promise<HandTracker> | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // The tracker is loaded once per visit to cooking mode and closed on the way out.
  useEffect(() => () => {
    void tracker.current?.then(t => t.landmarker.close()).catch(() => {});
    tracker.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) { setStatus('off'); setHandSeen(false); return; }
    if (handsFreeSupport() !== 'ok') { setStatus('unsupported'); return; }
    if (!visible) { setStatus('paused'); setHandSeen(false); return; }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let frameHandle: number | null = null;
    let usesVideoCallback = false;
    const video = videoRef.current as VideoWithFrameCallback | null;

    const stopCamera = () => {
      if (frameHandle !== null) {
        if (usesVideoCallback && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
        else cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
      const mine = stream;
      stream = null;
      mine?.getTracks().forEach(track => track.stop());
      // Only this run's stream: a newer run may already be showing its own on this video.
      if (video && mine && video.srcObject === mine) video.srcObject = null;
    };

    // A start that never finishes (a stuck download, a GPU that never answers) ends here.
    const giveUp = window.setTimeout(() => {
      if (cancelled || frameHandle !== null) return;
      cancelled = true;
      console.error('[hands-free] could not start in time');
      stopCamera();
      setStatus('failed');
    }, START_LIMIT_MS);

    (async () => {
      setStatus('starting');
      if (!video) { setStatus('failed'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch (err) {
        if (!cancelled) setStatus(cameraProblem(err));
        return;
      }
      if (cancelled) { stopCamera(); return; }
      // The camera can be taken away while it runs: ended (revoked, or another app took it)
      // turns hands-free off and says so; muted (iOS during a phone call) pauses it.
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        if (cancelled) return;
        cancelled = true;
        stopCamera();
        setStatus('interrupted');
      });
      track?.addEventListener('mute', () => { if (!cancelled && frameHandle !== null) setStatus('paused'); });
      track?.addEventListener('unmute', () => { if (!cancelled && frameHandle !== null) setStatus('on'); });
      // iOS Safari: the video must be inline and muted to play without going full screen.
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        stopCamera();
        if (cancelled) return; // switched off while starting: not a failure
        console.error('[hands-free] the camera preview would not play:', err);
        setStatus('failed');
        return;
      }
      let current: HandTracker;
      try {
        tracker.current ??= createHandTracker();
        current = await tracker.current;
      } catch (err) {
        console.error('[hands-free] could not start the tracker:', err);
        tracker.current = null; // the tracker itself failed: try afresh next time
        stopCamera();
        if (!cancelled) setStatus('failed');
        return;
      }
      if (cancelled) { stopCamera(); return; }
      window.clearTimeout(giveUp);
      setStatus('on');

      let swipeState = initialSwipeState();
      let lastFrame = 0;
      let seen = false;
      let fellBack = current.delegate === 'CPU';
      usesVideoCallback = typeof video.requestVideoFrameCallback === 'function';
      const schedule = () => {
        frameHandle = usesVideoCallback ? video.requestVideoFrameCallback!(tick) : requestAnimationFrame(tick);
      };
      const tick = () => {
        if (cancelled || !stream) return;
        const now = performance.now();
        if (now - lastFrame >= FRAME_MS && video.readyState >= 2) {
          lastFrame = now;
          try {
            const result = current.landmarker.detectForVideo(video, now);
            const palm = palmFromLandmarks(result.landmarks);
            if (!!palm !== seen) { seen = !!palm; setHandSeen(seen); }
            const step = stepSwipe(swipeState, { t: now, x: palm?.x ?? null, y: palm?.y ?? null });
            swipeState = step.state;
            if (step.swipe && onSwipeRef.current(step.swipe)) setLastSwipe({ swipe: step.swipe, at: now });
          } catch (err) {
            // Some GPUs accept the tracker and then fail on the first frame: move to the CPU once.
            if (!fellBack) {
              fellBack = true;
              console.info('[hands-free] GPU failed while tracking, using the CPU:', err);
              current.landmarker.close();
              tracker.current = createHandTracker('CPU');
              tracker.current.then(t => { current = t; if (!cancelled) schedule(); }).catch(() => { tracker.current = null; if (!cancelled) { stopCamera(); setStatus('failed'); } });
              return;
            }
            console.error('[hands-free] tracking failed:', err);
            stopCamera();
            if (!cancelled) setStatus('failed');
            return;
          }
        }
        schedule();
      };
      schedule();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
      stopCamera();
      setHandSeen(false);
    };
  }, [enabled, visible]);

  const clearSwipe = useCallback(() => setLastSwipe(null), []);
  return { videoRef, status, handSeen, lastSwipe, clearSwipe };
}
