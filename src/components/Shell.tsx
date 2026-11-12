import React from 'react';
import { cx } from './ds';
import { NAV_ITEMS, type NavId } from './nav';

// App frame: one scrolling content area with the tab bar floating over it. The same
// frame at every width; on desktop the content sits in a centered column and the tab
// bar stays a pill.

/** The Forka mark and name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <img src={`${import.meta.env.BASE_URL}forka-logo.png`} alt="" className="size-9 shrink-0 rounded-sm object-cover" />
      <span className="font-wordmark text-heading font-bold tracking-tight text-ink">Forka</span>
    </div>
  );
}

/** Glass pill floating over the content, with labeled icons. */
export function BottomTabBar({ active, onSelect }: { active: NavId | null; onSelect: (id: NavId) => void }) {
  return (
    <nav aria-label="Main" className="glass-strong fixed inset-x-4 bottom-(--tabbar-bottom) z-40 mx-auto flex h-(--tabbar-height) max-w-tabbar gap-1 rounded-full p-1.5">
      {NAV_ITEMS.map(item => {
        const isActive = active === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={cx(
              'flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full text-caption transition-[transform,background-color] duration-150 ease-spring active:scale-98',
              isActive ? 'bg-surface font-bold text-green-deep shadow-sm' : 'font-semibold text-ink',
            )}
          >
            <Icon size={22} strokeWidth={isActive ? 2 : 1.75} aria-hidden />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Scrolling content with the tab bar (when shown) floating over its bottom edge. */
export function AppFrame({ active, onSelect, showNav, showBrand, children, mainRef, overlay }: {
  active: NavId | null;
  onSelect: (id: NavId) => void;
  /** False on screens with their own bottom action bar, and in cooking mode. */
  showNav: boolean;
  /** The wordmark in the corner on wide screens. False in cooking mode. */
  showBrand: boolean;
  children: React.ReactNode;
  mainRef?: React.Ref<HTMLElement>;
  overlay?: React.ReactNode;
}) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-cream">
      <main ref={mainRef} className={cx('relative h-full overflow-y-auto', showNav && 'pb-(--tabbar-space)')}>
        {children}
      </main>
      {showBrand && <Wordmark className="pointer-events-none fixed top-8 left-8 hidden xl:flex" />}
      {showNav && <BottomTabBar active={active} onSelect={onSelect} />}
      {overlay}
    </div>
  );
}
