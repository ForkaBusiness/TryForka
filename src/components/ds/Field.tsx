import React, { useId } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { cx } from './cx';
import { ICON_PROPS } from './icon';

// Form controls. Matte: surface fill, line border, green focus ring.

/** The look of every text field. Exported for the one input that needs its own markup (the ingredient combobox). */
export const fieldClass = 'w-full rounded-input border border-line bg-surface text-body text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-green focus:ring-2 focus:ring-green/25 disabled:bg-cream disabled:text-ink-muted';

const labelClass = 'mb-2 block text-small font-semibold text-ink';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Keep the label for screen readers only (search bars, single-field forms). */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** Icon inside the left edge. */
  leading?: React.ReactNode;
  /** Element inside the right edge (e.g. a show-password button). */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ label, hideLabel, hint, error, leading, trailing, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      {label && <label htmlFor={inputId} className={hideLabel ? 'sr-only' : labelClass}>{label}</label>}
      <div className="relative">
        {leading && <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-ink-muted">{leading}</div>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(fieldClass, 'h-12', leading ? 'pl-12' : 'pl-4', trailing ? 'pr-13' : 'pr-4', error && 'border-terracotta')}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? <p id={`${inputId}-error`} className="mt-2 text-small text-terracotta-deep">{error}</p>
        : hint ? <p id={`${inputId}-hint`} className="mt-2 text-small text-ink-muted">{hint}</p> : null}
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hideLabel?: boolean;
  /** Extra classes for the textarea itself (height, resize). */
  fieldClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hideLabel, fieldClassName, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={inputId} className={hideLabel ? 'sr-only' : labelClass}>{label}</label>}
      <textarea ref={ref} id={inputId} className={cx(fieldClass, 'block px-4 py-3', fieldClassName ?? 'min-h-32 resize-y')} {...rest} />
    </div>
  );
});

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Accessible name when there's no visible label. */
  ariaLabel?: string;
  className?: string;
}

/** Round. Fills with the glaze when checked. */
export function Checkbox({ checked, onChange, label, ariaLabel, className }: CheckboxProps) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-3', className)}>
      <span className="relative inline-flex size-6 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          aria-label={ariaLabel}
          className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cx(
            'flex size-6 items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-green peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream',
            checked ? 'glaze animate-check shadow-glaze-pressed' : 'border-2 border-ink-muted/80 bg-surface',
          )}
        >
          {checked && <Check size={15} strokeWidth={3} />}
        </span>
      </span>
      {label && <span className="text-body text-ink">{label}</span>}
    </label>
  );
}

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  /** Text after the number ("people"). */
  unit?: (n: number) => string;
}

export function Stepper({ value, onChange, min = 1, max = 20, label, unit }: StepperProps) {
  const side = 'flex h-full w-12 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-cream disabled:cursor-not-allowed disabled:text-line disabled:hover:bg-transparent';
  return (
    <div role="group" aria-label={label} className="inline-flex h-12 items-center rounded-full border border-line bg-surface p-1">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={side}>
        <Minus {...ICON_PROPS} />
      </button>
      <output aria-live="polite" className="tabular min-w-24 px-2 text-center text-body font-semibold">
        {value}{unit ? ` ${unit(value)}` : ''}
      </output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={side}>
        <Plus {...ICON_PROPS} />
      </button>
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** A small set of mutually exclusive choices: Ingredients / Steps, 1x / 2x / 3x, US / Metric. */
export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-full border border-line bg-cream p-1', className)}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'h-9 flex-1 cursor-pointer rounded-full px-4 text-small font-semibold whitespace-nowrap transition-colors duration-150',
              active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
