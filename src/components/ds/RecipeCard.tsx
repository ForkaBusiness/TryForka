import React from 'react';
import { Check, Clock, Heart, Plus } from 'lucide-react';
import { cx } from './cx';
import { Photo } from './Photo';
import { Tag } from './Chip';
import { Skeleton } from './Layout';
import type { RecipeCard as RecipeSummary } from '../../lib/catalog';
import { photo, recipeTitle } from '../../lib/catalog';
import { recipeTags, shortMinutes } from './recipeMeta';

// The one recipe card: photo, name, then a row of tags (time, cuisine, diet). Used in
// every grid: browse, favorites, collections, photo results, suggestions. Matte, and the
// controls on the photo are matte discs too: these sit in long scrolling lists, where
// backdrop blur would cost older phones.

export interface RecipeCardProps {
  recipe: RecipeSummary;
  onOpen: () => void;
  added?: boolean;
  onAdd?: () => void;
  favorite?: boolean;
  onFavorite?: () => void;
  /** A line under the title (e.g. why it was suggested). */
  note?: string;
}

const disc = 'flex size-9 cursor-pointer items-center justify-center rounded-full shadow-sm transition-transform duration-150 ease-spring active:scale-98';

export function RecipeCard({ recipe, onOpen, added, onAdd, favorite, onFavorite, note }: RecipeCardProps) {
  const title = recipeTitle(recipe);
  const time = shortMinutes(recipe.total_minutes);
  const tags = recipeTags(recipe);
  return (
    <div className="relative h-full min-w-0">
      <button type="button" onClick={onOpen} className="flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-sm transition-shadow duration-150 hover:shadow-md">
        <Photo src={photo(recipe.thumb_url, 'medium')} className="aspect-4/3 w-full" />
        <span className="flex flex-1 flex-col gap-2 p-3">
          <span className="line-clamp-2 text-body font-semibold text-ink">{title}</span>
          {note && <span className="line-clamp-3 text-small text-ink-muted">{note}</span>}
          {(time || tags.length > 0) && (
            <span className="mt-auto flex flex-wrap gap-1">
              {time && <Tag size="sm" icon={Clock}>{time}</Tag>}
              {tags.map(t => <Tag key={t} size="sm">{t}</Tag>)}
            </span>
          )}
        </span>
      </button>
      <div className="absolute top-2 right-2 flex gap-2">
        {onFavorite && (
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
            aria-pressed={favorite}
            className={cx(disc, 'bg-surface text-ink')}
          >
            <Heart size={18} strokeWidth={1.75} aria-hidden className={favorite ? 'fill-green text-green' : ''} />
          </button>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={added ? `${title} is in your week. Remove it` : `Add ${title} to week`}
            aria-pressed={added}
            className={cx(disc, added ? 'bg-green text-surface' : 'bg-surface text-green')}
          >
            {added ? <Check size={18} strokeWidth={2.25} aria-hidden className="animate-check" /> : <Plus size={20} strokeWidth={2} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}

/** The grid every list of recipe cards uses. */
export function RecipeGrid({ children, compact, className, ...rest }: React.HTMLAttributes<HTMLUListElement> & { compact?: boolean }) {
  return <ul className={cx('grid grid-cols-2 gap-3', !compact && 'sm:grid-cols-3 md:gap-4 lg:grid-cols-4', className)} {...rest}>{children}</ul>;
}

/** Loading placeholder in the shape of the grid. */
export function RecipeGridSkeleton({ count = 6, compact }: { count?: number; compact?: boolean }) {
  return (
    <div aria-hidden className={cx('grid grid-cols-2 gap-3', !compact && 'sm:grid-cols-3 md:gap-4 lg:grid-cols-4')}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-line bg-surface">
          <Skeleton className="aspect-4/3 w-full rounded-none" />
          <div className="p-3"><Skeleton className="h-4 w-3/4 rounded-full" /><Skeleton className="mt-3 h-6 w-1/2 rounded-full" /></div>
        </div>
      ))}
    </div>
  );
}
