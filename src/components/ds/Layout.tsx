import React from 'react';
import { ArrowLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';
import { ICON_PROPS } from './icon';

// Page structure shared by every screen: a centered column, a serif title, and one
// bottom-anchored place for the primary action.

/** Back button top left, optional actions top right. */
export function TopBar({ onBack, backLabel = 'Back', children, className }: { onBack?: () => void; backLabel?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-11 items-center gap-2', className)}>
      {onBack && <IconButton icon={ArrowLeft} label={backLabel} variant="outlined" onClick={onBack} />}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export interface PageContainerProps {
  title?: React.ReactNode;
  /** Shows a back button above the title. */
  onBack?: () => void;
  backLabel?: string;
  /** Right side of the top row (text buttons, icons, save status). */
  actions?: React.ReactNode;
  /** Line under the title. */
  intro?: React.ReactNode;
  children: React.ReactNode;
  /** Sticky action bar at the bottom of the content column. */
  bottomBar?: React.ReactNode;
  /** A wider column, for recipe grids. */
  wide?: boolean;
  className?: string;
}

/** Centered column with a serif title. Tab screens get the large title; pushed screens a back button and a smaller one. */
export function PageContainer({ title, onBack, backLabel, actions, intro, children, bottomBar, wide, className }: PageContainerProps) {
  return (
    <div className="flex min-h-full flex-col">
      <div className={cx('mx-auto w-full flex-1 px-gutter pt-(--screen-top) pb-10 md:pt-12', wide ? 'max-w-wide' : 'max-w-column', className)}>
        {onBack && <TopBar onBack={onBack} backLabel={backLabel} className="mb-4">{actions}</TopBar>}
        {(title || (actions && !onBack)) && (
          <header className="mb-6">
            <div className="flex items-start justify-between gap-4">
              {title && <h1 className={cx('display min-w-0 text-ink', onBack ? 'text-title md:text-display' : 'text-display')}>{title}</h1>}
              {actions && !onBack && <div className="flex min-h-10 shrink-0 items-center gap-2">{actions}</div>}
            </div>
            {intro && <div className="mt-1 text-body text-ink-muted">{intro}</div>}
          </header>
        )}
        {children}
      </div>
      {bottomBar && <BottomBar wide={wide}>{bottomBar}</BottomBar>}
    </div>
  );
}

/** The primary action's home: stuck to the bottom of the screen, content fading out beneath it. */
export function BottomBar({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="sticky bottom-0 z-10 w-full bg-linear-to-t from-cream from-75% to-cream/0">
      <div className={cx('mx-auto flex w-full gap-3 px-gutter pt-5 pb-(--bottombar-pad)', wide ? 'max-w-wide' : 'max-w-column')}>{children}</div>
    </div>
  );
}

/** Matte surface with the card radius. */
export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-card border border-line bg-surface shadow-sm', className)} {...rest}>{children}</div>;
}

/** A card of rows separated by hairlines, with an optional small label above. */
export function ListGroup({ label, labelId, children, className }: { label?: string; labelId?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <p id={labelId} className="label mb-2 px-1">{label}</p>}
      <Card className="divide-y divide-line overflow-hidden">{children}</Card>
    </div>
  );
}

export function SectionHeading({ children, action, id }: { children: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 id={id} className="text-heading text-ink">{children}</h2>
      {action}
    </div>
  );
}

export interface ListRowProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Show a chevron for rows that open something. */
  chevron?: boolean;
  /** Terracotta title, for the one destructive row. */
  destructive?: boolean;
  className?: string;
}

/** One row in a ListGroup. Clickable rows are buttons. */
export function ListRow({ leading, title, subtitle, trailing, onClick, chevron, destructive, className }: ListRowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-left">
        <span className={cx('block text-body font-medium', destructive ? 'text-terracotta-deep' : 'text-ink')}>{title}</span>
        {subtitle && <span className="block text-small text-ink-muted">{subtitle}</span>}
      </span>
      {trailing}
      {chevron && <ChevronRight {...ICON_PROPS} className="shrink-0 text-ink-muted" />}
    </>
  );
  const base = cx('flex min-h-14 w-full items-center gap-3 px-4 py-3', className);
  return onClick
    ? <button type="button" onClick={onClick} className={cx(base, 'cursor-pointer transition-colors duration-150 hover:bg-cream/70 active:bg-cream')}>{body}</button>
    : <div className={base}>{body}</div>;
}

/** What a screen shows when there's nothing in it yet: what goes here, and the one thing to do about it. */
export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-6">
      {Icon && (
        <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-green-soft text-green">
          <Icon size={24} strokeWidth={1.75} />
        </span>
      )}
      <h2 className="text-heading text-ink">{title}</h2>
      {children && <p className="mt-1 max-w-prose text-body text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-green transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Quiet status text ("Saved", "Saving…", errors). */
export function SaveStatus({ state, error }: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string }) {
  return (
    <span role="status" aria-live="polite" className={cx('text-small', state === 'error' ? 'text-terracotta-deep' : 'text-ink-muted')}>
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? (error ?? "Couldn't save. Check your connection.") : ''}
    </span>
  );
}

/** A still placeholder in the shape of what's loading. No shimmer: nothing in the app loops. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('rounded-photo bg-line/70', className)} />;
}

/** Placeholder rows for a ListGroup that's loading. */
export function ListSkeleton({ rows = 4, leading }: { rows?: number; leading?: boolean }) {
  return (
    <Card aria-hidden className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
          {leading && <Skeleton className="size-12 shrink-0" />}
          <div className="flex-1"><Skeleton className="h-4 w-1/2 rounded-full" /><Skeleton className="mt-2 h-3 w-1/3 rounded-full" /></div>
        </div>
      ))}
    </Card>
  );
}
