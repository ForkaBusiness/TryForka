// Keeps the screen on while cooking mode is open (Screen Wake Lock API, in iOS Safari
// since 16.4). The browser drops the lock whenever the page is hidden, so it is taken
// again each time the page becomes visible, and let go when cooking mode closes.
// No imports and no globals of its own, so tests/wakeLock.test.ts drives it with fakes.

export type WakeLockStatus = 'starting' | 'on' | 'off' | 'unsupported' | 'denied';

export interface WakeSentinel {
  released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}
export interface WakeLockApi { request(type: 'screen'): Promise<WakeSentinel> }
export interface VisibilitySource {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Holds the screen awake until the returned stop function is called. `onStatus` hears
 * 'unsupported' when there is no API, 'denied' when the device refuses (battery saver,
 * an old iOS home screen app), 'on' while held and 'off' while the page is hidden.
 */
export function keepScreenOn(api: WakeLockApi | undefined, doc: VisibilitySource, onStatus: (status: WakeLockStatus) => void): () => void {
  if (!api) {
    onStatus('unsupported');
    return () => {};
  }
  let lock: WakeSentinel | null = null;
  let asking = false;
  let stopped = false;

  const acquire = async () => {
    if (stopped || asking || doc.visibilityState !== 'visible' || (lock && !lock.released)) return;
    asking = true;
    try {
      const sentinel = await api.request('screen');
      if (stopped) { void sentinel.release().catch(() => {}); return; }
      lock = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (lock === sentinel) lock = null;
        if (!stopped) onStatus('off');
      });
      onStatus('on');
    } catch {
      if (!stopped) onStatus('denied');
    } finally {
      asking = false;
    }
  };
  const onVisibility = () => { if (doc.visibilityState === 'visible') void acquire(); };

  onStatus('starting');
  void acquire();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisibility);
    const held = lock;
    lock = null;
    void held?.release().catch(() => {});
  };
}

const TIP_KEY = 'forka_wake_lock_tip_seen';

/** Whether the "screen may dim" tip has been shown on this device. */
export function wakeTipSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(TIP_KEY) === '1'; } catch { return false; }
}
export function markWakeTipSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(TIP_KEY, '1'); } catch { /* shown again next time */ }
}
