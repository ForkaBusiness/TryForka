import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isLeaving, OPENED_FROM_RECOVERY_LINK, signOutToWebsite, supabase, WEBSITE_LOGIN, WEBSITE_RESET_PASSWORD } from './lib/supabase';
import { useMediaQuery } from './lib/useMediaQuery';
import { DEFAULT_PREFERENCES, fetchPreferences, fetchProfile, foodSettings, savePreferences, type FoodSettings, type Preferences, type Profile } from './lib/preferences';
import { enforcePlan, fetchWeekPlan, planNotice, saveWeekPlan, type Day, type PlanReview, type SavedWeekPlan, type WeekPlan } from './lib/plan';
import { fetchMembers, removeMember, saveMember, withFamilyAllergies, type FamilyMember, type MemberDraft } from './lib/family';
import { busyNightSwap, generateWeekPlan, updateAfterCheckin, type Family } from './lib/learning';
import { markChosen, planEdits } from './lib/planner';
import { logPlanEvents, saveCheckin, type CheckinAnswer } from './lib/signals';
import { activeOnHand, fetchOnHand, NOTHING_ON_HAND, saveOnHand, type OnHand } from './lib/onHand';
import { fetchGroceryList, rebuildGroceryList } from './lib/groceries';
import { AppContext, type AppState, type FavoriteEntry, type Screen, type SuggestionsTarget } from './app/AppContext';
import { AppFrame } from './components/Shell';
import type { NavId } from './components/nav';
import { TimerTray } from './components/Timers';
import { Button, PageContainer, Skeleton } from './components/ds';
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
import { CookWithWhatYouHave } from './screens/CookWithWhatYouHave';
import { RecipeEditor } from './screens/RecipeEditor';
import { ImportRecipe } from './screens/ImportRecipe';
import { handleIncomingShare, readPendingShare } from './lib/incomingShare';
import { billingView, effectivePlan, loadPlanRow, openPortal, readBillingReturn, type BillingReturn, type PlanRow } from './lib/billing';
import { FREE_ROW } from '../supabase/functions/_shared/billing/state.ts';
import { UpgradeSheet } from './components/UpgradeSheet';
import { canSaveRecipe } from './lib/usage';
import { CheckoutSheet } from './components/CheckoutSheet';
import { Pro } from './screens/Pro';
import type { UpgradeReason } from './app/AppContext';

// Dev-only design system reference at /app/styleguide.
const SHOW_STYLEGUIDE = import.meta.env.DEV && window.location.pathname === `${import.meta.env.BASE_URL}styleguide`;

const TABS: NavId[] = ['mealplan', 'groceries', 'favorites', 'settings'];
/** Screens with a sticky bottom action bar: it takes the tab bar's place, and the timer tray sits above it. */
const WITH_BOTTOM_BAR: Screen['name'][] = ['recipe', 'rate', 'collections', 'cooking', 'editor'];

const allergiesByMember = (members: FamilyMember[]): Record<string, string[]> => Object.fromEntries(members.map(m => [m.id, m.allergies]));
const PLAN_CHECK_RETRY_MS = 4000;
const sameIds = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).sort().join() === Object.keys(b).sort().join();

/** Blank while the session check runs or while leaving for the website's log-in page. */
function Blank() {
  return <div className="h-dvh bg-cream" aria-busy="true" />;
}

/** The shape of the home screen while the household's data loads. */
function Loading() {
  return (
    <div className="h-dvh overflow-hidden bg-cream" role="status" aria-label="Loading your week">
      <PageContainer>
        <Skeleton className="h-9 w-2/3 rounded-full" />
        <Skeleton className="mt-3 mb-6 h-4 w-1/3 rounded-full" />
        <Skeleton className="aspect-4/3 w-full rounded-card md:aspect-video" />
        <Skeleton className="mt-6 h-24 w-full rounded-card" />
      </PageContainer>
    </div>
  );
}

