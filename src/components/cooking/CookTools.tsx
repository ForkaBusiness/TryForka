import { Check, Pause, Play, RotateCcw, Square, type LucideIcon } from 'lucide-react';
import { BottomSheet, Button, IconButton, cx } from '../ds';
import type { ReadAloudState } from '../../lib/useReadAloud';
import { TEXT_SIZES, type TextSizeId } from '../../lib/cookText';

// The row of tools under the step progress in cooking mode, and the text size sheet.

/** One tool: a large target with its icon over a short label (side by side on wider screens). */
export function ToolButton({ icon: Icon, label, onClick, pressed, detail }: {
  icon: LucideIcon; label: string; onClick: () => void; pressed?: boolean;
  /** Short state shown after the label ("3 of 9"). */
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cx(
        'flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-input border px-2 py-2 text-caption font-semibold',
        'transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-98 sm:flex-row sm:gap-2 sm:text-small',
        pressed ? 'border-green bg-green-soft text-green' : 'border-line bg-surface text-ink hover:border-ink-muted',
      )}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="line-clamp-2 max-w-full text-center leading-tight">
        {label}
        {detail && <span className="tabular font-medium text-ink-muted"> {detail}</span>}
      </span>
    </button>
  );
}

/** Text size choices, applied as soon as one is tapped. */
export function TextSizeSheet({ open, value, onChange, onClose }: { open: boolean; value: TextSizeId; onChange: (id: TextSizeId) => void; onClose: () => void }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Text size"
      side="bottom"
      footer={<div className="flex justify-end"><Button size="lg" className="w-full sm:w-auto" onClick={onClose}>Done</Button></div>}
    >
      <div role="radiogroup" aria-label="Text size" className="flex flex-col gap-2">
        {TEXT_SIZES.map(s => {
          const selected = s.id === value;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-autofocus={selected || undefined}
              onClick={() => onChange(s.id)}
              className={cx(
                'flex min-h-16 cursor-pointer items-center gap-4 rounded-input border px-4 text-left transition-[background-color,border-color] duration-150',
                selected ? 'border-green bg-green-soft' : 'border-line bg-surface hover:border-ink-muted',
              )}
            >
              <span aria-hidden className="w-16 shrink-0 font-semibold text-ink" style={{ fontSize: `${1.125 * s.scale}rem`, lineHeight: 1.1 }}>Aa</span>
              <span className="flex-1 text-body font-medium text-ink">{s.label}</span>
              {selected && <Check size={20} strokeWidth={2.25} aria-hidden className="text-green" />}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-small text-ink-muted">Steps also follow your device's text size. Saved on this device.</p>
    </BottomSheet>
  );
}

/** While read aloud is on: what it's doing, and repeat, pause or resume, and stop. */
export function ReadAloudBar({ state, step, onRepeat, onPause, onResume, onStop }: {
  state: ReadAloudState; step: number; onRepeat: () => void; onPause: () => void; onResume: () => void; onStop: () => void;
}) {
  const text = state === 'speaking' ? `Reading step ${step} aloud` : state === 'paused' ? `Paused on step ${step}` : 'Each step is read as you go';
  return (
    <div role="group" aria-label="Read aloud" className="mt-3 flex min-h-14 items-center gap-1 rounded-card border border-line bg-surface py-1 pr-1.5 pl-4">
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-small font-semibold text-ink">{text}</p>
      <IconButton icon={RotateCcw} label="Repeat this step" onClick={onRepeat} />
      {state === 'speaking' && <IconButton icon={Pause} label="Pause reading" onClick={onPause} />}
      {state === 'paused' && <IconButton icon={Play} label="Resume reading" onClick={onResume} />}
      {state !== 'idle' && <IconButton icon={Square} label="Stop reading" onClick={onStop} />}
    </div>
  );
}
