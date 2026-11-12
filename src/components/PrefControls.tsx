import { useEffect, useMemo, useState } from 'react';
import { ingredientIndex } from '../lib/catalog';
import { ALLERGEN_OPTIONS, allergyOptions, dislikeOptions, exactOption, type IngredientOption } from '../lib/ingredientSearch';
import type { DietChoice, Preferences } from '../lib/preferences';
import { allergyExpansionNote, canonicalAllergy } from '../lib/recipeFilter';
import { Checkbox, ChipButton, cx, ToggleChip } from './ds';
import { IngredientInput } from './IngredientInput';

// The food-settings controls, shared by onboarding and Settings so both write the
// same fields.

const DIET_OPTIONS: Array<{ value: DietChoice; label: string; hint: string }> = [
  { value: 'none', label: 'No restrictions', hint: 'Everything' },
  { value: 'vegetarian', label: 'Vegetarian', hint: 'No meat or fish' },
  { value: 'vegan', label: 'Vegan', hint: 'No animal products' },
  { value: 'pescatarian', label: 'Pescatarian', hint: 'Fish, no meat' },
];

export function DietPicker({ value, onChange }: { value: DietChoice; onChange: (d: DietChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="Diet" className="grid gap-2 sm:grid-cols-2">
      {DIET_OPTIONS.map(o => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cx('flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-input border px-4 py-3 text-left transition-colors duration-150', selected ? 'border-green bg-green-soft' : 'border-line bg-surface hover:border-ink-muted')}
          >
            <span>
              <span className={cx('block text-body font-semibold', selected ? 'text-green' : 'text-ink')}>{o.label}</span>
              <span className="block text-small text-ink-muted">{o.hint}</span>
            </span>
            <span aria-hidden className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-green' : 'border-ink-muted/80')}>
              {selected && <span className="size-2.5 rounded-full bg-green" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function useIngredientIndex(): IngredientOption[] | null {
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  useEffect(() => { ingredientIndex().then(setOptions).catch(() => {}); }, []);
  return options;
}

const ingredientChip = (value: string, options: IngredientOption[] | null) => {
  const known = options && exactOption(options, value);
  return { value, label: known ? known.label : value, custom: !!options && !known };
};

export function AllergyPicker({ value, onChange }: { value: string[]; onChange: (a: string[]) => void }) {
  const index = useIngredientIndex();
  const options = useMemo(() => allergyOptions(index ?? []), [index]);
  const add = (a: string) => onChange([...value, canonicalAllergy(a)]);
  const family = (v: string) => ALLERGEN_OPTIONS.find(o => o.value === v);
  const chips = value.map(v => (family(v) ? { value: v, label: family(v)!.label } : { ...ingredientChip(v, index), note: allergyExpansionNote(v) }));
  const common = ALLERGEN_OPTIONS.filter(o => !value.includes(o.value));
  return (
    <div>
      <IngredientInput label="Add an allergy" placeholder="Peanut, shellfish, mustard" options={options}
        chips={chips} onAdd={add} onRemove={v => onChange(value.filter(x => x !== v))} />
      {common.length > 0 && (
        <div role="group" aria-label="Common allergens" className="mt-4 flex flex-wrap gap-2">
          {common.map(o => <ChipButton key={o.value} onClick={() => add(o.value)}>{o.label}</ChipButton>)}
        </div>
      )}
      <p className="mt-3 text-small text-ink-muted">We filter by ingredient list. Always check product labels for allergens.</p>
    </div>
  );
}

/** Dislikes: "never show" (skip) by default; each one can be switched to "avoid if possible". */
export function SkipList({ never, avoid, onChange }: { never: string[]; avoid: string[]; onChange: (never: string[], avoid: string[]) => void }) {
  const index = useIngredientIndex();
  const options = useMemo(() => index && dislikeOptions(index), [index]);
  const remove = (v: string) => onChange(never.filter(x => x !== v), avoid.filter(x => x !== v));
  const severity = (v: string, label: string, avoided: boolean) => (
    <button
      type="button"
      onClick={() => (avoided ? onChange([...never, v], avoid.filter(x => x !== v)) : onChange(never.filter(x => x !== v), [...avoid, v]))}
      aria-label={`${label}: ${avoided ? 'avoid if possible' : 'never show'}. Change`}
      className={cx('ml-1 h-7 shrink-0 cursor-pointer rounded-full px-2 text-small font-medium whitespace-nowrap', avoided ? 'bg-cream text-ink-muted' : 'bg-green-soft text-green')}
    >
      {avoided ? 'Avoid if possible' : 'Never show'}
    </button>
  );
  const chip = (v: string, avoided: boolean) => {
    const c = ingredientChip(v, options);
    return { ...c, action: severity(v, c.label, avoided) };
  };
  return (
    <IngredientInput label="Add an ingredient" placeholder="Mushroom, olive" options={options}
      chips={[...never.map(v => chip(v, false)), ...avoid.map(v => chip(v, true))]}
      onAdd={v => onChange([...never, v], avoid)} onRemove={remove} />
  );
}

const TIME_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: 30, label: '30 min' }, { value: 45, label: '45 min' }, { value: 60, label: '1 hour' }, { value: null, label: 'No limit' },
];

type Planning = Pick<Preferences, 'plan_breakfast' | 'plan_lunch' | 'plan_dinner' | 'max_weeknight_minutes'>;

export function PlanningPicker({ value, onChange }: { value: Planning; onChange: (p: Partial<Planning>) => void }) {
  const meals: Array<[keyof Planning, string]> = [['plan_breakfast', 'Breakfast'], ['plan_lunch', 'Lunch'], ['plan_dinner', 'Dinner']];
  const onlyOne = [value.plan_breakfast, value.plan_lunch, value.plan_dinner].filter(Boolean).length === 1;
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-small font-semibold text-ink">Meals to plan</legend>
        <div className="flex flex-wrap gap-6">
          {meals.map(([key, label]) => (
            <Checkbox
              key={key}
              checked={!!value[key]}
              // At least one meal stays on.
              onChange={checked => { if (checked || !onlyOne || !value[key]) onChange({ [key]: checked }); }}
              label={label}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-small font-semibold text-ink">Weeknight dinners take at most</legend>
        <div role="radiogroup" aria-label="Weeknight cook time" className="flex flex-wrap gap-2">
          {TIME_OPTIONS.map(o => (
            <ToggleChip key={o.label} role="radio" selected={value.max_weeknight_minutes === o.value} onToggle={() => onChange({ max_weeknight_minutes: o.value })}>
              {o.label}
            </ToggleChip>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
