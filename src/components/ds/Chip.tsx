import React from 'react';
import { Check, X, type LucideIcon } from 'lucide-react';
import { cx } from './cx';

// Fully rounded and matte: tags (static info), toggle chips (multi-select), filter chips
// (single-select), chip buttons (prompts).

export function Tag({ children, tone = 'neutral', size = 'md', icon: Icon, className }: {
  children: React.ReactNode; tone?: 'neutral' | 'green' | 'alert'; size?: 'md' | 'sm'; icon?: LucideIcon; className?: string;
}) {
  return (
    <span className={cx(
      'inline-flex items-center rounded-full whitespace-nowrap',
      size === 'md' ? 'h-7 gap-1.5 px-3 text-small font-medium' : 'h-6 gap-1 px-2 text-caption font-semibold',
      tone === 'neutral' && 'border border-line bg-surface text-ink-muted',
      tone === 'green' && 'bg-green-soft text-green',
      tone === 'alert' && 'bg-terracotta-soft text-terracotta-deep',
      className,
    )}>
      {Icon && <Icon size={size === 'md' ? 16 : 14} strokeWidth={1.75} aria-hidden />}
      {children}
    </span>
  );
}

export interface ToggleChipProps {
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Single-choice chips (filters) use radio semantics instead of pressed buttons. */
  role?: 'radio';
}

export function ToggleChip({ selected, onToggle, children, role }: ToggleChipProps) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : selected}
      aria-checked={role ? selected : undefined}
      onClick={onToggle}
      className={cx(
        'inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-body font-medium whitespace-nowrap transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-98',
        selected ? 'border-green bg-green-soft text-green' : 'border-line bg-surface text-ink hover:border-ink-muted',
      )}
    >
      {selected && !role && <Check size={16} strokeWidth={2.25} aria-hidden className="animate-check" />}
      {children}
    </button>
  );
}

/** A removable tag for free-text lists ("mushrooms", "olives"). */
export function RemovableTag({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-surface pr-1 pl-3 text-body text-ink">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
      >
        <X size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

/** A chip that does something when tapped (starter prompts), not a toggle. */
export function ChipButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 shrink-0 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-body font-medium whitespace-nowrap text-ink transition-[transform,border-color] duration-150 ease-spring hover:border-ink-muted active:scale-98"
    >
      {children}
    </button>
  );
}
