// Which size each card takes in the recipe carousel. Pure, so it can be tested.

export type CardSize = 'active' | 'medium' | 'strip' | 'hidden';

const VISIBLE = 4;

/**
 * Four cards show at once. The next card in the swipe direction is medium, the rest of
 * the window are strips, and cards outside it are hidden: going forward that reads
 * strip, active, medium, strip; going back, strip, medium, active, strip.
 */
export function cardSizes(count: number, active: number, direction: 1 | -1): CardSize[] {
  const start = Math.max(0, Math.min(direction > 0 ? active - 1 : active - 2, count - VISIBLE));
  const ahead = active + direction;
  const medium = ahead >= 0 && ahead < count ? ahead : active - direction;
  return Array.from({ length: count }, (_, i) => {
    if (i === active) return 'active';
    if (i < start || i >= start + VISIBLE) return 'hidden';
    return i === medium ? 'medium' : 'strip';
  });
}
