import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarPlus, ChevronDown, Copy, Plus, Share2, ShoppingBasket, ShoppingCart, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import {
  fetchGroceryList, listMatchesPlan, rebuildGroceryList, saveChecked, saveCustomItems, type CustomItem, type SavedGroceryList,
} from '../lib/groceries';
import { AISLES, amountLines, listText, STAPLES_GROUP, uniqueMeals, type GroceryItem } from '../lib/groceryMerge';
import { Button, Checkbox, cx, EmptyState, IconButton, Input, PageContainer, Skeleton } from '../components/ds';

// The week's grocery list, like a paper list on the counter: grouped by aisle under small
// labels, each item crossed off in place with a pen line when it's checked. Staples sit in
// "Probably have it" at the bottom.

/** One ruled line of the list. */
const ROW = 'flex gap-3 border-b border-line';

function ItemRow({ item, checked, onToggle, units }: { item: GroceryItem; checked: boolean; onToggle: () => void; units: 'us' | 'metric' }) {
  const [open, setOpen] = useState(false);
  const meals = uniqueMeals(item);
  const lines = amountLines(item, units);
  const notes = item.notes.filter(n => n.text);
  return (
    <li className={cx(ROW, 'items-start py-3')}>
      <Checkbox checked={checked} onChange={onToggle} ariaLabel={item.name} />
      <div className="min-w-0 flex-1">
        {/* The checkbox is the control; tapping the name toggles too (mouse/touch convenience). */}
        <span onClick={onToggle} className="block cursor-pointer text-body">
          <span data-checked={checked} className={cx('strike', checked ? 'text-ink-muted' : 'text-ink')}>{item.name}</span>
        </span>
        {meals.length > 1 ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="cursor-pointer text-small text-ink-muted hover:text-ink">
            for {meals.length} meals
          </button>
        ) : meals.length === 1 && !lines.length && !notes.length ? (
          <span className="block text-small text-ink-muted">for {meals[0]}</span>
        ) : null}
        {open && <ul className="mt-1 text-small text-ink-muted">{meals.map(m => <li key={m}>{m}</li>)}</ul>}
      </div>
      <div className={cx('max-w-2/5 shrink-0 text-right', checked ? 'text-ink-muted' : 'text-ink')}>
        {lines.map(l => <span key={l} className="tabular block text-body font-medium">{l}</span>)}
        {notes.map((n, i) => (
          <span key={i} className="block text-small text-ink-muted">{n.text}{meals.length > 1 || lines.length ? `, ${n.recipe}` : ''}</span>
        ))}
      </div>
    </li>
  );
}

