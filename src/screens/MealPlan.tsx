import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, BookOpen, Refrigerator, CalendarDays, CalendarPlus, ChefHat, ChevronRight, Clock, Lightbulb, Lock, LockOpen, MoreHorizontal, MoveRight, Plus, Trash2,
  UtensilsCrossed, Zap,
} from 'lucide-react';
import { useApp } from '../app/AppContext';
import { minutesLabel, photo, recipeTitle, safeCardMap, type RecipeCard } from '../lib/catalog';
import type { Preferences } from '../lib/preferences';
import { DAYS, DAY_LONG, DAY_SHORT, emptyPlan, plannedSlots as planSlots, planEntries, slotKey, SLOT_LABEL, SLOTS, todayKey, withSlot, type Day, type PlanEntry, type Slot, type WeekPlan } from '../lib/plan';

/** The meals around dinner, in the order a day runs. */
const OTHER_SLOTS = SLOTS.filter((s): s is Exclude<Slot, 'dinner'> => s !== 'dinner');
import { CheckIn } from '../components/CheckIn';
import { slotOnDay } from '../lib/meals';
import { MealsCheckIn } from '../components/MealsCheckIn';
import { activeOnHand } from '../lib/onHand';
import { CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { ImportRows } from '../components/ImportEntry';
import { BottomSheet, Button, Card, cx, EmptyState, GlassPill, IconButton, ListGroup, ListRow, PageContainer, Photo, recipeTags, shortMinutes, Skeleton } from '../components/ds';

// Home: the week as a calendar. Tonight's dinner is the one raised card with the photo;
// every other day is a row with its photo, name and time. Tapping a day opens its sheet:
// swap, move, lock, remove, or trade it for something faster on a busy night.

/**
 * The planned recipes as the gate returns them: a recipe the family can't eat isn't in the
 * map. Null until they've loaded; a failed load is tried again rather than treated as empty.
 */
function useCards(entries: PlanEntry[], prefs: Preferences): Map<number, RecipeCard> | null {
  const [cards, setCards] = useState<{ ids: string; map: Map<number, RecipeCard> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ids = entries.map(e => e.id).sort().join(',');
  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;
    safeCardMap(ids ? ids.split(',').map(Number) : [], prefs)
      .then(map => { if (!cancelled) setCards({ ids, map }); })
      .catch(() => { if (!cancelled) retry = window.setTimeout(() => setAttempt(n => n + 1), 4000); });
    return () => { cancelled = true; window.clearTimeout(retry); };
  }, [ids, prefs, attempt]);
  // Cards loaded for an earlier version of the plan don't speak for this one.
  return cards && cards.ids === ids ? cards.map : null;
}

/**
 * The plan as it may be drawn. A plan entry carries its own title and photo, so it is only
 * shown when its recipe came back from the gate: one the family can't eat, or that couldn't
 * be checked, is an open day.
 */
function shownPlan(plan: WeekPlan, cards: Map<number, RecipeCard>): WeekPlan {
  const out = emptyPlan();
  for (const d of DAYS) for (const s of SLOTS) {
    const entry = plan[d][s];
    out[d][s] = entry && cards.has(entry.id) ? entry : null;
  }
  return out;
}

const NO_SAFE_RECIPE = 'No recipe fits your settings for this meal';
const plannedOn = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const icon = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

function Thumb({ src, size = 'size-12' }: { src?: string | null; size?: string }) {
  return <Photo src={photo(src, 'small')} className={cx(size, 'shrink-0 rounded-photo')} />;
}

/** Where a dinner would go: a dashed square the same size as a photo. */
function OpenSlot({ size = 'size-14' }: { size?: string }) {
  return (
    <span aria-hidden className={cx(size, 'flex shrink-0 items-center justify-center rounded-photo border border-dashed border-ink-muted/50 text-ink-muted')}>
      <Plus size={20} strokeWidth={1.75} />
    </span>
  );
}

