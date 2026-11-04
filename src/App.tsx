import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isLeaving, OPENED_FROM_RECOVERY_LINK, signOutToWebsite, supabase, WEBSITE_LOGIN, WEBSITE_RESET_PASSWORD } from './lib/supabase';
import { useMediaQuery } from './lib/useMediaQuery';
import { DEFAULT_PREFERENCES, fetchPreferences, fetchProfile, foodSettings, savePreferences, type FoodSettings, type Preferences, type Profile } from './lib/preferences';
import { enforcePlan, fetchWeekPlan, planNotice, saveWeekPlan, type PlanReview, type SavedWeekPlan, type WeekPlan } from './lib/plan';
import { fetchGroceryList, rebuildGroceryList } from './lib/groceries';
import { AppContext, type AppState, type FavoriteEntry, type Screen, type SuggestionsTarget } from './app/AppContext';
import { AppFrame } from './components/Shell';
import { TAB_BAR_HEIGHT, type NavId } from './components/nav';
import { TimerTray } from './components/Timers';
import { Terms } from './screens/Terms';
import { Onboarding } from './screens/Onboarding';
import { MealPlan } from './screens/MealPlan';
import { BrowseRecipes } from './screens/BrowseRecipes';
import { RecipeDetail } from './screens/RecipeDetail';
import { CookingMode } from './screens/CookingMode';
import { Notes } from './screens/Notes';
import { RateRecipe } from './screens/RateRecipe';
import { Collections } from './screens/Collections';
import { Favorites } from './screens/Favorites';
import { Groceries } from './screens/Groceries';
import { Settings } from './screens/Settings';
import { SuggestionsPanel } from './screens/SuggestionsPanel';
import { PhotoSearch } from './screens/PhotoSearch';
import { Styleguide } from './screens/Styleguide';

// Dev-only design system reference at /app/styleguide.
const SHOW_STYLEGUIDE = import.meta.env.DEV && window.location.pathname === `${import.meta.env.BASE_URL}styleguide`;

const TABS: NavId[] = ['mealplan', 'groceries', 'favorites', 'settings'];
/** Screens with a sticky bottom action bar (the timer tray sits above it). */
const WITH_BOTTOM_BAR: Screen['name'][] = ['recipe', 'rate', 'collections', 'cooking'];
const BOTTOM_BAR_HEIGHT = 77;

/** Blank while the session check runs or while leaving for the website's log-in page. */
function Blank() {
  return <div className="h-dvh bg-canvas" aria-busy="true" />;
}

function Loading() {
  return <div className="flex h-dvh items-center justify-center bg-canvas text-base text-ink-muted" role="status">Loading…</div>;
}

