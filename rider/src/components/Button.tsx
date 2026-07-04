import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export default function Button({
  children, loading, variant = 'primary', size = 'lg',
  disabled, className = '', ...rest
}: Props) {
  const sizes = {
    sm: 'h-10 px-4 text-sm rounded-xl',
    md: 'h-12 px-5 text-sm rounded-xl',
    lg: 'h-14 px-6 text-base rounded-2xl',
  }

  const variants = {
    primary: `
      bg-brand text-white font-semibold
      shadow-[0_4px_24px_rgba(249,115,22,0.35)]
      active:bg-brand-dark active:scale-[0.97]
      disabled:opacity-40 disabled:shadow-none
    `,
    secondary: `
      bg-surface-2 text-text-primary font-semibold border border-border
      active:bg-surface-3 active:scale-[0.97]
      disabled:opacity-40
    `,
    ghost: `
      bg-transparent text-text-secondary font-medium
      active:text-text-primary active:scale-[0.97]
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
        transition-all duration-150 cursor-pointer select-none
        disabled:cursor-not-allowed
        ${sizes[size]} ${variants[variant]} ${className}
      `}
    >
      {loading
        ? <Loader2 size={20} className="animate-spin" />
        : children}
    </button>
  )
}
