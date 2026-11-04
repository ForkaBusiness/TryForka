import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { normalizeIngredient } from '../lib/recipeFilter';
import { exactOption, searchIngredients, type IngredientOption } from '../lib/ingredientSearch';
import { cx } from './ds';

// Autocomplete for food preferences: a combobox over the catalog's ingredients, with the
// choices as removable chips. Saves the option's value, not what was typed, so the recipe
// filter matches it. Something the catalog doesn't have can still be added, marked as custom.

const DEBOUNCE_MS = 150;
const MIN_CUSTOM_LENGTH = 2;

export interface IngredientChip {
  value: string;
  label: string;
  /** Not a catalog ingredient, so it may not match any recipe. */
  custom?: boolean;
  /** Extra control inside the chip. */
  action?: ReactNode;
}

export interface IngredientInputProps {
  label: string;
  placeholder?: string;
  /** Null until the index has loaded (or if it couldn't). */
  options: readonly IngredientOption[] | null;
  chips: IngredientChip[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

export function IngredientInput({ label, placeholder, options, chips, onAdd, onRemove }: IngredientInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const chosen = useMemo(() => chips.map(c => c.value), [chips]);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [text]);

  const search = (q: string) => searchIngredients(options ?? [], q, chosen);
  const results = useMemo(() => searchIngredients(options ?? [], query, chosen), [options, query, chosen]);
  const typed = text.trim();
  const canAddCustom = (found: readonly IngredientOption[], q: string) => q.length >= MIN_CUSTOM_LENGTH && !found.length;
  const customRow = canAddCustom(results, query.trim());
  const count = results.length + (customRow ? 1 : 0);
  const expanded = open && !!typed && count > 0;
  useEffect(() => setActive(0), [query]);

  const reset = () => { setText(''); setQuery(''); setActive(0); setOpen(false); };
  const add = (value: string) => { if (!chosen.includes(value)) onAdd(value); reset(); };
  const addCustom = (q: string) => {
    const value = normalizeIngredient(q);
    if (value.length >= MIN_CUSTOM_LENGTH) add(value); else reset();
  };

  /** Enter, or leaving with text in the box: never lose what someone typed. */
  const commit = (byEnter: boolean) => {
    if (!typed) return;
    // Search what's in the box now, not the debounced query.
    const found = search(typed);
    const exact = exactOption(options ?? [], typed);
    if (byEnter && expanded && query === text) {
      if (active < results.length) add(results[active].value); else addCustom(typed);
    } else if (exact) add(exact.value);
    else if (byEnter && found.length) add(found[0].value);
    else if (canAddCustom(found, typed)) addCustom(typed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!typed) return;
        e.preventDefault();
        if (!expanded) { setOpen(true); return; }
        setActive(a => (a + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      case 'Enter':
        e.preventDefault();
        commit(true);
        return;
      case 'Escape':
        if (expanded) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        return;
      case 'Backspace':
        if (!text && chips.length) onRemove(chips[chips.length - 1].value);
        return;
    }
  };

  const optionId = (i: number) => `${id}-option-${i}`;
  const rowClass = (i: number) => cx('flex cursor-pointer items-center gap-2 px-4 py-2.5 text-base', i === active ? 'bg-basil-soft text-basil' : 'text-ink');

  return (
    <div className="max-w-md">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-ink">{label}</label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? optionId(active) : undefined}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { commit(false); setOpen(false); }}
          onKeyDown={onKeyDown}
          className="h-12 w-full rounded-control border border-line bg-surface px-4 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-basil focus:ring-2 focus:ring-basil/25"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          // Keep focus in the input, so choosing an option isn't a blur.
          onMouseDown={e => e.preventDefault()}
          className={cx('absolute inset-x-0 top-full z-20 mt-1 max-h-[22rem] overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-float', !expanded && 'hidden')}
        >
          {results.map((o, i) => (
            <li key={o.value} id={optionId(i)} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => add(o.value)} className={rowClass(i)}>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.family && <span className="shrink-0 text-sm text-ink-muted">All {o.label.toLowerCase()} foods</span>}
            </li>
          ))}
          {customRow && (
            <li id={optionId(results.length)} role="option" aria-selected={active === results.length} onClick={() => addCustom(query)} className={rowClass(results.length)}>
              <Plus size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Add "{query.trim()}"</span>
              <span className="shrink-0 text-sm text-ink-muted">Not in our recipes</span>
            </li>
          )}
        </ul>
      </div>
      {chips.length > 0 && (
        <ul aria-label={label} className="mt-3 flex flex-wrap gap-2">
          {chips.map(c => (
            <li key={c.value} className={cx('inline-flex h-9 max-w-full items-center gap-1 rounded-full border bg-surface pr-1 pl-3 text-base', c.custom ? 'border-dashed border-ink-muted text-ink-muted' : 'border-line text-ink')}>
              <span className="truncate">{c.label}</span>
              {c.custom && <span className="sr-only">(custom, may not match recipes)</span>}
              {c.action}
              <button
                type="button"
                onClick={() => onRemove(c.value)}
                aria-label={`Remove ${c.label}`}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-canvas hover:text-ink"
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {chips.some(c => c.custom) && <p className="mt-2 text-sm text-ink-muted">Dashed items aren't in our ingredient list, so they may not match recipes.</p>}
    </div>
  );
}
