import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, BookOpen, CalendarPlus, ChefHat, ShoppingBasket } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { getCards, minutesLabel, photo, recipeMeta, recipeTitle, type RecipeCard } from '../lib/catalog';
import { DAYS, DAY_LONG, DAY_SHORT, generateWeekPlan, planEntries, slotKey, SLOT_LABEL, todayKey, type Day, type PlanEntry, type Slot } from '../lib/plan';
import { Button, cx, EmptyState, ListRow, PageContainer, Sheet, Skeleton, Tag } from '../components/ds';

// Home: answers "what's for dinner tonight" first. Week strip, then the selected day's
// dinner as the one bold element, then breakfast/lunch, then the rest of the week.

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

function WeekStrip({ selected, onSelect, today }: { selected: Day; onSelect: (d: Day) => void; today: Day }) {
  return (
    <div role="tablist" aria-label="Day" className="mb-6 grid grid-cols-7 gap-1 border-b border-line pb-3">
      {DAYS.map(d => {
        const active = d === selected;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${DAY_LONG[d]}${d === today ? ', today' : ''}`}
            onClick={() => onSelect(d)}
            className={cx(
              'relative flex h-12 cursor-pointer flex-col items-center justify-center rounded-control text-sm transition-colors duration-150',
              active ? 'bg-ink font-semibold text-surface' : 'text-ink-muted hover:bg-surface hover:text-ink',
              d === today && !active && 'font-semibold text-ink',
            )}
          >
            {DAY_SHORT[d]}
            {d === today && <span aria-hidden className="absolute bottom-1.5 size-1.5 rounded-full bg-yolk" />}
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
      <section aria-label={label} className="mb-8 border-y border-line py-8">
        <p className="text-sm font-semibold text-ink-muted">{label}</p>
        <h2 className="mt-1 text-xl text-ink">{blocked ? NO_SAFE_RECIPE : 'Nothing planned yet'}</h2>
        <Button className="mt-4" variant="secondary" icon={ArrowLeftRight} onClick={onSwap}>Find a dinner</Button>
      </section>
    );
  }
  const meta = card ? recipeMeta(card) : '';
  return (
    <section aria-label={label} className="mb-8">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer overflow-hidden rounded-photo bg-line/60" aria-label={`Open ${entry.title}`}>
        <img src={photo(card?.thumb_url ?? entry.image, 'large')} alt="" className="aspect-[4/3] w-full object-cover md:aspect-[2/1]" />
      </button>
      <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-ink">
        {isToday && <span aria-hidden className="size-2 rounded-full bg-yolk" />}
        {label}
      </div>
      <h2 className="mt-1 font-display text-3xl font-semibold tracking-[-0.01em] text-ink md:text-4xl">
        <button type="button" onClick={onOpen} className="cursor-pointer text-left hover:underline hover:decoration-line hover:underline-offset-4">
          {card ? recipeTitle(card) : entry.title}
        </button>
      </h2>
      {card?.subtitle && <p className="mt-1 text-base text-ink-muted">{card.subtitle}</p>}
      {(meta || card?.total_minutes) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {meta && <Tag>{meta}</Tag>}
          {card?.total_minutes ? <Tag>{minutesLabel(card.total_minutes)}</Tag> : null}
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="lg" icon={ChefHat} onClick={onCook}>Start cooking</Button>
        <Button size="lg" variant="secondary" icon={ArrowLeftRight} onClick={onSwap}>Swap</Button>
      </div>
    </section>
  );
}

function Thumb({ src }: { src?: string | null }) {
  return (
    <span className="size-12 shrink-0 overflow-hidden rounded-photo bg-line/60">
      {src && <img src={photo(src, 'small')} alt="" className="size-full object-cover" />}
    </span>
  );
}

export function MealPlan() {
  const { weekPlan, prefs, saveWeek, planReview, setPlanReview, go, openSuggestions } = useApp();
  const today = todayKey();
  const [day, setDay] = useState<Day>(today);
  const [planning, setPlanning] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const actions = (
    <>
      <Button size="sm" variant="quiet" icon={ShoppingBasket} onClick={() => go({ name: 'groceries' })}>Grocery list</Button>
      <Button size="sm" variant="quiet" icon={CalendarPlus} onClick={newWeek} loading={planning}>New week plan</Button>
      <Button size="sm" variant="quiet" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse recipes</Button>
    </>
  );

  if (weekPlan === undefined) {
    return (
      <PageContainer title="This week">
        <Skeleton className="mb-6 h-12" />
        <Skeleton className="aspect-[16/9] w-full" />
      </PageContainer>
    );
  }

  if (!weekPlan || !entries.length) {
    return (
      <PageContainer title="This week" actions={actions}>
        <EmptyState
          title="No meals planned yet"
          action={
            <div className="flex flex-wrap gap-3">
              <Button size="lg" icon={CalendarPlus} loading={planning} onClick={planWeek}>Plan my week</Button>
              <Button size="lg" variant="secondary" icon={BookOpen} onClick={() => go({ name: 'browse' })}>Browse recipes</Button>
            </div>
          }
        >
          {planning ? 'Picking dinners that fit your household. This takes a few seconds.' : "We'll pick a week of dinners that fit your household, and make the grocery list."}
        </EmptyState>
        {error && <p role="alert" className="mt-4 text-sm text-alert">{error}</p>}
        {planReview.notice && <p role="status" className="mt-4 text-sm text-ink-muted">{planReview.notice}</p>}
      </PageContainer>
    );
  }

  const plan = weekPlan.plan;
  const otherSlots: Slot[] = (['breakfast', 'lunch'] as const).filter(s => plan[day][s] || (s === 'breakfast' ? prefs.plan_breakfast : prefs.plan_lunch));
  const later = DAYS.slice(DAYS.indexOf(day) + 1);
  const open = (id: number) => go({ name: 'recipe', id });
  const isBlocked = (d: Day, s: Slot) => planReview.blocked.includes(slotKey(d, s));

  return (
    <PageContainer title="This week" actions={actions} intro={`Planned ${plannedOn(weekPlan.createdAt)}`}>
      <WeekStrip selected={day} onSelect={setDay} today={today} />
      {error && <p role="alert" className="mb-4 text-sm text-alert">{error}</p>}
      {planReview.notice && <p role="status" className="mb-4 text-sm text-ink-muted">{planReview.notice}</p>}

      <DinnerHero
        day={day}
        entry={plan[day].dinner}
        card={plan[day].dinner ? cards.get(plan[day].dinner!.id) : undefined}
        isToday={day === today}
        blocked={isBlocked(day, 'dinner')}
        onOpen={() => plan[day].dinner && open(plan[day].dinner!.id)}
        onCook={() => plan[day].dinner && go({ name: 'cooking', id: plan[day].dinner!.id })}
        onSwap={() => openSuggestions({ day, slot: 'dinner' })}
      />

      {otherSlots.length > 0 && (
        <div className="mb-10 border-t border-line">
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
        </div>
      )}

      {later.length > 0 && (
        <section aria-labelledby="rest-of-week">
          <h2 id="rest-of-week" className="mb-2 text-lg text-ink">Rest of the week</h2>
          <ul className="border-t border-line">
            {later.map(d => {
              const dinner = plan[d].dinner;
              const card = dinner ? cards.get(dinner.id) : undefined;
              const others = (['breakfast', 'lunch'] as const).map(s => plan[d][s]).filter((e): e is PlanEntry => !!e);
              return (
                <li key={d}>
                  <button type="button" onClick={() => { setDay(d); document.querySelector('main')?.scrollTo({ top: 0 }); }}
                    className="flex w-full cursor-pointer items-center gap-4 border-b border-line py-3 text-left hover:bg-basil-soft/40">
                    <span className="w-10 shrink-0 text-sm font-semibold text-ink">{DAY_SHORT[d]}</span>
                    <Thumb src={card?.thumb_url ?? dinner?.image} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-md font-semibold tracking-[-0.01em] text-ink">
                        {dinner ? (card ? recipeTitle(card) : dinner.title) : isBlocked(d, 'dinner') ? NO_SAFE_RECIPE : 'No dinner planned'}
                      </span>
                      {others.length > 0 && <span className="block truncate text-sm text-ink-muted">{others.map(o => cards.get(o.id) ? recipeTitle(cards.get(o.id)!) : o.title).join(', ')}</span>}
                    </span>
                    {card?.total_minutes ? <span className="hidden shrink-0 text-sm text-ink-muted sm:block">{minutesLabel(card.total_minutes)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Sheet
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
        <p className="text-base text-ink-muted">You'll get a new week of meals, and the grocery list will be rebuilt. Items you already checked off stay checked if they're still on it.</p>
      </Sheet>
    </PageContainer>
  );
}
