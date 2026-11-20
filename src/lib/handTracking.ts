import type { HandLandmarker, HandLandmarkerOptions } from '@mediapipe/tasks-vision';

// On-device hand tracking for hands-free cooking: MediaPipe's Hand Landmarker running in
// WebAssembly in the page. The model and the WebAssembly files are served by the app
// itself (public/mediapipe), and the library starts loading when cooking mode opens (not
// on other screens), so it's ready when hands-free is turned on. Loading it never touches
// the camera. Frames go from the <video> element straight into the tracker in memory: nothing is
// drawn to a canvas we keep, recorded, stored or sent anywhere.

const BASE = `${import.meta.env.BASE_URL}mediapipe`;

export type Delegate = 'GPU' | 'CPU';
export interface HandTracker { landmarker: HandLandmarker; delegate: Delegate }

const options = (delegate: Delegate): HandLandmarkerOptions => ({
  baseOptions: { modelAssetPath: `${BASE}/hand_landmarker.task`, delegate },
  runningMode: 'VIDEO',
  numHands: 1,
  // A bit stricter than the defaults: a half-seen hand or a hand-like shape in the steam
  // shouldn't be tracked at all.
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

/** A GPU that hasn't produced a tracker by then is treated as unavailable. */
const GPU_START_MS = 8000;

/** The tracker, on the GPU where the browser allows it, else on the CPU. */
export async function createHandTracker(prefer: Delegate = 'GPU'): Promise<HandTracker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  // Picks the SIMD build, or the fallback for browsers without SIMD.
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  if (prefer === 'GPU') {
    const gpu = HandLandmarker.createFromOptions(fileset, options('GPU'));
    const timedOut = new Promise<null>(resolve => setTimeout(() => resolve(null), GPU_START_MS));
    try {
      const landmarker = await Promise.race([gpu, timedOut]);
      if (landmarker) return { landmarker, delegate: 'GPU' };
      // Too slow: go on with the CPU, and release the GPU tracker if it turns up later.
      gpu.then(late => late.close()).catch(() => {});
      console.info('[hands-free] GPU too slow to start, using the CPU');
    } catch (err) {
      console.info('[hands-free] GPU unavailable, using the CPU:', err);
    }
  }
  return { landmarker: await HandLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' };
}

export type HandsFreeSupport = 'ok' | 'insecure' | 'no-camera-api' | 'no-wasm';

/** Whether this browser can do hands-free at all, before asking for anything. */
export function handsFreeSupport(): HandsFreeSupport {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'no-camera-api';
  if (typeof WebAssembly !== 'object') return 'no-wasm';
  return 'ok';
}

/**
 * The front camera at a low resolution and frame rate: enough to follow a hand, easy on the
 * battery. Video only: the microphone is never requested.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 30 } },
};

export type CameraProblem = 'denied' | 'no-camera' | 'busy' | 'failed';

/** What a getUserMedia error means for the person. */
export function cameraProblem(err: unknown): CameraProblem {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}
