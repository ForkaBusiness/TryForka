import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, BookOpen, CalendarDays, CalendarPlus, ChefHat, Clock, Lightbulb, UtensilsCrossed } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getCards, minutesLabel, photo, recipeTitle, type RecipeCard } from '../lib/catalog';
import { DAYS, DAY_LONG, DAY_SHORT, generateWeekPlan, planEntries, slotKey, SLOT_LABEL, todayKey, type Day, type PlanEntry, type Slot } from '../lib/plan';
import { BottomSheet, Button, Card, cx, EmptyState, GlassPill, ListGroup, ListRow, PageContainer, Photo, recipeTags, shortMinutes, Skeleton } from '../components/ds';

// Home: answers "what's for dinner tonight" first. The selected day's dinner as the one
// bold card, the week as a strip of day cards under it, then breakfast/lunch and the rest
// of the week.

function useCards(entries: PlanEntry[]): Map<number, RecipeCard> {
  const [cards, setCards] = useState<Map<number, RecipeCard>>(new Map());
  const ids = entries.map(e => e.id).sort().join(',');
  useEffect(() => {
    let cancelled = false;
    getCards(ids ? ids.split(',').map(Number) : []).then(m => { if (!cancelled) setCards(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ids]);
  return cards;
}

const NO_SAFE_RECIPE = 'No recipe fits your settings for this meal';

const plannedOn = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

/** Seven day cards, like a calendar on the fridge. Today sits raised; the selected day is outlined. */
function WeekStrip({ selected, onSelect, today, thumb }: { selected: Day; onSelect: (d: Day) => void; today: Day; thumb: (d: Day) => string | null | undefined }) {
  return (
    <div role="tablist" aria-label="Day" className="no-scrollbar -mx-gutter flex gap-2 overflow-x-auto px-gutter pt-2 pb-3 md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0">
      {DAYS.map(d => {
        const active = d === selected;
        const isToday = d === today;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${DAY_LONG[d]}${isToday ? ', today' : ''}`}
            onClick={() => onSelect(d)}
            className={cx(
              'flex w-18 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-photo border bg-surface p-2 transition-[transform,box-shadow,border-color] duration-150 ease-spring md:w-auto',
              active ? 'border-green ring-1 ring-green' : 'border-line',
              isToday ? '-translate-y-1 shadow-md' : 'shadow-sm',
            )}
          >
            <span className={cx('text-caption font-bold', isToday ? 'text-green' : active ? 'text-ink' : 'text-ink-muted')}>{isToday ? 'Today' : DAY_SHORT[d]}</span>
            <Photo src={photo(thumb(d), 'small')} className="aspect-square w-full rounded-sm" />
          </button>
        );
      })}
    </div>
  );
}

function DinnerHero({ day, entry, card, isToday, blocked, onOpen, onCook, onSwap }: {
  day: Day; entry: PlanEntry | null; card?: RecipeCard; isToday: boolean; blocked: boolean;
  onOpen: () => void; onCook: () => void; onSwap: () => void;
}) {
  const label = isToday ? 'Tonight' : `${DAY_LONG[day]} dinner`;
  if (!entry) {
    return (
      <section aria-label={label} className="mb-6">
        <EmptyState icon={UtensilsCrossed} title={blocked ? NO_SAFE_RECIPE : 'Nothing planned yet'}
          action={<Button size="lg" block icon={ArrowLeftRight} onClick={onSwap}>Find a dinner</Button>}>
          {blocked ? 'Pick one yourself, or loosen a setting.' : `Pick a dinner for ${isToday ? 'tonight' : DAY_LONG[day]} and it goes on the grocery list.`}
        </EmptyState>
      </section>
    );
  }
  const tags = card ? recipeTags(card) : [];
  return (
    <section aria-label={label} className="mb-6">
      <Card className="overflow-hidden">
        <div className="relative">
          <button type="button" onClick={onOpen} className="block w-full cursor-pointer" aria-label={`Open ${entry.title}`}>
            <Photo src={photo(card?.thumb_url ?? entry.image, 'large')} eager className="aspect-4/3 w-full md:aspect-video" />
          </button>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap gap-2">
            {card?.total_minutes ? <GlassPill icon={Clock}>{shortMinutes(card.total_minutes)}</GlassPill> : null}
            {tags[0] && <GlassPill>{tags[0]}</GlassPill>}
          </div>
        </div>
        <div className="p-5">
          <p className="label">{label}</p>
          <h2 className="display mt-1 text-title text-ink">
            <button type="button" onClick={onOpen} className="cursor-pointer text-left">{card ? recipeTitle(card) : entry.title}</button>
          </h2>
          {card?.subtitle && <p className="mt-1 text-body text-ink-muted">{card.subtitle}</p>}
          <div className="mt-5 flex gap-3">
            <Button size="lg" icon={ChefHat} className="flex-1 sm:min-w-56 sm:flex-none" onClick={onCook}>Start cooking</Button>
            <Button size="lg" variant="secondary" icon={ArrowLeftRight} onClick={onSwap}>Swap</Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

function Thumb({ src }: { src?: string | null }) {
  return <Photo src={photo(src, 'small')} className="size-12 shrink-0 rounded-photo" />;
}

/** The line under the title: the day, and how long dinner takes. */
function dayLine(day: Day, minutes?: number | null) {
  return [DAY_LONG[day], minutesLabel(minutes)].filter(Boolean).join(' · ');
}

export function MealPlan() {
  const { weekPlan, prefs, saveWeek, planReview, setPlanReview, undoPlanReview, go, openSuggestions } = useApp();
  const today = todayKey();
  const [day, setDay] = useState<Day>(today);
  const [planning, setPlanning] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const entries = useMemo(() => (weekPlan ? planEntries(weekPlan.plan).map(e => e.entry) : []), [weekPlan]);
  const cards = useCards(entries);

  const planWeek = async () => {
    setConfirmReplace(false);
    setError(null);
    setPlanning(true);
    try {
      const week = await generateWeekPlan(prefs);
      await saveWeek(week.plan, true);
      setPlanReview({ notice: week.notice, blocked: week.blocked });
      setDay(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't plan your week. Try again.");
    } finally {
      setPlanning(false);
    }
  };
  const newWeek = () => (weekPlan ? setConfirmReplace(true) : void planWeek());

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
  const notice = planReview.notice && (
    <Card role="status" className="flex items-center justify-between gap-3 px-4 py-3 text-small text-ink-muted">
      <p className="min-w-0">{planReview.notice}</p>
      {planReview.undo && (
        <Button size="sm" variant="ghost" loading={undoing} onClick={undo} aria-label="Undo: put back the previous meals and setting">Undo</Button>
      )}
    </Card>
  );

  if (weekPlan === undefined) {
    return (
      <PageContainer>
        <div aria-busy aria-label="Loading your week">
          <Skeleton className="h-9 w-2/3 rounded-full" />
          <Skeleton className="mt-3 mb-6 h-4 w-1/3 rounded-full" />
          <Skeleton className="aspect-4/3 w-full rounded-card md:aspect-video" />
          <div className="mt-6 grid grid-cols-7 gap-2">{DAYS.map(d => <Skeleton key={d} className="h-20" />)}</div>
        </div>
      </PageContainer>
    );
  }

  if (!weekPlan || !entries.length) {
    return (
      <PageContainer title="This week">
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
          {planning ? 'Picking dinners that fit your household. This takes a few seconds.' : "We'll pick a week of dinners that fit your household, and make the grocery list."}
        </EmptyState>
        {error && <p role="alert" className="mt-4 text-small text-terracotta-deep">{error}</p>}
        {notice && <div className="mt-4">{notice}</div>}
      </PageContainer>
    );
  }

  const plan = weekPlan.plan;
  const otherSlots: Slot[] = (['breakfast', 'lunch'] as const).filter(s => plan[day][s] || (s === 'breakfast' ? prefs.plan_breakfast : prefs.plan_lunch));
  const later = DAYS.slice(DAYS.indexOf(day) + 1);
  const open = (id: number) => go({ name: 'recipe', id });
  const isBlocked = (d: Day, s: Slot) => planReview.blocked.includes(slotKey(d, s));
  const dinner = plan[day].dinner;
  const dinnerCard = dinner ? cards.get(dinner.id) : undefined;
  const isToday = day === today;
  const headline = dinner
    ? (isToday ? "Tonight's sorted." : `${DAY_LONG[day]}'s sorted.`)
    : (isToday ? 'Nothing planned tonight.' : `Nothing planned ${DAY_LONG[day]}.`);

  return (
    <PageContainer title={headline} intro={dayLine(day, dinnerCard?.total_minutes)}>
      {error && <p role="alert" className="mb-4 text-small text-terracotta-deep">{error}</p>}
      {notice && <div className="mb-4">{notice}</div>}

      <DinnerHero
        day={day}
        entry={dinner}
        card={dinnerCard}
        isToday={isToday}
        blocked={isBlocked(day, 'dinner')}
        onOpen={() => dinner && open(dinner.id)}
        onCook={() => dinner && go({ name: 'cooking', id: dinner.id })}
        onSwap={() => openSuggestions({ day, slot: 'dinner' })}
      />

      <WeekStrip selected={day} onSelect={setDay} today={today}
        thumb={d => (plan[d].dinner ? cards.get(plan[d].dinner!.id)?.thumb_url ?? plan[d].dinner!.image : null)} />

      {otherSlots.length > 0 && (
        <ListGroup label={isToday ? 'Also today' : `Also ${DAY_LONG[day]}`} className="mt-5">
          {otherSlots.map(slot => {
            const entry = plan[day][slot];
            const card = entry ? cards.get(entry.id) : undefined;
            return entry ? (
              <ListRow key={slot} leading={<Thumb src={card?.thumb_url ?? entry.image} />} title={card ? recipeTitle(card) : entry.title}
                subtitle={SLOT_LABEL[slot]} chevron onClick={() => open(entry.id)} />
            ) : (
              <ListRow key={slot} leading={<Thumb />} title={`Add ${SLOT_LABEL[slot].toLowerCase()}`} subtitle={isBlocked(day, slot) ? NO_SAFE_RECIPE : 'Nothing planned'}
                chevron onClick={() => openSuggestions({ day, slot })} />
            );
          })}
        </ListGroup>
      )}

      {later.length > 0 && (
        <section aria-labelledby="rest-of-week" className="mt-6">
          <p id="rest-of-week" className="label mb-2 px-1">Rest of the week</p>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {later.map(d => {
                const dinner = plan[d].dinner;
                const card = dinner ? cards.get(dinner.id) : undefined;
                const others = (['breakfast', 'lunch'] as const).map(s => plan[d][s]).filter((e): e is PlanEntry => !!e);
                return (
                  <li key={d}>
                    <button type="button" onClick={() => { setDay(d); document.querySelector('main')?.scrollTo({ top: 0 }); }}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-cream/70 active:bg-cream">
                      <span className="w-9 shrink-0 text-small font-bold text-ink-muted">{DAY_SHORT[d]}</span>
                      <Thumb src={card?.thumb_url ?? dinner?.image} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-body font-medium text-ink">
                          {dinner ? (card ? recipeTitle(card) : dinner.title) : isBlocked(d, 'dinner') ? NO_SAFE_RECIPE : 'No dinner planned'}
                        </span>
                        {others.length > 0 && <span className="block truncate text-small text-ink-muted">{others.map(o => cards.get(o.id) ? recipeTitle(cards.get(o.id)!) : o.title).join(', ')}</span>}
                      </span>
                      {card?.total_minutes ? <span className="shrink-0 text-small text-ink-muted">{shortMinutes(card.total_minutes)}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      <ListGroup label="Plan" className="mt-6">
        <ListRow leading={<BookOpen size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Browse recipes" chevron onClick={() => go({ name: 'browse' })} />
        <ListRow leading={<Lightbulb size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title="Suggestions" chevron onClick={() => openSuggestions()} />
        <ListRow leading={<CalendarPlus size={20} strokeWidth={1.75} aria-hidden className="text-green" />} title={planning ? 'Planning a new week…' : 'New week plan'}
          subtitle={`This one was planned ${plannedOn(weekPlan.createdAt)}`} chevron onClick={planning ? undefined : newWeek} />
      </ListGroup>

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
        <p className="text-body text-ink-muted">You'll get a new week of meals, and the grocery list will be rebuilt. Items you already checked off stay checked if they're still on it.</p>
      </BottomSheet>
    </PageContainer>
  );
}
