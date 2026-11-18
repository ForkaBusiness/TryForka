import { useEffect, useState } from 'react';
import { ingredientIndex } from './catalog';
import type { IngredientOption } from './ingredientSearch';

/** Every ingredient in the catalog, for the preference inputs. Null until it has loaded. */
export function useIngredientIndex(): IngredientOption[] | null {
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  useEffect(() => { ingredientIndex().then(setOptions).catch(() => {}); }, []);
  return options;
}
