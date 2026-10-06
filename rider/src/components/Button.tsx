import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

// Pen "Button / Primary": h52, radius 12, label 15/600 with slight tracking.
export default function Button({
  children, loading, variant = 'primary', size = 'lg',
  disabled, className = '', ...rest
}: Props) {
  const sizes = {
    sm: 'h-9 px-3.5 text-[13px] rounded-[8px]',
    md: 'h-[46px] px-5 text-sm rounded-[12px]',
    lg: 'h-[52px] px-6 text-[15px] rounded-[12px] tracking-[0.1px]',
  }

  const variants = {
    primary: `
      bg-rust text-white font-semibold
      active:bg-rust-deep
      disabled:opacity-40
    `,
    secondary: `
      bg-surface text-ink font-semibold border border-line-strong
      active:bg-surface-2
      disabled:opacity-40
    `,
    ghost: `
      bg-transparent text-ink-2 font-semibold
      active:text-ink
      disabled:opacity-40
    `,
    danger: `
      bg-red text-white font-semibold
      active:bg-[#991b1b]
      disabled:opacity-40
    `,
  }

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{ touchAction: 'manipulation' }}
      className={`
        flex items-center justify-center gap-2 w-full
        transition-colors duration-150 cursor-pointer select-none
        disabled:cursor-not-allowed
        ${sizes[size]} ${variants[variant]} ${className}
      `}
    >
      {loading
        ? <Loader2 size={18} className="animate-spin" />
        : children}
    </button>
  )
}
