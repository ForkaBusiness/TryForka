import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Preferences, Profile } from '../lib/preferences';
import type { Day, PlanReview, SavedWeekPlan, Slot, WeekPlan } from '../lib/plan';

// Shared state for the signed-in app. Navigation is still the currentScreen state
// machine (App.tsx); `go` pushes a screen, `back` pops, tabs reset the stack.

export type Screen =
  | { name: 'mealplan' }
  | { name: 'browse' }
  | { name: 'groceries' }
  | { name: 'favorites' }
  | { name: 'settings' }
  | { name: 'terms' }
  | { name: 'recipe'; id: number; tab?: 'ingredients' | 'steps' }
  | { name: 'cooking'; id: number }
  | { name: 'notes'; id: number }
  | { name: 'rate'; id: number }
  | { name: 'collections'; id: number };

export interface FavoriteEntry { id: number; title: string; image: string }

export interface SuggestionsTarget { day: Day; slot: Slot }

export interface AppState {
  session: Session;
  userId: string;
  prefs: Preferences;
  updatePrefs: (updates: Partial<Preferences>) => Promise<void>;
  profile: Profile;
  setProfile: (p: Profile) => void;
  /** undefined while loading, null when there's no plan yet. */
  weekPlan: SavedWeekPlan | null | undefined;
  /** Saves the plan; `fresh` = a newly planned week. Rebuilds the grocery list in the background. */
  saveWeek: (plan: WeekPlan, fresh: boolean) => Promise<SavedWeekPlan>;
  /** What the recipe filter last changed in the plan, and which slots it left empty. */
  planReview: PlanReview;
  setPlanReview: (review: PlanReview) => void;
  /** Puts back the meals and settings from before the last automatic replacement. */
  undoPlanReview: () => Promise<void>;
  favorites: Map<number, FavoriteEntry>;
  toggleFavorite: (entry: FavoriteEntry) => Promise<void>;
  go: (screen: Screen) => void;
  /** Swaps the current screen for another (Back then skips the one replaced). */
  replace: (screen: Screen) => void;
  back: () => void;
  openSuggestions: (target?: SuggestionsTarget) => void;
  /** Opens the photo search (Find meals like this). */
  openPhotoSearch: () => void;
  isPhone: boolean;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside the signed-in app');
  return ctx;
}
