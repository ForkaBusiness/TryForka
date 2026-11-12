import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { ICON_PROPS } from './icon';

// Buttons. Sentence-case labels that say what happens ("Add to week", "Start cooking").
// Primary is the glaze, and there is one per screen. Secondary is matte with a line
// border. Ghost is text only. Sizes: lg 52px (bottom bars), md 44px, sm 36px (inline).

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type Size = 'lg' | 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'glaze',
  secondary: 'border border-line bg-surface text-ink shadow-sm hover:border-ink-muted active:scale-98 active:bg-cream disabled:text-ink-muted disabled:shadow-none',
  ghost: 'text-green hover:bg-green-soft active:scale-98 disabled:text-ink-muted',
  danger: 'bg-terracotta-deep text-surface shadow-sm hover:bg-terracotta-deep/90 active:scale-98 disabled:bg-line disabled:text-ink-muted disabled:shadow-none',
  'danger-ghost': 'text-terracotta-deep hover:bg-terracotta-soft active:scale-98 disabled:text-ink-muted',
};
const SIZES: Record<Size, string> = {
  lg: 'h-13 px-6 text-body gap-2',
  md: 'h-11 px-5 text-body gap-2',
  sm: 'h-9 px-4 text-small gap-1.5',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Icon after the label instead of before. */
  iconEnd?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconEnd: IconEnd, loading, block, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap select-none',
        'transition-[transform,background-color,border-color,box-shadow] duration-150 ease-spring disabled:cursor-not-allowed',
        VARIANTS[variant], SIZES[size], block && 'w-full', className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : Icon && <Icon {...ICON_PROPS} size={size === 'sm' ? 18 : 20} />}
      {children}
      {IconEnd && <IconEnd {...ICON_PROPS} size={size === 'sm' ? 18 : 20} />}
    </button>
  );
});

const ICON_SIZES = { sm: 'size-9', md: 'size-11', lg: 'size-12' } as const;

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name; required because there's no visible text. */
  label: string;
  /** Plain sits on the page; outlined is a matte disc (the back button). */
  variant?: 'plain' | 'outlined';
  size?: keyof typeof ICON_SIZES;
  pressed?: boolean;
}

export function IconButton({ icon: Icon, label, variant = 'plain', size = 'md', pressed, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-ink transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-98 disabled:cursor-not-allowed',
        variant === 'plain' && 'hover:bg-green-soft',
        variant === 'outlined' && 'border border-line bg-surface shadow-sm hover:border-ink-muted',
        ICON_SIZES[size], className,
      )}
      {...rest}
    >
      <Icon {...ICON_PROPS} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  );
}