/** The signed-in app: loads the household's data, then renders the current screen. */
function SignedIn({ session }: { session: Session }) {
  const userId = session.user.id;
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [prefs, setPrefs] = useState<Preferences | null | undefined>(undefined);
  const [members, setMembers] = useState<FamilyMember[] | undefined>(undefined);
  const [familyAvailable, setFamilyAvailable] = useState(false);
  const [onHand, setOnHand] = useState<OnHand>(NOTHING_ON_HAND);
  const [profile, setProfile] = useState<Profile>({ full_name: '', household_name: '', household_size: 1 });
  const [weekPlan, setWeekPlan] = useState<SavedWeekPlan | null | undefined>(undefined);
  const [planChecked, setPlanChecked] = useState(false);
  /** Bumped to run the plan check again after it couldn't be completed. */
  const [checkAttempt, setCheckAttempt] = useState(0);
  const planShown = useRef(false);
  planShown.current = planChecked;
  const settingsKey = useRef<string | null>(null);
  const [planReview, setPlanReview] = useState<PlanReview>({ notice: null, blocked: [] });
  const [favorites, setFavorites] = useState<Map<number, FavoriteEntry>>(new Map());
  const [stack, setStack] = useState<Screen[]>([{ name: 'mealplan' }]);
  const [suggestions, setSuggestions] = useState<{ open: boolean; target: SuggestionsTarget | null }>({ open: false, target: null });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Forka Pro: the plan as the Stripe webhook wrote it, the upgrade sheet, and Stripe's return.
  const [planRow, setPlanRow] = useState<PlanRow>(FREE_ROW);
  // Until the plan is read, nothing claims Free and no upgrade prompt shows.
  const [planState, setPlanState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason | null>(null);
  const [billingReturn, setBillingReturn] = useState<BillingReturn>(null);
  const mainRef = useRef<HTMLElement>(null);
  const planRef = useRef<SavedWeekPlan | null | undefined>(undefined);
  planRef.current = weekPlan;
  /** The settings the plan last passed; null until the first check. */
  const checkedSettings = useRef<{ food: FoodSettings; memberAllergies: Record<string, string[]> } | null>(null);
  const metaName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetchPreferences(userId).then(p => { if (!cancelled) setPrefs(p); }).catch(() => { if (!cancelled) { setPrefs(null); setLoadError(true); } });
    // A family that can't be read is a load error: its allergies must not drop out of the filter.
    fetchMembers(userId).then(f => { if (!cancelled) { setMembers(f.members); setFamilyAvailable(f.available); } }).catch(() => { if (!cancelled) { setMembers([]); setLoadError(true); } });
    // Nice to have: without it the plan just doesn't lean on leftovers.
    fetchOnHand(userId).then(o => { if (!cancelled) setOnHand(o); }).catch(() => {});
    fetchProfile(userId).then(p => { if (!cancelled) setProfile({ ...p, full_name: p.full_name || metaName }); }).catch(() => {});
    fetchWeekPlan(userId).then(p => { if (!cancelled) setWeekPlan(p); }).catch(() => { if (!cancelled) setWeekPlan(null); });
    // Unreadable reads as Free: nothing the household saved depends on it.
    loadPlanRow(userId).then(r => { if (!cancelled) { setPlanRow(r); setPlanState('ready'); } }).catch(() => { if (!cancelled) setPlanState('failed'); });
    supabase.from('favorites').select('recipe_id, recipe_title, recipe_image').eq('user_id', userId).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setFavorites(new Map((data ?? []).map(f => [f.recipe_id as number, { id: f.recipe_id as number, title: f.recipe_title as string, image: (f.recipe_image as string) ?? '' }])));
      });
    return () => { cancelled = true; };
  }, [userId, metaName]);

  const screen = stack[stack.length - 1];

  // Something shared into Forka (Android share sheet, later an iOS extension): open the
  // import with it, on top of the home screen, once the household's data has loaded.
  const ready = prefs !== undefined && members !== undefined;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    readPendingShare().then(share => {
      if (cancelled || !share) return;
      const next = share === 'failed' ? null : handleIncomingShare(share);
      // Shared from outside the app: ready to import, started only when the household taps Import.
      setStack(prev => [...prev, next?.name === 'import' ? { ...next, shared: true } : { name: 'import' }]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ready]);

  // Coming back from Stripe (Checkout, the Customer Portal) or from the trial email's link.
  useEffect(() => {
    if (!ready) return;
    const ret = readBillingReturn();
    if (ret === 'manage') { void openPortal().catch(() => setStack(prev => [...prev, { name: 'settings' }])); return; }
    if (ret === 'portal_returned') { void loadPlanRow(userId).then(r => { setPlanRow(r); setPlanState('ready'); }).catch(() => {}); return; }
    if (ret) setBillingReturn(ret);
  }, [ready, userId]);

  const refreshPlan = useCallback(async () => { const r = await loadPlanRow(userId); setPlanRow(r); setPlanState('ready'); return r; }, [userId]);
  const billing = useMemo(() => {
    const now = new Date();
    return { row: planRow, plan: effectivePlan(planRow, now), view: billingView(planRow, now), status: planState, refresh: refreshPlan, upgrade: (reason: UpgradeReason) => setUpgradeReason(reason) };
  }, [planRow, planState, refreshPlan]);

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

  // Everything that filters recipes reads these: the household's settings plus each person's allergies.
  const shownPrefs = useMemo(() => (prefs && members ? withFamilyAllergies(prefs, members) : null), [prefs, members]);

  const saveWeek = useCallback(async (plan: WeekPlan, fresh: boolean, opts?: { quiet?: boolean }) => {
    const before = planRef.current ?? null;
    // While a saved plan is hidden for its check, screens see "no plan". An edit made in
    // that moment would be built on an empty week and overwrite the real one, so it waits.
    if (!opts?.quiet && before && !planShown.current) throw new Error('Your week is still loading. Try again in a moment.');
    // What the household puts in the plan by hand is theirs: the daily update won't move it.
    const saved = await saveWeekPlan(userId, opts?.quiet ? plan : markChosen(before?.plan ?? null, plan), before, fresh);
    if (!opts?.quiet) logPlanEvents(userId, planEdits(before?.plan ?? null, plan));
    planRef.current = saved;
    setWeekPlan(saved);
    // An edit by hand makes the last note out of date (it describes a week that's gone), and
    // any edit means Undo would no longer restore what the household sees.
    setPlanReview(r => (opts?.quiet ? (r.undo ? { ...r, undo: undefined } : r) : (r.notice || r.undo ? { notice: null, blocked: r.blocked } : r)));
    // Build the grocery list now so it's ready when they open it (the Groceries screen
    // also rebuilds if it finds the list out of date).
    fetchGroceryList(userId).then(prev => rebuildGroceryList(userId, saved, prev)).catch(err => console.error('[groceries] rebuild failed:', err));
    return saved;
  }, [userId]);

  // A saved plan was only checked against the settings of the day it was made, so check
  // it again when it loads (before it's shown) and whenever the settings change. The short
  // wait after a change means a mis-tapped allergy doesn't cost the household a planned meal.
  const planLoaded = weekPlan !== undefined;
  const foodKey = prefs && members ? JSON.stringify([foodSettings(prefs), allergiesByMember(members)]) : null;
  settingsKey.current = foodKey;
  useEffect(() => {
    if (!prefs || !members || !shownPrefs || !planLoaded) return;
    const settings = { food: foodSettings(prefs), memberAllergies: allergiesByMember(members) };
    const before = checkedSettings.current;
    let cancelled = false;
    // From the moment the settings change until the plan has passed them again, no screen
    // gets the plan: a dinner with a new allergen in it is never shown, not even briefly.
    const firstCheck = before === null;
    setPlanChecked(false);
    // An Undo that only holds meals was worked out under the old settings: it could put
    // back a dinner the new settings don't allow, so a settings change retires it.
    if (!firstCheck) setPlanReview(r => (r.undo && !r.undo.settings ? { ...r, undo: undefined } : r));
    let retry: number | undefined;
    const id = window.setTimeout(() => {
      const current = planRef.current;
      if (!current) { checkedSettings.current = settings; setPlanChecked(true); return; }
      enforcePlan(current.plan, shownPrefs)
        .then(async result => {
          if (cancelled) return;
          checkedSettings.current = settings;
          if (!result.changed) {
            // Settings moved on, so Undo would also take back this newer change (it could be
            // an allergy). Changing them back by hand still leaves Undo for the meals.
            setPlanReview(r => (r.undo?.settings && JSON.stringify([r.undo.settings.food, r.undo.settings.memberAllergies]) !== foodKey ? { ...r, undo: undefined } : r));
            return;
          }
          await saveWeek(result.plan, false, { quiet: true }).catch(() => setWeekPlan({ ...current, plan: result.plan }));
          // Nothing to go back to on the first check (the change came from another session),
          // or when someone was added or removed since: Undo can't bring a person back.
          setPlanReview({
            notice: planNotice(result.replaced, result.blocked.length), blocked: result.blocked,
            undo: before && sameIds(before.memberAllergies, settings.memberAllergies) ? { plan: current.plan, settings: before } : undefined,
          });
        })
        .then(() => { if (!cancelled) setPlanChecked(true); })
        // A check that couldn't run is not a pass: the plan stays hidden and the check is
        // tried again, rather than showing meals nobody has checked.
        .catch(err => {
          console.error('[plan] check failed:', err);
          if (!cancelled) retry = window.setTimeout(() => setCheckAttempt(n => n + 1), PLAN_CHECK_RETRY_MS);
        });
    }, firstCheck || checkAttempt > 0 ? 0 : 800);
    return () => { cancelled = true; window.clearTimeout(id); window.clearTimeout(retry); };
    // The check runs on a change to the settings (foodKey) or a retry, not on every new prefs object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodKey, planLoaded, saveWeek, checkAttempt]);

  // Settings first: if that save fails, nothing has changed and the meals stay safe.
  // Settings are only put back when a settings change is what's being undone. Undoing an
  // update that just moved meals never writes settings, so it can't undo an allergy
  // someone added in the meantime.
  const undoPlanReview = useCallback(async () => {
    const { undo } = planReview;
    if (!undo) return;
    const { settings } = undo;
    if (settings) {
      await savePreferences(userId, settings.food);
      const changed = (members ?? []).filter(m => settings.memberAllergies[m.id] && JSON.stringify(settings.memberAllergies[m.id]) !== JSON.stringify(m.allergies));
      const restored = await Promise.all(changed.map(m => saveMember(userId, { ...m, allergies: settings.memberAllergies[m.id] }, m.position)));
      setPrefs(p => ({ ...(p ?? DEFAULT_PREFERENCES), ...settings.food }));
      if (restored.length) setMembers(list => (list ?? []).map(m => restored.find(r => r.id === m.id) ?? m));
      await saveWeek(undo.plan, false, { quiet: true });
    } else {
      // The household wants these dinners back: mark them theirs, so tomorrow's update
      // doesn't make the same swap again. What goes back is checked against today's
      // settings first, like any saved plan.
      const current = planRef.current?.plan ?? null;
      const settings = settingsKey.current;
      const safe = shownPrefs ? await enforcePlan(undo.plan, shownPrefs) : null;
      // Checked under settings that have changed since: leave it, a fresh check is running.
      if (!safe || settingsKey.current !== settings) return;
      await saveWeek(markChosen(current, safe.plan), false, { quiet: true });
      if (safe.changed) { setPlanReview({ notice: planNotice(safe.replaced, safe.blocked.length), blocked: safe.blocked }); return; }
      // What the update brought in was turned down: it isn't offered again this week.
      logPlanEvents(userId, planEdits(current, undo.plan).filter(e => e.kind === 'swapped_out'));
    }
    setPlanReview({ notice: null, blocked: [] });
  }, [planReview, saveWeek, userId, members, shownPrefs]);

  const saveFamilyMember = useCallback(async (draft: MemberDraft) => {
    const list = members ?? [];
    const position = draft.id ? list.find(m => m.id === draft.id)?.position ?? 0 : (list.length ? list[list.length - 1].position + 1 : 0);
    const saved = await saveMember(userId, draft, position);
    setMembers(current => {
      const now = current ?? [];
      return now.some(m => m.id === saved.id) ? now.map(m => (m.id === saved.id ? saved : m)) : [...now, saved];
    });
  }, [members, userId]);

  const removeFamilyMember = useCallback(async (id: string) => {
    await removeMember(userId, id);
    setMembers(current => (current ?? []).filter(m => m.id !== id));
  }, [userId]);

  const family: Family | null = useMemo(
    () => (shownPrefs && members ? { userId, prefs: shownPrefs, members, favorites: [...favorites.keys()], onHand: activeOnHand(onHand) } : null),
    [userId, shownPrefs, members, favorites, onHand],
  );

  const planNewWeek = useCallback(async () => {
    if (!family) return null;
    const week = await generateWeekPlan(family, planRef.current?.plan ?? null);
    await saveWeek(week.plan, true, { quiet: true });
    setPlanReview({ notice: week.notice, blocked: week.blocked });
    return week.notice;
  }, [family, saveWeek]);

  // A busy night says nothing about taste, so the swap is saved quietly. Undo puts the
  // dinner back, and that does say something: the faster dinner was turned down, so it
  // isn't offered again this week.
  const swapForBusyNight = useCallback(async (day: Day): Promise<'swapped' | 'none' | 'stale'> => {
    const current = planRef.current;
    if (!family || !current) return 'none';
    const settings = settingsKey.current;
    const swap = await busyNightSwap(family, current, day);
    // Worked out from the plan as it was: if it changed meanwhile, this answer is about another week.
    if (planRef.current !== current || settingsKey.current !== settings) return 'stale';
    if (!swap) return 'none';
    await saveWeek(swap.plan, false, { quiet: true });
    setPlanReview(r => ({ notice: swap.note, blocked: r.blocked, undo: { plan: current.plan } }));
    return 'swapped';
  }, [family, saveWeek]);

  // Use what you have: save the list, then re-rank the open days around it right away,
  // under the same rules as the daily update (today, locked, picked, cooked and shopped-for
  // days stay). The note says what changed; Undo puts the meals back.
  const planAroundOnHand = useCallback(async (items: string[]) => {
    const saved = await saveOnHand(userId, items);
    setOnHand(saved);
    const current = planRef.current;
    if (!family || !current || !items.length) return null;
    const settings = settingsKey.current;
    try {
      const update = await updateAfterCheckin({ ...family, onHand: activeOnHand(saved) }, current);
      if (!update || planRef.current !== current || settingsKey.current !== settings) return null;
      await saveWeek(update.plan, false, { quiet: true });
      setPlanReview(r => ({ notice: update.note, blocked: r.blocked, undo: { plan: current.plan } }));
      return update.note;
    } catch (err) {
      console.error('[plan] update for on-hand items failed:', err);
      return null;
    }
  }, [family, saveWeek, userId]);

  // The daily update. The check-in itself is saved first and stands on its own: if the
  // update can't run, the answer still counts next time.
  const submitCheckin = useCallback(async (recipeId: number, date: string, answers: CheckinAnswer[]) => {
    await saveCheckin(userId, recipeId, date, answers);
    const current = planRef.current;
    if (!family || !current) return false;
    try {
      const settings = settingsKey.current;
      const update = await updateAfterCheckin(family, current);
      // The update was worked out from the plan and the settings as they were a moment
      // ago. If either has changed since, leave it: the next check-in will catch up.
      if (!update || planRef.current !== current || settingsKey.current !== settings) return false;
      await saveWeek(update.plan, false, { quiet: true });
      setPlanReview(r => ({ notice: update.note, blocked: r.blocked, undo: { plan: current.plan } }));
      return true;
    } catch (err) {
      console.error('[plan] daily update failed:', err);
      return false;
    }
  }, [family, saveWeek, userId]);

  const toggleFavorite = useCallback(async (entry: FavoriteEntry) => {
    const has = favorites.has(entry.id);
    // Free keeps 20 saved recipes: unhearting always works; hearting a new one past the limit opens the upgrade sheet.
    if (!has && !(await canSaveRecipe(userId, entry.id))) { setUpgradeReason('saved_recipes'); return; }
    setFavorites(prev => { const next = new Map(prev); if (has) next.delete(entry.id); else next.set(entry.id, entry); return next; });
    const { error } = has
      ? await supabase.from('favorites').delete().eq('user_id', userId).eq('recipe_id', entry.id)
      : await supabase.from('favorites').upsert({ user_id: userId, recipe_id: entry.id, recipe_title: entry.title, recipe_image: entry.image }, { onConflict: 'user_id,recipe_id' });
    if (error) {
      // Put it back the way it was.
      setFavorites(prev => { const next = new Map(prev); if (has) next.set(entry.id, entry); else next.delete(entry.id); return next; });
    }
  }, [favorites, userId]);

  const ctx: AppState | null = useMemo(() => (prefs && members && shownPrefs ? {
    session, userId, prefs: shownPrefs, householdPrefs: prefs, updatePrefs, members, familyAvailable, saveFamilyMember, removeFamilyMember,
    profile, setProfile, favorites, toggleFavorite, go, replace, back, isPhone,
    weekPlan: planChecked ? weekPlan : undefined, saveWeek, planNewWeek, swapForBusyNight, submitCheckin, onHand, planAroundOnHand, planReview, setPlanReview, undoPlanReview,
    openSuggestions: (target?: SuggestionsTarget) => setSuggestions({ open: true, target: target ?? null }),
    openPhotoSearch: () => setPhotoOpen(true),
    billing,
  } : null), [billing, session, userId, prefs, shownPrefs, members, familyAvailable, updatePrefs, saveFamilyMember, removeFamilyMember, profile, weekPlan, planChecked, saveWeek, planNewWeek, swapForBusyNight, submitCheckin, onHand, planAroundOnHand, planReview, undoPlanReview, favorites, toggleFavorite, go, replace, back, isPhone]);

  if (prefs === undefined || members === undefined) return <Loading />;
  if (loadError || !prefs || !ctx) {
    return (
      <div className="mx-auto flex h-dvh w-full max-w-column flex-col items-start justify-center px-gutter">
        <h1 className="display text-title text-ink">Couldn't load your account</h1>
        <p className="mt-2 text-body text-ink-muted">Check your connection, then reload the page.</p>
        <Button className="mt-6" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
  if (!prefs.onboarded_at) {
    return <Onboarding userId={userId} initial={prefs} askFamily={familyAvailable} onDone={(p, added) => { setPrefs(p); if (added.length) setMembers(list => [...(list ?? []), ...added]); }} onSignOut={() => void signOutToWebsite()} />;
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
    case 'pantry': content = <CookWithWhatYouHave />; break;
    case 'pro': content = <Pro />; break;
    case 'editor': content = <RecipeEditor key={screen.id ?? `new:${stack.length}`} id={screen.id} draft={screen.draft} duplicate={screen.duplicate ?? undefined} note={screen.note} />; break;
    case 'import': content = <ImportRecipe key={`import:${stack.length}`} {...screen} />; break;
  }

  const root = stack[0].name as NavId;
  const showNav = !WITH_BOTTOM_BAR.includes(screen.name);

  return (
    <AppContext.Provider value={ctx}>
      <div style={{ '--tray-bottom': showNav ? 'var(--tabbar-space)' : 'var(--bottombar-space)' } as React.CSSProperties}>
        <AppFrame
          showBrand={screen.name !== 'cooking'}
          active={(TABS as string[]).includes(root) ? root : 'mealplan'}
          onSelect={id => go({ name: id })}
          showNav={showNav}
          mainRef={mainRef}
          overlay={<>
            <SuggestionsPanel open={suggestions.open} target={suggestions.target} onClose={() => setSuggestions(s => ({ ...s, open: false }))} />
            <PhotoSearch open={photoOpen} onClose={() => setPhotoOpen(false)} />
            <TimerTray />
            <UpgradeSheet reason={billing.plan === 'pro' || planState !== 'ready' ? null : upgradeReason} onClose={() => setUpgradeReason(null)} onSeePro={() => { setUpgradeReason(null); go({ name: 'pro' }); }} />
            <CheckoutSheet ret={billingReturn} onClose={() => setBillingReturn(null)} />
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
