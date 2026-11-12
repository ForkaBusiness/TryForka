import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';

// A floating layer: a bottom sheet on phones. On desktop it's a side panel (side="auto",
// for longer tasks like Suggestions) or a centered card (side="bottom", for short menus
// and confirmations). Slides in when opened; Escape and the backdrop close it; focus
// moves into it. Matte, like every sheet.

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the visible title (still used as the accessible name). */
  hideTitle?: boolean;
  side?: 'auto' | 'bottom';
  children: React.ReactNode;
  /** Pinned under the scrolling content: the sheet's primary action or its input bar. */
  footer?: React.ReactNode;
  role?: 'dialog' | 'alertdialog';
}

export function BottomSheet({ open, onClose, title, hideTitle, side = 'auto', children, footer, role = 'dialog' }: BottomSheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? panel.current?.querySelector<HTMLElement>('input, textarea, button:not([data-close])');
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
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade bg-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'absolute inset-x-0 bottom-0 flex max-h-(--sheet-max) animate-sheet-up flex-col rounded-t-sheet bg-surface shadow-lg outline-none',
          side === 'auto'
            ? 'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-full md:max-w-sheet md:animate-sheet-left md:rounded-tr-none md:rounded-bl-sheet'
            : 'md:bottom-8 md:mx-auto md:max-w-dialog md:rounded-sheet',
        )}
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line md:hidden" />
        <div className="flex items-center gap-2 px-gutter pt-2 pb-2 md:pt-5">
          <h2 className={cx('flex-1 text-heading text-ink', hideTitle && 'sr-only')}>{title}</h2>
          {hideTitle && <span className="flex-1" />}
          <IconButton icon={X} label="Close" onClick={onClose} data-close className="-mr-2" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-gutter pb-5">{children}</div>
        {footer && <div className="border-t border-line px-gutter pt-3 pb-(--bottombar-pad)">{footer}</div>}
      </div>
    </div>
  );
}
