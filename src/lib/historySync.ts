// The phone's Back (Android's back button or gesture, a browser's Back, an iPhone swipe from
// the edge) steps back one screen, as the app's own back arrow does, instead of leaving Forka.
//
// The app keeps its own stack of screens. The browser history mirrors only its depth: one
// entry per screen, each marked with its depth, all at the same address. The app's stack stays
// the source of truth:
//   - a screen opens: the history gains an entry;
//   - the app steps back (its back arrow, a tab, a screen closing itself): the history steps
//     back by the same amount, and the resulting popstate is ignored;
//   - the household presses Back: the app's stack is cut to that entry's depth.
// An entry the app didn't write (the page before Forka) is left alone, so Back from the first
// screen leaves the app, as it should.

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  replaceState(data: unknown, unused: string): void;
  go(delta: number): void;
}

const KEY = 'forkaDepth';

/** The depth the app wrote into a history entry, or null for an entry that isn't the app's. */
export function depthOf(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const d = (state as Record<string, unknown>)[KEY];
  return typeof d === 'number' && Number.isInteger(d) && d >= 1 ? d : null;
}

/** A history entry's state with the app's depth added, keeping whatever else it holds. */
export function withDepth(state: unknown, depth: number): Record<string, unknown> {
  return { ...(state && typeof state === 'object' ? (state as Record<string, unknown>) : {}), [KEY]: depth };
}

export interface HistorySync {
  /** After every change to the app's stack. */
  sync(stackLength: number): void;
  /** On popstate, with the event's state. */
  popped(state: unknown): void;
}

/** `onBack(depth)`: cut the app's stack to `depth` screens (at least 1). */
export function createHistorySync(history: HistoryLike, onBack: (depth: number) => void): HistorySync {
  let depth = 1;
  // popstates the app caused itself, to be ignored when they arrive.
  let pending = 0;
  const start = depthOf(history.state);
  if (start !== null && start > 1) {
    // A reload (or signing in again) on a deeper screen: the app starts over at its first
    // screen, so step the history back to that screen's entry. The entries left after it are
    // only reachable by Forward, which is undone below; otherwise the first Back would land on
    // one of them and seem to do nothing.
    pending++;
    history.go(1 - start);
  } else {
    history.replaceState(withDepth(history.state, 1), '');
  }

  return {
    sync(stackLength) {
      const target = Math.max(1, stackLength);
      if (target > depth) {
        for (let d = depth + 1; d <= target; d++) history.pushState(withDepth(null, d), '');
        depth = target;
      } else if (target < depth) {
        pending++;
        history.go(target - depth);
        depth = target;
      }
    },
    popped(state) {
      if (pending > 0) { pending--; return; }
      const d = depthOf(state);
      // Left the app's entries: the browser is leaving Forka.
      if (d === null) return;
      if (d < depth) {
        depth = d;
        onBack(d);
      } else if (d > depth) {
        // Forward, onto a screen that's already closed (or an entry left from before a
        // reload). Screens can't be reopened from history, so go back to where the app is.
        pending++;
        history.go(depth - d);
      }
    },
  };
}