/** Tonight: the one raised card on the screen. */
function Tonight({ entry, card, blocked, busy, onOpen, onCook, onMore, onBusy, onFind }: {
  entry: PlanEntry | null; card?: RecipeCard; blocked: boolean; busy: boolean;
  onOpen: () => void; onCook: () => void; onMore: () => void; onBusy: () => void; onFind: () => void;
}) {
  if (!entry) {
    return (
      <section aria-label="Tonight" className="mb-6">
        <EmptyState icon={UtensilsCrossed} title={blocked ? NO_SAFE_RECIPE : 'Nothing planned tonight'}
          action={<Button size="lg" block icon={ArrowLeftRight} onClick={onFind}>Find a dinner</Button>}>
          {blocked ? `Pick one yourself, or loosen a setting. ${CHECK_INGREDIENTS}` : 'Pick a dinner for tonight and it goes on the grocery list.'}
        </EmptyState>
      </section>
    );
  }
  const tags = card ? recipeTags(card) : [];
  return (
    <section aria-label="Tonight" className="mb-6">
      <Card className="overflow-hidden shadow-md">
        <div className="relative">
          <button type="button" onClick={onOpen} className="block w-full cursor-pointer" aria-label={`Open ${entry.title}`}>
            <Photo src={photo(card?.thumb_url ?? entry.image, 'large')} eager className="aspect-3/2 w-full md:aspect-video" />
          </button>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap gap-2">
            {card?.total_minutes ? <GlassPill icon={Clock}>{shortMinutes(card.total_minutes)}</GlassPill> : null}
            {tags[0] && <GlassPill>{tags[0]}</GlassPill>}
            {entry.locked && <GlassPill icon={Lock}>Locked</GlassPill>}
          </div>
        </div>
        <div className="p-5">
          <p className="label">Tonight</p>
          <h2 className="display mt-1 text-title text-ink">
            <button type="button" onClick={onOpen} className="cursor-pointer text-left">{card ? recipeTitle(card) : entry.title}</button>
          </h2>
          {card?.subtitle && <p className="mt-1 text-body text-ink-muted">{card.subtitle}</p>}
          <div className="mt-5 flex items-center gap-3">
            <Button size="lg" icon={ChefHat} className="flex-1 sm:min-w-56 sm:flex-none" onClick={onCook}>Start cooking</Button>
            <IconButton icon={MoreHorizontal} label="Change tonight's dinner" variant="outlined" size="lg" onClick={onMore} />
          </div>
          <Button variant="secondary" icon={Zap} block className="mt-3 sm:w-auto" loading={busy} onClick={onBusy}>Busy night: something faster</Button>
        </div>
      </Card>
    </section>
  );
}

