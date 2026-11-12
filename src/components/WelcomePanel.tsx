import { useEffect, useState } from 'react';
import { photo, previewRecipes, recipeTitle, type RecipeCard } from '../lib/catalog';
import { Card, Photo } from './ds';

// The second column of the auth and onboarding screens on desktop: a warm green panel
// with one line of copy and a static preview of a real week from the catalog, so the
// first thing people see is the product.

const DAYS = ['Mon', 'Tue', 'Wed'];

function WeekPreview() {
  const [recipes, setRecipes] = useState<RecipeCard[]>([]);
  useEffect(() => { previewRecipes().then(setRecipes).catch(() => setRecipes([])); }, []);
  return (
    <Card role="img" aria-label="Example of a planned week: three dinners with photos" className="w-full p-5 shadow-lg">
      <p className="label mb-1">This week</p>
      <ul className="divide-y divide-line">
        {(recipes.length ? recipes : [null, null, null]).map((r, i) => (
          <li key={i} className="flex items-center gap-4 py-3">
            <span className="w-9 shrink-0 text-small font-bold text-ink-muted">{DAYS[i]}</span>
            <Photo src={photo(r?.thumb_url, 'small')} className="size-14 shrink-0 rounded-photo" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-ink">{r ? recipeTitle(r) : ' '}</span>
              <span className="block truncate text-small text-ink-muted">{r?.subtitle ?? ' '}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function WelcomePanel({ line }: { line: string }) {
  return (
    <aside className="hidden flex-1 items-center justify-center bg-green px-12 md:flex">
      <div className="w-full max-w-form">
        <p className="display mb-8 text-display text-surface">{line}</p>
        <WeekPreview />
      </div>
    </aside>
  );
}
