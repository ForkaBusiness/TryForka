import { Check, type LucideIcon } from 'lucide-react';
import { BottomSheet, Button, cx } from '../ds';
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
      <span className="max-w-full truncate">
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