/** One day of the week: day, photo, name, time. */
function DayRow({ day, entry, card, others, blocked, past, onSelect }: {
  day: Day; entry: PlanEntry | null; card?: RecipeCard; others: string[]; blocked: boolean; past?: boolean; onSelect: () => void;
}) {
  const title = entry ? (card ? recipeTitle(card) : entry.title) : blocked ? NO_SAFE_RECIPE : 'Nothing planned';
  const time = entry ? shortMinutes(card?.total_minutes) : '';
  return (
    <li>
      <button type="button" onClick={onSelect} aria-label={`${DAY_LONG[day]}: ${title}${time ? `, ${time}` : ''}${entry?.locked ? ', locked' : ''}`}
        className="flex min-h-20 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-cream/70 active:bg-cream">
        <span className="w-9 shrink-0 text-small font-bold text-ink-muted">{DAY_SHORT[day]}</span>
        {entry ? <Thumb src={card?.thumb_url ?? entry.image} size="size-14" /> : <OpenSlot />}
        <span className="min-w-0 flex-1">
          <span className={cx('line-clamp-2 text-body font-medium', entry && !past ? 'text-ink' : 'text-ink-muted')}>{title}</span>
          <span className="flex items-center gap-1.5 text-small text-ink-muted">
            {entry ? (
              <>
                {time && <span className="shrink-0">{time}</span>}
                {entry.locked && <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-green"><Lock size={14} strokeWidth={2} aria-hidden />Locked</span>}
                {others.length > 0 && <span className="truncate">{time || entry.locked ? 'plus ' : 'Plus '}{others.join(', ')}</span>}
              </>
            ) : !blocked && <span>Add a dinner</span>}
          </span>
        </span>
        <ChevronRight {...icon} className="shrink-0 text-ink-muted" />
      </button>
    </li>
  );
}

/** What you can do with one day's dinner. */
function DaySheet({ day, plan, cards, today, blocked, plannedSlots, busy, message, onClose, act }: {
  day: Day | null; plan: WeekPlan; cards: Map<number, RecipeCard>; today: Day; blocked: (d: Day, s: Slot) => boolean; plannedSlots: Slot[]; busy: boolean;
  /** What came of the last action, when the sheet stays open to say it. */
  message: string | null;
  onClose: () => void;
  act: { open: (id: number) => void; swap: (d: Day, s: Slot) => void; busy: (d: Day) => void; move: (from: Day, to: Day) => void; lock: (d: Day) => void; remove: (d: Day) => void };
}) {
  const [moving, setMoving] = useState(false);
  useEffect(() => setMoving(false), [day]);
  if (!day) return null;
  const entry = plan[day].dinner;
  const card = entry ? cards.get(entry.id) : undefined;
  // A dinner that's already behind us can't be made quicker.
  const ahead = DAYS.indexOf(day) >= DAYS.indexOf(today);
  // While a faster dinner is being looked for, the other actions wait: they'd change the plan under it.
  const unless = <T,>(fn: T) => (busy ? undefined : fn);
  // School lunches are weekdays only.
  const otherSlots = OTHER_SLOTS.filter(s => plan[day][s] || (plannedSlots.includes(s) && slotOnDay(s, day)));
  const green = 'text-green';

  return (
    <BottomSheet open onClose={onClose} title={day === today ? "Tonight's dinner" : `${DAY_LONG[day]} dinner`} side="bottom">
      {entry ? (
        <div className="mb-4 flex items-center gap-3">
          <Thumb src={card?.thumb_url ?? entry.image} size="size-16" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-body font-semibold text-ink">{card ? recipeTitle(card) : entry.title}</p>
            <p className="text-small text-ink-muted">{[minutesLabel(card?.total_minutes), entry.locked ? 'Locked' : ''].filter(Boolean).join(', ')}</p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-body text-ink-muted">{blocked(day, 'dinner') ? `${NO_SAFE_RECIPE}. Pick one yourself, or loosen a setting. ${CHECK_INGREDIENTS}` : `Nothing planned for ${day === today ? 'tonight' : DAY_LONG[day]} yet.`}</p>
      )}

      {/* Said aloud for screen readers: the row itself stops being a button while it works. */}
      <p role="status" className="sr-only">{busy ? 'Finding something faster' : ''}</p>
      {message && <p role="status" className="mb-3 text-small text-ink-muted">{message}</p>}

      {moving && entry ? (
        <div>
          <p className="label mb-2 px-1">Move to</p>
          <ListGroup>
            {DAYS.filter(d => d !== day).map(d => {
              const there = plan[d].dinner;
              return (
                <ListRow key={d} leading={<span className="w-9 shrink-0 text-small font-bold text-ink-muted">{DAY_SHORT[d]}</span>}
                  title={there ? `Trade with ${cards.get(there.id) ? recipeTitle(cards.get(there.id)!) : there.title}` : 'Open day'}
                  subtitle={there?.locked ? 'Locked. Unlock it to trade.' : undefined}
                  // A locked day stays as it is, so it can't be traded into.
                  onClick={there?.locked ? undefined : () => act.move(day, d)} />
              );
            })}
          </ListGroup>
          <Button variant="ghost" className="mt-3" onClick={() => setMoving(false)}>Back</Button>
        </div>
      ) : entry ? (
        <ListGroup>
          <ListRow leading={<BookOpen {...icon} className={green} />} title="Open recipe" chevron onClick={() => act.open(entry.id)} />
          <ListRow leading={<ArrowLeftRight {...icon} className={green} />} title="Swap for something else" chevron onClick={unless(() => act.swap(day, 'dinner'))} />
          {ahead && (
            <ListRow leading={<Zap {...icon} className={green} />} title={busy ? 'Finding something faster…' : 'Busy night'}
              subtitle="Something faster that uses what's on your list" onClick={unless(() => act.busy(day))} />
          )}
          <ListRow leading={<MoveRight {...icon} className={green} />} title="Move to another day" chevron onClick={unless(() => setMoving(true))} />
          <ListRow leading={entry.locked ? <LockOpen {...icon} className={green} /> : <Lock {...icon} className={green} />}
            title={entry.locked ? 'Unlock this day' : 'Lock this day'} subtitle={entry.locked ? undefined : "It stays put when the plan updates or a new week is planned"}
            onClick={unless(() => act.lock(day))} />
          <ListRow leading={<Trash2 {...icon} className="text-terracotta" />} title="Remove from the week" destructive onClick={unless(() => act.remove(day))} />
        </ListGroup>
      ) : (
        <ListGroup>
          <ListRow leading={<Lightbulb {...icon} className={green} />} title="Find a dinner" subtitle="Options that fit your household" chevron onClick={() => act.swap(day, 'dinner')} />
        </ListGroup>
      )}

      {!moving && otherSlots.length > 0 && (
        <ListGroup label={day === today ? 'Also today' : `Also ${DAY_LONG[day]}`} className="mt-5">
          {otherSlots.map(slot => {
            const other = plan[day][slot];
            const otherCard = other ? cards.get(other.id) : undefined;
            return other ? (
              <ListRow key={slot} leading={<Thumb src={otherCard?.thumb_url ?? other.image} />} title={otherCard ? recipeTitle(otherCard) : other.title}
                subtitle={SLOT_LABEL[slot]} chevron onClick={() => act.open(other.id)} />
            ) : (
              <ListRow key={slot} leading={<OpenSlot size="size-12" />} title={`Add ${SLOT_LABEL[slot].toLowerCase()}`}
                subtitle={blocked(day, slot) ? NO_SAFE_RECIPE : 'Nothing planned'} chevron onClick={() => act.swap(day, slot)} />
            );
          })}
        </ListGroup>
      )}
    </BottomSheet>
  );
}

export function MealPlan() {
  const { weekPlan, prefs, saveWeek, planNewWeek, swapForBusyNight, planReview, undoPlanReview, go, openSuggestions, onHand, billing, members } = useApp();
  const usingUp = activeOnHand(onHand);
  const today = todayKey();
  const [sheetDay, setSheetDay] = useState<Day | null>(null);
  const [planning, setPlanning] = useState(false);
  const [busyDay, setBusyDay] = useState<Day | null>(null);
  /** Something worth saying that isn't a problem ("nothing faster fits"). */
  const [info, setInfo] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  /** The plan with edits that are still saving, so the next edit builds on them. */
  const pending = useRef<WeekPlan | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const hasPlan = useRef(false);
  hasPlan.current = !!weekPlan;
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const planned = useMemo(() => (weekPlan ? planEntries(weekPlan.plan).map(e => e.entry) : []), [weekPlan]);
  const loadedCards = useCards(planned, prefs);

  const planWeek = async () => {
    setConfirmReplace(false);
    setError(null);
    setPlanning(true);
    try {
      await planNewWeek();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't plan your week. Try again.");
    } finally {
      setPlanning(false);
    }
  };

  const undo = async () => {
    setError(null);
    setUndoing(true);
    try {
      await undoPlanReview();
    } catch {
      setError("Couldn't undo that. Check your connection and try again.");
    } finally {
      setUndoing(false);
    }
  };

  if (weekPlan === undefined || loadedCards === null) {
    return (
      <PageContainer wide>
        <div aria-busy aria-label="Loading your week" className="lg:grid lg:grid-cols-5 lg:gap-x-6">
          <div className="lg:col-span-3">
            <Skeleton className="h-9 w-2/3 rounded-full" />
            <Skeleton className="mt-3 mb-6 h-4 w-1/3 rounded-full" />
            <Skeleton className="aspect-3/2 w-full rounded-card md:aspect-video" />
          </div>
          <div className="mt-6 grid gap-2 lg:col-span-2 lg:mt-20">{DAYS.slice(1).map(d => <Skeleton key={d} className="h-20" />)}</div>
        </div>
      </PageContainer>
    );
  }

  const cards = loadedCards;
  const plan = shownPlan(weekPlan?.plan ?? emptyPlan(), cards);
  const hasMeals = planEntries(plan).length > 0;
  const isBlocked = (d: Day, s: Slot) => planReview.blocked.includes(slotKey(d, s));
  // The meals around dinner this household plans (Pro); whatever a week already holds still shows.
  const plannedSlots: Slot[] = planSlots(prefs, billing.plan, members).filter(s => s !== 'dinner');
  const open = (id: number) => { setSheetDay(null); go({ name: 'recipe', id }); };
  const dinner = plan[today].dinner;
  const dinnerCard = dinner ? cards.get(dinner.id) : undefined;
  const todayIndex = DAYS.indexOf(today);
  const upcoming = DAYS.slice(todayIndex + 1);
  const earlier = DAYS.slice(0, todayIndex);

  /** What a note or message says is up there: bring it into view on a phone. */
  const toTop = () => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });

  /**
   * A change made from a day's sheet. The sheet closes first, so the week shows the result.
   * Changes build on each other in the order they were made, even when the first is still
   * saving: locking Thursday and then Friday keeps both.
   */
  const change = (build: (p: WeekPlan) => WeekPlan, opts?: { quiet?: boolean }) => {
    const next = build(pending.current ?? plan);
    pending.current = next;
    setSheetDay(null);
    setError(null);
    setInfo(null);
    const fresh = !hasPlan.current;
    saves.current = saves.current.then(async () => {
      try {
        await saveWeek(next, fresh, opts);
      } catch {
        setError("Couldn't update your week. Check your connection and try again.");
        toTop();
      } finally {
        if (pending.current === next) pending.current = null;
      }
    });
  };
  const busyNight = async (day: Day, fromSheet: boolean) => {
    setError(null);
    setInfo(null);
    setSheetMessage(null);
    setBusyDay(day);
    try {
      const result = await swapForBusyNight(day);
      if (result === 'swapped') {
        // Only the sheet the swap was started from closes; the note with Undo is at the top.
        setSheetDay(d => (d === day ? null : d));
        toTop();
      } else if (result === 'none') {
        const text = `Nothing much faster fits ${day === today ? 'tonight' : DAY_LONG[day]}. Dinner stays as it is.`;
        if (fromSheet) setSheetMessage(text); else setInfo(text);
      }
      // 'stale': the week changed while we were looking. Nothing was swapped and nothing needs saying.
    } catch {
      const text = "Couldn't find something faster. Check your connection and try again.";
      if (fromSheet) setSheetMessage(text); else setError(text);
    } finally {
      setBusyDay(null);
    }
  };
  const act = {
    open,
    swap: (d: Day, s: Slot) => { setSheetDay(null); openSuggestions({ day: d, slot: s }); },
    busy: (d: Day) => void busyNight(d, true),
    // Two dinners trade places; a move to an open day leaves the old day open.
    move: (from: Day, to: Day) => change(p => withSlot(withSlot(p, from, 'dinner', p[to].dinner), to, 'dinner', p[from].dinner)),
    // Locking says nothing about taste.
    lock: (d: Day) => change(p => { const e = p[d].dinner; return e ? withSlot(p, d, 'dinner', { ...e, locked: !e.locked }) : p; }, { quiet: true }),
    remove: (d: Day) => change(p => withSlot(p, d, 'dinner', null)),
  };
  const openSheet = (d: Day) => { setSheetMessage(null); setSheetDay(d); };

  const notice = planReview.notice && (
    <Card role="status" className="mb-4 flex items-center justify-between gap-3 px-4 py-3 text-small text-ink-muted">
      <p className="min-w-0">{planReview.notice}</p>
      {planReview.undo && (
        <Button size="sm" variant="ghost" loading={undoing} onClick={undo} aria-label="Undo: put back the previous meals">Undo</Button>
      )}
    </Card>
  );

  const row = (d: Day, past?: boolean) => {
    const entry = plan[d].dinner;
    const others = OTHER_SLOTS.map(s => plan[d][s]).filter((e): e is PlanEntry => !!e).map(o => (cards.get(o.id) ? recipeTitle(cards.get(o.id)!) : o.title));
    return <DayRow key={d} day={d} entry={entry} card={entry ? cards.get(entry.id) : undefined} others={others} blocked={isBlocked(d, 'dinner')} past={past} onSelect={() => openSheet(d)} />;
  };
  const week = (days: Day[], label: string, id: string, past?: boolean) => days.length > 0 && (
    <section aria-labelledby={id} className="mb-6">
      <p id={id} className="label mb-2 px-1">{label}</p>
      <Card className="overflow-hidden"><ul className="divide-y divide-line">{days.map(d => row(d, past))}</ul></Card>
    </section>
  );

  const headline = !hasMeals ? 'This week' : dinner ? "Tonight's sorted." : 'Nothing planned tonight.';
  const intro = !hasMeals ? undefined : [DAY_LONG[today], dinner ? minutesLabel(dinnerCard?.total_minutes).toLowerCase() : ''].filter(Boolean).join(', ');
  // Meals already planned always show (nothing is taken away); open slots only for meals planned now.
  const otherToday = OTHER_SLOTS.filter(s => plan[today][s] || (hasMeals && plannedSlots.includes(s) && slotOnDay(s, today)));

  return (
    <PageContainer wide title={headline} intro={intro}>
      <div className="lg:grid lg:grid-cols-5 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-6">
        <div className="lg:col-span-3">
          {error && <p role="alert" className="mb-4 text-small text-terracotta-deep">{error}</p>}
          {info && <p role="status" className="mb-4 text-small text-ink-muted">{info}</p>}
          {notice}
          {hasMeals && <CheckIn />}
          {hasMeals && <MealsCheckIn />}

          {hasMeals ? (
            <Tonight
              entry={dinner}
              card={dinnerCard}
              blocked={isBlocked(today, 'dinner')}
              busy={busyDay === today}
              onOpen={() => dinner && open(dinner.id)}
              onCook={() => dinner && go({ name: 'cooking', id: dinner.id })}
              onMore={() => openSheet(today)}
              onBusy={() => void busyNight(today, false)}
              onFind={() => openSuggestions({ day: today, slot: 'dinner' })}
            />
          ) : (
            <section aria-label="Plan your week" className="mb-6">
              <EmptyState
                icon={CalendarDays}
                title="No meals planned yet"
                action={
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button size="lg" icon={CalendarPlus} loading={planning} onClick={planWeek}>Plan my week</Button>
                    <Button size="lg" variant="secondary" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse recipes</Button>
                  </div>
                }
              >
                {planning ? 'Picking dinners that fit your household.' : "We'll pick a week of dinners that fit your household, and make the grocery list. Or tap a day and choose your own."}
              </EmptyState>
            </section>
          )}

          {otherToday.length > 0 && (
            <ListGroup label="Also today" className="mb-6">
              {otherToday.map(slot => {
                const entry = plan[today][slot];
                const card = entry ? cards.get(entry.id) : undefined;
                return entry ? (
                  <ListRow key={slot} leading={<Thumb src={card?.thumb_url ?? entry.image} />} title={card ? recipeTitle(card) : entry.title}
                    subtitle={SLOT_LABEL[slot]} chevron onClick={() => open(entry.id)} />
                ) : (
                  <ListRow key={slot} leading={<OpenSlot size="size-12" />} title={`Add ${SLOT_LABEL[slot].toLowerCase()}`} subtitle={isBlocked(today, slot) ? NO_SAFE_RECIPE : 'Nothing planned'}
                    chevron onClick={() => openSuggestions({ day: today, slot })} />
                );
              })}
            </ListGroup>
          )}
        </div>

        <div className="lg:col-span-2 lg:row-span-2">
          {hasMeals ? (
            <>
              {week(upcoming, 'This week', 'this-week')}
              {week(earlier, 'Earlier this week', 'earlier-this-week', true)}
            </>
          ) : week([...DAYS], 'This week', 'this-week')}
        </div>

        <ListGroup label="Plan" className="lg:col-span-3">
          <ListRow leading={<BookOpen {...icon} className="text-green" />} title="Browse recipes" chevron onClick={() => go({ name: 'browse' })} />
          <ListRow leading={<Refrigerator {...icon} className="text-green" />} title="Cook with what you have" chevron onClick={() => go({ name: 'pantry' })}
            subtitle={usingUp.length ? `Using up ${usingUp.length <= 1 ? usingUp.join('') : `${usingUp.slice(0, -1).join(', ')} and ${usingUp[usingUp.length - 1]}`}` : undefined} />
          <ListRow leading={<Lightbulb {...icon} className="text-green" />} title="Suggestions" chevron onClick={() => openSuggestions()} />
          <ImportRows iconClass="text-green" />
          {hasMeals && weekPlan && (
            <ListRow leading={<CalendarPlus {...icon} className="text-green" />} title={planning ? 'Planning a new week…' : 'New week plan'}
              subtitle={`This one was planned ${plannedOn(weekPlan.createdAt)}`} chevron onClick={planning ? undefined : () => setConfirmReplace(true)} />
          )}
        </ListGroup>
      </div>

      <DaySheet day={sheetDay} plan={plan} cards={cards} today={today} blocked={isBlocked} plannedSlots={plannedSlots} busy={busyDay !== null} message={sheetMessage}
        onClose={() => setSheetDay(null)} act={act} />

      <BottomSheet
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title="Replace this week's plan?"
        side="bottom"
        role="alertdialog"
        footer={
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button size="lg" variant="secondary" onClick={() => setConfirmReplace(false)}>Keep current plan</Button>
            <Button size="lg" onClick={planWeek}>Replace</Button>
          </div>
        }
      >
        <p className="text-body text-ink-muted">You'll get a new week of meals, and the grocery list will be rebuilt. Items you already checked off this week stay checked if they're still on it. Locked days stay as they are.</p>
      </BottomSheet>
    </PageContainer>
  );
}
