import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Preferences, Profile } from '../lib/preferences';
import type { Day, PlanReview, SavedWeekPlan, Slot, WeekPlan } from '../lib/plan';
import type { FamilyMember, MemberDraft } from '../lib/family';
import type { CheckinAnswer } from '../lib/signals';
import type { OnHand } from '../lib/onHand';
import type { ImportDraft } from '../../supabase/functions/_shared/imports/draft.ts';

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
  | { name: 'collections'; id: number }
  | { name: 'pantry' }
  /** Write a recipe, edit the household's recipe `id`, or check an import (`draft`) before saving it. */
  | { name: 'editor'; id?: number; draft?: ImportDraft; duplicate?: { id: number; title: string } | null; note?: string | null }
  /** Import from a link, text or photos. Opened with something already shared or chosen, it starts right away. */
  | { name: 'import'; url?: string; text?: string; files?: File[]; mode?: 'link' | 'photos' | 'text';
      /** Came from outside (the share sheet): shown ready to import, but never started without a tap. */
      shared?: boolean };

export interface FavoriteEntry { id: number; title: string; image: string }

export interface SuggestionsTarget { day: Day; slot: Slot }

export interface AppState {
  session: Session;
  userId: string;
  /** The settings every recipe list is filtered with: the household's, plus each person's allergies. */
  prefs: Preferences;
  /** The saved household settings on their own. Only Settings edits these. */
  householdPrefs: Preferences;
  updatePrefs: (updates: Partial<Preferences>) => Promise<void>;
  /** The people at the table, in the order they were added. */
  members: FamilyMember[];
  /** False when the database doesn't have the family tables yet: family features stay hidden. */
  familyAvailable: boolean;
  saveFamilyMember: (draft: MemberDraft) => Promise<void>;
  removeFamilyMember: (id: string) => Promise<void>;
  profile: Profile;
  setProfile: (p: Profile) => void;
  /** undefined while loading, null when there's no plan yet. */
  weekPlan: SavedWeekPlan | null | undefined;
  /**
   * Saves the plan; `fresh` = a newly planned week. Rebuilds the grocery list in the
   * background. An edit by hand is remembered as a taste signal; `quiet` is for changes
   * that say nothing about taste (a busy night, an automatic replacement).
   */
  saveWeek: (plan: WeekPlan, fresh: boolean, opts?: { quiet?: boolean }) => Promise<SavedWeekPlan>;
  /** Plans a new week from what the family eats and saves it. Locked days stay. Returns the notice, if any. */
  planNewWeek: () => Promise<string | null>;
  /**
   * One tap on a busy night: trades that day's dinner for something faster that uses what's
   * on the grocery list. 'none' when nothing faster fits; 'stale' when the week changed
   * while it was looking, so nothing was swapped.
   */
  swapForBusyNight: (day: Day) => Promise<'swapped' | 'none' | 'stale'>;
  /** Ingredients to use up, and when they were set (they count for a week). */
  onHand: OnHand;
  /**
   * Sets the ingredients to use up (an empty list stops) and re-ranks the days still open
   * around them. Returns the note about what changed, or null.
   */
  planAroundOnHand: (items: string[]) => Promise<string | null>;
  /** Saves an after-dinner check-in, then updates the days still open. True when the plan changed. */
  submitCheckin: (recipeId: number, date: string, answers: CheckinAnswer[]) => Promise<boolean>;
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
