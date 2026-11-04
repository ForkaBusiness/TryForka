import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { minutesLabel, photo, recipeMeta, recipeTitle, type RecipeCard } from '../lib/catalog';
import { cardSizes, type CardSize } from '../lib/carouselLayout';
import { useMediaQuery } from '../lib/useMediaQuery';
import { cx, IconButton } from './ds';

// Expanding photo cards for picking a recipe for one meal slot. Swipe, arrow keys or a
// tap on a side card moves the active card; only a tap on the active card or its Select
// button chooses it. Only flex values animate, so a drag never touches layout.
// Every recipe passed in must already have passed the recipe filter.

const SWIPE_PX = 40;
const FLICK_PX_PER_MS = 0.3;
const FLICK_MIN_PX = 12;
/** Movement under this is a tap, not a drag. */
const TAP_SLOP_PX = 8;
const DRAG_FOLLOW = 0.2;

const SIZE_CLASS: Record<CardSize, string> = {
  active: 'grow-[55] basis-0',
  medium: 'grow-[30] basis-0',
  strip: 'grow-0 shrink-0 basis-8',
  // The negative margin cancels the row's gap, so hidden cards take up no space.
  hidden: 'grow-0 shrink-0 basis-0 -mr-2 opacity-0',
};

export interface RecipeCarouselProps {
  recipes: RecipeCard[];
  selectedId?: number | null;
  onSelect: (recipe: RecipeCard) => void;
  /** Adds a "View recipe" link for the active card. */
  onOpen?: (recipe: RecipeCard) => void;
  /** A line under the row for the active card (e.g. why it was suggested). */
  caption?: (recipe: RecipeCard) => ReactNode;
  label?: string;
}

interface Gesture { x: number; y: number; t: number; axis: 'x' | 'y' | null }

