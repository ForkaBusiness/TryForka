// Text size in cooking mode: the cook's own choice (remembered on this device) times the
// device's text size setting. Pure, tested in tests/cookText.test.ts.

export interface TextSize { id: TextSizeId; label: string; scale: number }
export type TextSizeId = 'default' | 'large' | 'larger' | 'largest';

/** Default plus three steps up. */
export const TEXT_SIZES: readonly TextSize[] = [
  { id: 'default', label: 'Default', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.2 },
  { id: 'larger', label: 'Larger', scale: 1.4 },
  { id: 'largest', label: 'Largest', scale: 1.65 },
];

const KEY = 'forka_cook_text_size';

export function loadTextSize(storage: Pick<Storage, 'getItem'> | null): TextSizeId {
  try {
    const v = storage?.getItem(KEY);
    return TEXT_SIZES.some(s => s.id === v) ? (v as TextSizeId) : 'default';
  } catch { return 'default'; }
}

export function saveTextSize(storage: Pick<Storage, 'setItem'> | null, id: TextSizeId): void {
  try { storage?.setItem(KEY, id); } catch { /* this visit only */ }
}

/** iOS's body text is 17px at the default Dynamic Type size. */
export const IOS_BODY_PX = 17;

/**
 * The device's text size as a multiplier, from the size iOS gives its body text style
 * (`font: -apple-system-body`). Elsewhere the browser's own text size already scales the
 * app's rem-based type, so this is 1. Kept between 0.85 and 2 so the step still fits.
 */
export function systemTextScale(bodyPx: number | null): number {
  if (!bodyPx || !Number.isFinite(bodyPx)) return 1;
  return Math.min(2, Math.max(0.85, bodyPx / IOS_BODY_PX));
}

/** The multiplier cooking mode's text uses: the chosen size times the device's, rounded. */
export function cookScale(id: TextSizeId, system: number): number {
  const chosen = TEXT_SIZES.find(s => s.id === id)?.scale ?? 1;
  return Math.round(chosen * system * 100) / 100;
}
