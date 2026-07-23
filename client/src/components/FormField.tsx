import React, { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import SearchableSelect, { type SearchableSelectOption } from './SearchableSelect';
import NepaliDatePicker from './NepaliDatePicker';
import './FormField.css';

export type FormFieldOption = { value: string; label: string };

export type FormFieldType = 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'select' | 'searchable-select' | 'combobox' | 'textarea';

interface FormFieldProps {
  label: string;
  required?: boolean;
  type?: FormFieldType;
  value: string | number | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: string | number;
  minLength?: number;
  autoComplete?: string;
  /** Options for type="select". */
  options?: FormFieldOption[];
  /** Options for type="searchable-select". */
  searchableOptions?: SearchableSelectOption[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  /** Lets a field span multiple columns in a parent CSS grid, e.g. "span 2". */
  gridColumn?: string;
  /** Visible rows for type="textarea". */
  rows?: number;
  /** Small helper text shown below the input. */
  hint?: string;
  /** Inline validation error — replaces hint and turns the border red. */
  error?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled,
  min,
  max,
  step,
  minLength,
  autoComplete,
  options = [],
  searchableOptions = [],
  searchPlaceholder,
  emptyMessage,
  className,
  gridColumn,
  rows = 3,
  hint,
  error,
}) => {
  const id = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <div
      className={`form-group${className ? ` ${className}` : ''}${error ? ' has-error' : ''}`}
      style={gridColumn ? { gridColumn } : undefined}
    >
      {label && (
        <label htmlFor={type === 'searchable-select' ? undefined : id}>
          {label}
          {required && <span className="required">*</span>}
        </label>
      )}
      {type === 'select' ? (
        <select
          id={id}
          required={required}
          disabled={disabled}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={value === undefined || value === '' ? 'placeholder-selected' : undefined}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          id={id}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          rows={rows}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === 'combobox' ? (
        <>
          <input
            id={id}
            type="text"
            list={`${id}-list`}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          <datalist id={`${id}-list`}>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </datalist>
        </>
      ) : type === 'date' ? (
        <NepaliDatePicker
          value={value === undefined ? '' : String(value)}
          onChange={onChange}
          placeholder={placeholder}
          aria-label={label}
        />
      ) : type === 'searchable-select' ? (
        <SearchableSelect
          options={searchableOptions}
          value={value === undefined ? '' : String(value)}
          onChange={onChange}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          disabled={disabled}
        />
      ) : type === 'password' ? (
        <div className="form-password-wrap">
          <input
            id={id}
            type={passwordVisible ? 'text' : 'password'}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            minLength={minLength}
            autoComplete={autoComplete}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="form-password-toggle"
            onClick={() => setPasswordVisible((v) => !v)}
            tabIndex={-1}
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
          >
            {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      ) : (
        <input
          id={id}
          type={type}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          minLength={minLength}
          autoComplete={autoComplete}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          // Trackpad/mouse-wheel scroll over a focused number input silently
          // increments/decrements it - blur on wheel so scrolling just scrolls
          // the page. Up/Down arrow keys still work as the only way to step.
          onWheel={type === 'number' ? (e) => e.currentTarget.blur() : undefined}
        />
      )}
      {error
        ? <small className="form-error">{error}</small>
        : hint && <small className="form-hint">{hint}</small>
      }
    </div>
  );
};

export default FormField;