export function RecipeCarousel({ recipes, selectedId, onSelect, onOpen, caption, label = 'Recipe options' }: RecipeCarouselProps) {
  const count = recipes.length;
  const [activeIndex, setActive] = useState(() => Math.max(0, recipes.findIndex(r => r.id === selectedId)));
  const [direction, setDirection] = useState<1 | -1>(1);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const row = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  /** Set once a pointer moves, so the click that ends a swipe can't select anything. */
  const moved = useRef(false);
  const active = Math.min(activeIndex, count - 1);

  useEffect(() => { if (activeIndex >= count) setActive(Math.max(0, count - 1)); }, [activeIndex, count]);

  if (!count) return null;
  const current = recipes[active];
  const sizes = cardSizes(count, active, direction);

  const moveTo = (i: number) => {
    if (i < 0 || i >= count || i === active) return;
    setDirection(i > active ? 1 : -1);
    setActive(i);
  };

  const settle = () => {
    gesture.current = null;
    if (!row.current) return;
    row.current.style.transition = 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)';
    row.current.style.transform = '';
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    moved.current = false;
    gesture.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null };
    if (row.current) row.current.style.transition = '';
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_SLOP_PX) return;
      moved.current = true;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      // Vertical: leave it to the page (touch-action: pan-y) and stop tracking.
      if (g.axis === 'y') { gesture.current = null; return; }
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!reduceMotion && row.current) row.current.style.transform = `translate3d(${dx * DRAG_FOLLOW}px, 0, 0)`;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const speed = Math.abs(dx) / Math.max(1, e.timeStamp - g.t);
    const swiped = g.axis === 'x' && (Math.abs(dx) >= SWIPE_PX || (speed >= FLICK_PX_PER_MS && Math.abs(dx) >= FLICK_MIN_PX));
    settle();
    if (swiped) moveTo(active + (dx < 0 ? 1 : -1));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      moveTo(active + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      onSelect(current);
    }
  };

  const tapCard = (i: number) => (i === active ? onSelect(recipes[i]) : moveTo(i));
  const activeMeta = [minutesLabel(current.total_minutes), recipeMeta(current)].filter(Boolean).join(' · ');
  const note = caption?.(current);

  return (
    <section role="group" aria-roledescription="carousel" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} className="rounded-[24px]">
      <div className="overflow-hidden">
        <div
          ref={row}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={settle}
          onClickCapture={e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); } }}
          className="flex h-80 touch-pan-y gap-2 select-none"
        >
          {recipes.map((r, i) => {
            const size = sizes[i];
            const title = recipeTitle(r);
            const selected = r.id === selectedId;
            const near = Math.abs(i - active) <= 1;
            return (
              <article
                key={r.id}
                aria-roledescription="slide"
                aria-label={`${title}, ${i + 1} of ${count}`}
                aria-hidden={size === 'hidden' || undefined}
                inert={size === 'hidden'}
                className={cx(
                  'relative min-w-0 overflow-hidden rounded-[24px] bg-line/60',
                  'transition-[flex-grow,flex-basis,margin,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                  SIZE_CLASS[size],
                )}
              >
                {r.thumb_url && (
                  <img src={photo(r.thumb_url, 'medium')} alt="" draggable={false} loading={near ? 'eager' : 'lazy'}
                    className="absolute inset-0 size-full object-cover object-center" />
                )}
                <span aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0) 65%)' }} />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => tapCard(i)}
                  aria-label={i === active ? `Select ${title}` : `Show ${title}`}
                  className="absolute inset-0 cursor-pointer outline-none"
                />
                <div className={cx(
                  'pointer-events-none absolute inset-x-0 bottom-0 transition-opacity',
                  size === 'active' ? 'p-4' : 'p-3',
                  size === 'active' || size === 'medium' ? 'opacity-100 delay-150 duration-200' : 'opacity-0 duration-100',
                )}>
                  <p className={cx('line-clamp-3 font-display font-semibold tracking-[-0.01em] hyphens-auto text-surface', size === 'active' ? 'text-lg' : 'text-xs')}>{title}</p>
                  {size === 'active' && activeMeta && <p className="mt-1 truncate text-sm text-surface">{activeMeta}</p>}
                  {size === 'active' && (
                    <button
                      type="button"
                      onClick={() => onSelect(r)}
                      aria-label={selected ? `${title} is selected` : `Select ${title}`}
                      className={cx(
                        'pointer-events-auto mt-3 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold',
                        selected ? 'bg-basil text-surface' : 'bg-surface text-ink',
                      )}
                    >
                      {selected && <Check size={16} strokeWidth={2.25} aria-hidden />}
                      {selected ? 'Selected' : 'Select'}
                    </button>
                  )}
                </div>
                {selected && (
                  <>
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[24px] ring-[3px] ring-basil ring-inset" />
                    <span aria-hidden className={cx('pointer-events-none absolute top-3 right-3 flex size-7 items-center justify-center rounded-full bg-basil text-surface transition-opacity', size === 'active' || size === 'medium' ? 'opacity-100' : 'opacity-0')}>
                      <Check size={16} strokeWidth={2.5} />
                    </span>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <span className="hidden md:block">
          <IconButton icon={ChevronLeft} label="Previous recipe" size={36} disabled={active === 0} onClick={() => moveTo(active - 1)} className="disabled:opacity-40" />
        </span>
        <div aria-hidden className="flex items-center gap-1.5">
          {recipes.map((r, i) => (
            <span key={r.id} className={cx('h-1.5 rounded-full transition-[width,background-color] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)]', i === active ? 'w-5 bg-basil' : 'w-1.5 bg-line')} />
          ))}
        </div>
        <span className="hidden md:block">
          <IconButton icon={ChevronRight} label="Next recipe" size={36} disabled={active === count - 1} onClick={() => moveTo(active + 1)} className="disabled:opacity-40" />
        </span>
      </div>
      <p className="sr-only" aria-live="polite">{recipeTitle(current)}, {active + 1} of {count}</p>

      {(note || onOpen) && (
        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm text-ink-muted">{note}</p>
          {onOpen && <button type="button" onClick={() => onOpen(current)} className="shrink-0 cursor-pointer text-sm font-semibold text-basil hover:underline">View recipe</button>}
        </div>
      )}
    </section>
  );
}
