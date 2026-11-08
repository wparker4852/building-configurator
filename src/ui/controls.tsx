// Small presentational controls shared by the configurator and admin screens.

import { useId, useState, type ReactNode } from 'react';
import type { ColorOption } from '../core/types';
import { swatchDataUrl } from '../viewer/materials';

export function Section({
  title,
  hint,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = collapsible ? open : true;
  return (
    <div className="section">
      {collapsible ? (
        <button className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="section-title">{title}</span>
          <span className="section-title">{open ? '−' : '+'}</span>
        </button>
      ) : (
        <div className="section-head">
          <span className="section-title">{title}</span>
        </div>
      )}
      {hint && shown && <p className="section-hint">{hint}</p>}
      {shown && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format?: (n: number) => string;
  note?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <span className="field-value">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {note && <span className="field-note">{note}</span>}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            aria-pressed={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: ColorOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const current = colors.find((c) => c.id === value);
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{label}</span>
        <span className="field-value">{current?.name}</span>
      </div>
      <div className="swatches">
        {colors.map((c) => {
          // Wood- and stone-look prints are premium even before a book prices them.
          const printed = c.finish === 'wood' || c.finish === 'stone';
          const premium = printed || c.upchargePerSqFt > 0;
          return (
            <button
              key={c.id}
              className={`swatch${printed ? ' printed' : ''}`}
              style={{
                background: printed ? `url(${swatchDataUrl(c.hex, c.finish, c.variant)}) center / cover` : c.hex,
              }}
              aria-pressed={value === c.id}
              aria-label={c.name}
              title={premium ? `${c.name} (premium${printed ? ` ${c.finish}-look` : ''})` : c.name}
              onClick={() => onChange(c.id)}
            >
              {premium && <span className="up">$</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OptionRow({
  name,
  detail,
  price,
  selected,
  onClick,
  right,
}: {
  name: string;
  detail?: string;
  price?: string;
  selected?: boolean;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const inner = (
    <>
      <span className="grow">
        <span className="n">{name}</span>
        {detail && <span className="d">{detail}</span>}
      </span>
      {price && <span className="p">{price}</span>}
      {right}
    </>
  );
  if (!onClick) return <div className="row">{inner}</div>;
  return (
    <button className="row" aria-pressed={!!selected} onClick={onClick}>
      {inner}
    </button>
  );
}

export function Stepper({
  value,
  min = 1,
  max = 99,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  return (
    <span className="stepper" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        &minus;
      </button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">
        +
      </button>
    </span>
  );
}

export function Field({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {note && <span className="field-note">{note}</span>}
    </div>
  );
}

/**
 * A full-width section bar that opens and closes, as in the Walker layout:
 * yellow for top-level sections, grey for sub-sections, a boxed +/− at left.
 */
export function Accordion({
  title,
  children,
  defaultOpen = false,
  sub = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  sub?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`acc${sub ? ' sub' : ''}${open ? ' open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="acc-box" aria-hidden="true">{open ? '−' : '+'}</span>
        <span className="acc-title">{title}</span>
      </button>
      {open && <div className="acc-body">{children}</div>}
    </div>
  );
}

export interface RadioChoice<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Why it is disabled, shown on hover. */
  title?: string;
}

/** A labelled list of radio buttons. */
export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  note,
}: {
  label: string;
  options: RadioChoice<T>[];
  value: T;
  onChange: (v: T) => void;
  note?: string;
}) {
  const name = useId();
  return (
    <fieldset className="radios">
      <legend className="field-label">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={`radio${o.disabled ? ' disabled' : ''}`} title={o.title}>
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
      {note && <span className="field-note">{note}</span>}
    </fieldset>
  );
}

/** A tick-box row for an option with a price. */
export function CheckRow({
  label,
  detail,
  price,
  checked,
  onChange,
  right,
}: {
  label: string;
  detail?: string;
  price?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  right?: ReactNode;
}) {
  return (
    <div className="check-row">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="n">{label}</span>
          {detail && <span className="d">{detail}</span>}
        </span>
      </label>
      {price && <span className="p">{price}</span>}
      {right}
    </div>
  );
}

/**
 * A compact colour picker: a button with a palette mark, the label and a dot
 * of the current colour, opening the full swatch grid under it.
 */
export function ColorPicker({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: ColorOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = colors.find((c) => c.id === value);
  const printed = current && (current.finish === 'wood' || current.finish === 'stone');
  return (
    <div className="color-picker">
      <button className="cp-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <svg className="cp-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="7.5" cy="11" r="1.3" fill="currentColor" />
          <circle cx="10.5" cy="7.5" r="1.3" fill="currentColor" />
          <circle cx="15" cy="7.5" r="1.3" fill="currentColor" />
        </svg>
        <span className="cp-label">{label}</span>
        <span className="cp-name">{current?.name}</span>
        <span
          className="cp-dot"
          style={{
            background: printed ? `url(${swatchDataUrl(current.hex, current.finish, current.variant)}) center / cover` : current?.hex,
          }}
        />
        <span className="cp-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cp-pop">
          <Swatches
            label={label}
            colors={colors}
            value={value}
            onChange={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
