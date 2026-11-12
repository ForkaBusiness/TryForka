import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { ICON_PROPS } from './icon';

// Glass: only for things that float over a photo or over scrolling content. Never used
// inside long scrolling lists (backdrop blur is slow on older phones); recipe grids use
// matte discs instead.

export interface GlassIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
}

/** A round control floating on a photo (back, favorite). */
export function GlassIconButton({ icon: Icon, label, pressed, className, ...rest }: GlassIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        'glass inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 ease-spring active:scale-98',
        pressed && '[&_svg]:fill-green [&_svg]:text-green',
        className,
      )}
      {...rest}
    >
      <Icon {...ICON_PROPS} />
    </button>
  );
}

/** A small tag sitting on a photo ("25 min", "Italian"). */
export function GlassPill({ icon: Icon, children, className }: { icon?: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('glass inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-small font-semibold whitespace-nowrap', className)}>
      {Icon && <Icon {...ICON_PROPS} size={16} />}
      {children}
    </span>
  );
}
