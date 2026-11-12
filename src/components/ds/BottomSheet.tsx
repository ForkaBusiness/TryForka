import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';

// A floating layer: a bottom sheet on phones, a side panel on desktop (side="auto"),
// or always a bottom sheet (side="bottom", for short menus and confirmations).
// Slides in when opened; Escape and the backdrop close it; focus moves into it.

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the visible title (still used as the accessible name). */
  hideTitle?: boolean;
  side?: 'auto' | 'bottom';
  children: React.ReactNode;
  footer?: React.ReactNode;
  role?: 'dialog' | 'alertdialog';
}

export function Sheet({ open, onClose, title, hideTitle, side = 'auto', children, footer, role = 'dialog' }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])');
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const firstEl = items[0], lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restore.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const right = side === 'auto';
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'absolute flex flex-col bg-surface shadow-float outline-none',
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet animate-sheet-up',
          right && 'md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:h-full md:max-h-none md:w-[440px] md:rounded-none md:animate-sheet-left',
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 md:px-6 md:pt-5">
          <h2 className={cx('flex-1 text-xl text-ink', hideTitle && 'sr-only')}>{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} data-close className="-mr-2" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-6">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] md:px-6">{footer}</div>}
      </div>
    </div>
  );
}
