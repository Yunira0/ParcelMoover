import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, type, id, ...rest }, ref) => {
    const [show, setShow] = useState(false)
    const isPassword = type === 'password'
    const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>

        <div className="relative">
          <input
            {...rest}
            ref={ref}
            id={inputId}
            type={isPassword && show ? 'text' : type}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined}
            style={{ minHeight: 52, touchAction: 'manipulation' }}
            className={`
              w-full rounded-2xl px-4 text-base text-text-primary
              placeholder:text-text-muted outline-none
              border transition-all duration-150
              bg-surface-2
              focus:ring-2 focus:ring-brand/40 focus:border-brand
              ${isPassword ? 'pr-12' : ''}
              ${error
                ? 'border-error bg-error/5'
                : 'border-border hover:border-surface-3 focus:border-brand'}
            `}
          />

          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
              style={{ touchAction: 'manipulation' }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>

        {error && (
          <p id={`${inputId}-err`} role="alert" className="text-xs text-error flex items-center gap-1">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-text-muted">{hint}</p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'
export default Input
