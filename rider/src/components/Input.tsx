import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

// Pen "Field": label 13/500 ink-2, 7px gap, box h50 radius 10 padding [0,14],
// 14px value text, placeholder ink-3.
const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, type, id, className = '', ...rest }, ref) => {
    const [show, setShow] = useState(false)
    const isPassword = type === 'password'
    const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-[7px]">
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink-2">
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
            style={{ height: 50, touchAction: 'manipulation' }}
            className={`
              w-full rounded-[10px] px-[14px] text-sm text-ink bg-surface
              placeholder:text-ink-3 outline-none
              border transition-colors duration-150
              focus:border-rust focus:ring-2 focus:ring-rust/25
              ${isPassword ? 'pr-11' : ''}
              ${error
                ? 'border-red-bright'
                : 'border-line-strong'}
              ${className}
            `}
          />

          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
              style={{ touchAction: 'manipulation' }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-ink-3 hover:text-ink-2 transition-colors cursor-pointer"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>

        {error && (
          <p id={`${inputId}-err`} role="alert" className="text-xs text-red-bright flex items-center gap-1">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-ink-3">{hint}</p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'
export default Input
