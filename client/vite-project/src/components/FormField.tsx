import React, { useId } from 'react';
import SearchableSelect, { type SearchableSelectOption } from './SearchableSelect';
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