export function Groceries() {
  const { userId, weekPlan, prefs, go } = useApp();
  const [list, setList] = useState<SavedGroceryList | null>(null);
  const [status, setStatus] = useState<'loading' | 'building' | 'ready' | 'error'>('loading');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<CustomItem[]>([]);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [shareState, setShareState] = useState<string | null>(null);
  const [staplesOpen, setStaplesOpen] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (weekPlan === undefined) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        let current = await fetchGroceryList(userId);
        if (weekPlan && !listMatchesPlan(current, weekPlan)) {
          if (!cancelled) setStatus('building');
          current = await rebuildGroceryList(userId, weekPlan, current);
        }
        if (cancelled) return;
        setList(current);
        setChecked(new Set(current?.checked ?? []));
        setCustom(current?.custom ?? []);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [userId, weekPlan]);

  /** Saves run one after another so a slow request can't overwrite a newer change. */
  const persist = (fn: () => Promise<void>) => {
    queue.current = queue.current.then(fn).then(() => setSaveError(false)).catch(() => setSaveError(true));
  };

  const toggle = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setChecked(next);
    const snapshot = [...next];
    persist(() => saveChecked(userId, snapshot));
  };

  const addItem = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const next = [...custom, { key: `custom:${Date.now().toString(36)}`, name: name.charAt(0).toUpperCase() + name.slice(1) }];
    setCustom(next);
    setDraft('');
    const snapshot = [...checked];
    persist(() => saveCustomItems(userId, next, snapshot));
  };

  const removeItem = (key: string) => {
    const next = custom.filter(c => c.key !== key);
    const nextChecked = new Set(checked); nextChecked.delete(key);
    setCustom(next); setChecked(nextChecked);
    const snapshot = [...nextChecked];
    persist(() => saveCustomItems(userId, next, snapshot));
  };

  const items = useMemo(() => list?.items ?? [], [list]);
  const toBuy = items.filter(i => !i.staple);
  const staples = items.filter(i => i.staple);
  const countable = [...toBuy.map(i => i.key), ...custom.map(c => c.key)];
  const done = countable.filter(k => checked.has(k)).length;

  const text = () => listText(items, custom, checked, prefs.units);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); setShareState('Copied'); } catch { setShareState("Couldn't copy. Select the list and copy it instead."); }
    window.setTimeout(() => setShareState(null), 2500);
  };
  const share = async () => {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'Grocery list', text: text() }); return; } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    await copy();
  };

  if (weekPlan === null || (status === 'ready' && !list && !custom.length)) {
    return (
      <PageContainer title="Grocery list">
        <EmptyState icon={ShoppingBasket} title="No grocery list yet" action={<Button size="lg" icon={CalendarPlus} onClick={() => go({ name: 'mealplan' })}>Plan your week</Button>}>
          Plan your week and the list builds itself from the meals, sorted by aisle.
        </EmptyState>
      </PageContainer>
    );
  }

  const actions = status === 'ready' ? (
    <>
      <IconButton icon={Copy} label="Copy list" variant="outlined" size="sm" onClick={copy} />
      <IconButton icon={Share2} label="Share" variant="outlined" size="sm" onClick={share} />
    </>
  ) : undefined;

  const count = status === 'ready'
    ? `${countable.length} item${countable.length === 1 ? '' : 's'}, ${done} checked`
    : status === 'building' ? "Building your list from this week's meals…" : undefined;

  return (
    <PageContainer title="Grocery list" actions={actions} intro={count}>
      {status === 'loading' || status === 'building' ? (
        <div aria-busy aria-label="Loading your list">
          <Skeleton className="mb-8 h-12 w-full rounded-input" />
          <Skeleton className="mb-2 h-3 w-20 rounded-full" />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={cx(ROW, 'items-center py-3')}>
              <Skeleton className="size-6 rounded-full" /><Skeleton className="h-4 flex-1 rounded-full" /><Skeleton className="h-4 w-14 rounded-full" />
            </div>
          ))}
        </div>
      ) : status === 'error' ? (
        <EmptyState icon={ShoppingBasket} title="Couldn't load your grocery list">Check your connection and try again.</EmptyState>
      ) : (
        <>
          <p role="status" aria-live="polite" className={cx('text-small font-semibold text-green', shareState && 'mb-3')}>{shareState}</p>
          {saveError && <p role="alert" className="mb-3 text-small text-terracotta-deep">Couldn't save your last change. It'll retry with the next one.</p>}

          <form onSubmit={addItem} className="mb-8 flex gap-2">
            <Input id="add-item" label="Add an item" hideLabel className="min-w-0 flex-1" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add an item" />
            <Button type="submit" variant="secondary" icon={Plus} className="h-12" disabled={!draft.trim()}>Add</Button>
          </form>

          {custom.length > 0 && (
            <section className="mb-8" aria-labelledby="aisle-custom">
              <h2 id="aisle-custom" className="label border-b border-line pb-2">Added by you</h2>
              <ul>
                {custom.map(c => {
                  const on = checked.has(c.key);
                  return (
                    <li key={c.key} className={cx(ROW, 'items-center py-2')}>
                      <Checkbox checked={on} onChange={() => toggle(c.key)} ariaLabel={c.name} />
                      <span className="flex-1 text-body"><span data-checked={on} className={cx('strike', on ? 'text-ink-muted' : 'text-ink')}>{c.name}</span></span>
                      <IconButton icon={X} label={`Remove ${c.name}`} size="sm" onClick={() => removeItem(c.key)} />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {AISLES.map(aisle => {
            const inAisle = toBuy.filter(i => i.aisle === aisle);
            if (!inAisle.length) return null;
            const left = inAisle.filter(i => !checked.has(i.key)).length;
            return (
              <section key={aisle} className="mb-8" aria-labelledby={`aisle-${aisle}`}>
                <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <h2 id={`aisle-${aisle}`} className="label">{aisle}</h2>
                  {!left && <span className="text-caption font-semibold text-green">All checked off</span>}
                </div>
                <ul>{inAisle.map(i => <ItemRow key={i.key} item={i} checked={checked.has(i.key)} onToggle={() => toggle(i.key)} units={prefs.units} />)}</ul>
              </section>
            );
          })}

          {staples.length > 0 && (
            <section className="mb-8">
              <button type="button" aria-expanded={staplesOpen} onClick={() => setStaplesOpen(o => !o)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 border-b border-line pb-2 text-left">
                <span className="label flex-1">{STAPLES_GROUP}</span>
                <span className="text-small text-ink-muted">{staples.length} items</span>
                <ChevronDown size={20} strokeWidth={1.75} aria-hidden className={cx('text-ink-muted transition-transform duration-150', staplesOpen && 'rotate-180')} />
              </button>
              {staplesOpen && <ul>{staples.map(i => <ItemRow key={i.key} item={i} checked={checked.has(i.key)} onToggle={() => toggle(i.key)} units={prefs.units} />)}</ul>}
            </section>
          )}

          <Button variant="secondary" icon={ShoppingCart} disabled>Instacart coming soon</Button>
        </>
      )}
    </PageContainer>
  );
}