/** The signed-in app: loads the household's data, then renders the current screen. */
function SignedIn({ session }: { session: Session }) {
  const userId = session.user.id;
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [prefs, setPrefs] = useState<Preferences | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile>({ full_name: '', household_name: '', household_size: 1 });
  const [weekPlan, setWeekPlan] = useState<SavedWeekPlan | null | undefined>(undefined);
  const [planChecked, setPlanChecked] = useState(false);
  const [planReview, setPlanReview] = useState<PlanReview>({ notice: null, blocked: [] });
  const [favorites, setFavorites] = useState<Map<number, FavoriteEntry>>(new Map());
  const [stack, setStack] = useState<Screen[]>([{ name: 'mealplan' }]);
  const [suggestions, setSuggestions] = useState<{ open: boolean; target: SuggestionsTarget | null }>({ open: false, target: null });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const planRef = useRef<SavedWeekPlan | null | undefined>(undefined);
  planRef.current = weekPlan;
  /** The settings the plan last passed; null until the first check. */
  const checkedFood = useRef<FoodSettings | null>(null);
  const metaName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetchPreferences(userId).then(p => { if (!cancelled) setPrefs(p); }).catch(() => { if (!cancelled) { setPrefs(null); setLoadError(true); } });
    fetchProfile(userId).then(p => { if (!cancelled) setProfile({ ...p, full_name: p.full_name || metaName }); }).catch(() => {});
    fetchWeekPlan(userId).then(p => { if (!cancelled) setWeekPlan(p); }).catch(() => { if (!cancelled) setWeekPlan(null); });
    supabase.from('favorites').select('recipe_id, recipe_title, recipe_image').eq('user_id', userId).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setFavorites(new Map((data ?? []).map(f => [f.recipe_id as number, { id: f.recipe_id as number, title: f.recipe_title as string, image: (f.recipe_image as string) ?? '' }])));
      });
    return () => { cancelled = true; };
  }, [userId, metaName]);

  const screen = stack[stack.length - 1];

  // Each screen opens at the top.
  useEffect(() => { mainRef.current?.scrollTo(0, 0); window.scrollTo(0, 0); }, [stack]);

  const go = useCallback((s: Screen) => {
    if ((TABS as string[]).includes(s.name)) setStack([s]);
    else setStack(prev => [...prev, s]);
  }, []);
  const replace = useCallback((s: Screen) => setStack(prev => [...prev.slice(0, -1), s]), []);
  const back = useCallback(() => setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : [{ name: 'mealplan' }])), []);

  const updatePrefs = useCallback(async (updates: Partial<Preferences>) => {
    setPrefs(p => ({ ...(p ?? DEFAULT_PREFERENCES), ...updates }));
    await savePreferences(userId, updates);
  }, [userId]);

  const saveWeek = useCallback(async (plan: WeekPlan, fresh: boolean) => {
    const saved = await saveWeekPlan(userId, plan, planRef.current ?? null, fresh);
    planRef.current = saved;
    setWeekPlan(saved);
    // Any edit to the plan means Undo would no longer restore what the household sees.
    setPlanReview(r => (r.undo ? { ...r, undo: undefined } : r));
    // Build the grocery list now so it's ready when they open it (the Groceries screen
    // also rebuilds if it finds the list out of date).
    fetchGroceryList(userId).then(prev => rebuildGroceryList(userId, saved, prev)).catch(err => console.error('[groceries] rebuild failed:', err));
    return saved;
  }, [userId]);

  // A saved plan was only checked against the settings of the day it was made, so check
  // it again when it loads (before it's shown) and whenever the settings change. The short
  // wait after a change means a mis-tapped allergy doesn't cost the household a planned meal.
  const planLoaded = weekPlan !== undefined;
  const foodKey = prefs ? JSON.stringify(foodSettings(prefs)) : null;
  useEffect(() => {
    if (!prefs || !planLoaded) return;
    const food = foodSettings(prefs);
    const before = checkedFood.current;
    let cancelled = false;
    const id = window.setTimeout(() => {
      const current = planRef.current;
      if (!current) { checkedFood.current = food; setPlanChecked(true); return; }
      enforcePlan(current.plan, prefs)
        .then(async result => {
          if (cancelled) return;
          checkedFood.current = food;
          if (!result.changed) {
            // Settings moved on, so Undo would also take back this newer change (it could be
            // an allergy). Changing them back by hand still leaves Undo for the meals.
            setPlanReview(r => (r.undo && JSON.stringify(r.undo.food) !== foodKey ? { ...r, undo: undefined } : r));
            return;
          }
          await saveWeek(result.plan, false).catch(() => setWeekPlan({ ...current, plan: result.plan }));
          // Nothing to go back to on the first check: the change came from another session.
          setPlanReview({
            notice: planNotice(result.replaced, result.blocked.length), blocked: result.blocked,
            undo: before ? { plan: current.plan, food: before } : undefined,
          });
        })
        .catch(err => console.error('[plan] check failed:', err))
        .finally(() => { if (!cancelled) setPlanChecked(true); });
    }, planChecked ? 800 : 0);
    return () => { cancelled = true; window.clearTimeout(id); };
    // planChecked only picks the delay; a change to it must not start another check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodKey, planLoaded, saveWeek]);

  // Settings first: if that save fails, nothing has changed and the meals stay safe.
  const undoPlanReview = useCallback(async () => {
    const { undo } = planReview;
    if (!undo) return;
    await savePreferences(userId, undo.food);
    setPrefs(p => ({ ...(p ?? DEFAULT_PREFERENCES), ...undo.food }));
    await saveWeek(undo.plan, false);
    setPlanReview({ notice: null, blocked: [] });
  }, [planReview, saveWeek, userId]);

  const toggleFavorite = useCallback(async (entry: FavoriteEntry) => {
    const has = favorites.has(entry.id);
    setFavorites(prev => { const next = new Map(prev); if (has) next.delete(entry.id); else next.set(entry.id, entry); return next; });
    const { error } = has
      ? await supabase.from('favorites').delete().eq('user_id', userId).eq('recipe_id', entry.id)
      : await supabase.from('favorites').upsert({ user_id: userId, recipe_id: entry.id, recipe_title: entry.title, recipe_image: entry.image }, { onConflict: 'user_id,recipe_id' });
    if (error) {
      // Put it back the way it was.
      setFavorites(prev => { const next = new Map(prev); if (has) next.set(entry.id, entry); else next.delete(entry.id); return next; });
    }
  }, [favorites, userId]);

  const ctx: AppState | null = useMemo(() => (prefs ? {
    session, userId, prefs, updatePrefs, profile, setProfile, favorites, toggleFavorite, go, replace, back, isPhone,
    weekPlan: planChecked ? weekPlan : undefined, saveWeek, planReview, setPlanReview, undoPlanReview,
    openSuggestions: (target?: SuggestionsTarget) => setSuggestions({ open: true, target: target ?? null }),
    openPhotoSearch: () => setPhotoOpen(true),
  } : null), [session, userId, prefs, updatePrefs, profile, weekPlan, planChecked, saveWeek, planReview, undoPlanReview, favorites, toggleFavorite, go, replace, back, isPhone]);

  if (prefs === undefined) return <Loading />;
  if (loadError || !prefs || !ctx) {
    return (
      <div className="flex h-dvh flex-col items-start justify-center gap-3 px-6">
        <h1 className="text-2xl">Couldn't load your account</h1>
        <p className="text-base text-ink-muted">Check your connection, then reload the page.</p>
        <button type="button" onClick={() => window.location.reload()} className="cursor-pointer font-semibold text-basil hover:underline">Reload</button>
      </div>
    );
  }
  if (!prefs.onboarded_at) {
    return <Onboarding userId={userId} initial={prefs} onDone={p => setPrefs(p)} onSignOut={() => void signOutToWebsite()} />;
  }

  let content: React.ReactNode;
  switch (screen.name) {
    case 'mealplan': content = <MealPlan />; break;
    case 'browse': content = <BrowseRecipes />; break;
    case 'groceries': content = <Groceries />; break;
    case 'favorites': content = <Favorites />; break;
    case 'settings': content = <Settings />; break;
    case 'terms': content = <Terms onBack={back} />; break;
    case 'recipe': content = <RecipeDetail key={screen.id} id={screen.id} initialTab={screen.tab} />; break;
    case 'cooking': content = <CookingMode key={screen.id} id={screen.id} />; break;
    case 'notes': content = <Notes id={screen.id} />; break;
    case 'rate': content = <RateRecipe id={screen.id} />; break;
    case 'collections': content = <Collections id={screen.id} />; break;
  }

  const root = stack[0].name as NavId;
  const showNav = screen.name !== 'cooking';
  const tabBar = isPhone && showNav ? TAB_BAR_HEIGHT : 0;
  const bar = WITH_BOTTOM_BAR.includes(screen.name) ? BOTTOM_BAR_HEIGHT : 0;

  return (
    <AppContext.Provider value={ctx}>
      <div style={{ '--tray-offset': `calc(${tabBar + bar}px + env(safe-area-inset-bottom, 0px))` } as React.CSSProperties}>
        <AppFrame
          isPhone={isPhone}
          active={(TABS as string[]).includes(root) ? root : 'mealplan'}
          onSelect={id => go({ name: id })}
          showNav={showNav}
          mainRef={mainRef}
          overlay={<>
            <SuggestionsPanel open={suggestions.open} target={suggestions.target} onClose={() => setSuggestions(s => ({ ...s, open: false }))} />
            <PhotoSearch open={photoOpen} onClose={() => setPhotoOpen(false)} />
            <TimerTray />
          </>}
        >
          {content}
        </AppFrame>
      </div>
    </AppContext.Provider>
  );
}

/** Not signed in: off to the website's log-in page. */
function ToLogin() {
  useEffect(() => { if (!isLeaving()) window.location.replace(WEBSITE_LOGIN); }, []);
  return <Blank />;
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  // Sign up, log in and password reset are on the website (login.html, signup.html,
  // reset-password.html). The app's own Auth screens are kept in the code but not shown.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && OPENED_FROM_RECOVERY_LINK) return window.location.replace(WEBSITE_RESET_PASSWORD);
      setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') window.location.replace(WEBSITE_RESET_PASSWORD);
      // Google sign-ups: make sure the profile row has their name.
      if (event === 'SIGNED_IN' && s && s.user.app_metadata.provider !== 'email') {
        const { id, email } = s.user;
        const fullName = s.user.user_metadata?.full_name || s.user.user_metadata?.name || '';
        // Deferred: awaiting Supabase calls inside this callback can deadlock the auth lock.
        setTimeout(() => { void supabase.from('users').upsert({ id, email, full_name: fullName }, { onConflict: 'id', ignoreDuplicates: true }); }, 0);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (SHOW_STYLEGUIDE) return <div className="h-dvh overflow-y-auto"><Styleguide /></div>;
  if (session === undefined) return <Blank />;
  if (!session) return <ToLogin />;
  return <SignedIn key={session.user.id} session={session} />;
}

export default App;
