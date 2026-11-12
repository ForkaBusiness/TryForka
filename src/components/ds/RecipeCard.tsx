import { Check, Heart, Plus } from 'lucide-react';
import { cx } from './cx';
import type { RecipeCard } from '../../lib/catalog';
import { photo, recipeTitle } from '../../lib/catalog';

// Recipe tile for grids (Build a meal plan, photo results, suggestions): square photo,
// name, subtitle. The "+" adds to the week and turns into a filled check once added.

export interface RecipeTileProps {
  recipe: RecipeCard;
  onOpen: () => void;
  added?: boolean;
  onAdd?: () => void;
  favorite?: boolean;
  onFavorite?: () => void;
  /** Extra line under the subtitle (e.g. why it was suggested). */
  note?: string;
}

export function RecipeTile({ recipe, onOpen, added, onAdd, favorite, onFavorite, note }: RecipeTileProps) {
  const title = recipeTitle(recipe);
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={onOpen} className="group block w-full cursor-pointer text-left">
        <span className="block aspect-square overflow-hidden rounded-photo bg-line/60">
          {recipe.thumb_url && <img src={photo(recipe.thumb_url, 'medium')} alt="" loading="lazy" className="size-full object-cover" />}
        </span>
        <span className="mt-2 block font-display text-md font-semibold tracking-[-0.01em] text-ink group-hover:underline group-hover:decoration-line group-hover:underline-offset-4">
          {title}
        </span>
        {recipe.subtitle && <span className="mt-0.5 block text-sm text-ink-muted">{recipe.subtitle}</span>}
        {note && <span className="mt-1 block text-sm text-ink">{note}</span>}
      </button>
      <div className="absolute top-2 right-2 flex gap-2">
        {onFavorite && (
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
            aria-pressed={favorite}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface text-ink"
          >
            <Heart size={18} strokeWidth={1.75} aria-hidden className={favorite ? 'fill-basil text-basil' : ''} />
          </button>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={added ? `${title} is in your week. Remove it` : `Add ${title} to week`}
            aria-pressed={added}
            className={cx(
              'flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150',
              added ? 'bg-basil text-surface' : 'bg-surface text-basil',
            )}
          >
            {added ? <Check size={18} strokeWidth={2.25} aria-hidden className="animate-check" /> : <Plus size={20} strokeWidth={2} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}
