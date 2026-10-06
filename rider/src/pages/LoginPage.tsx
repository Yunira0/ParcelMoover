import { useState, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Download } from 'lucide-react'
import { isAccountInactiveError, loginRider } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import usePwaInstall from '../lib/usePwaInstall'
import Button from '../components/Button'
import Input from '../components/Input'

interface FieldErrors { email?: string; password?: string }

export default function LoginPage() {
  const navigate   = useNavigate()
  const { login, markDeactivated } = useAuth()
  const emailRef   = useRef<HTMLInputElement>(null)
  const { canInstall, hasNativePrompt, install } = usePwaInstall()
  const [showInstructions, setShowInstructions] = useState(false)

  const [loading,   setLoading]   = useState(false)
  const [formError, setFormError] = useState('')
  const [errors,    setErrors]    = useState<FieldErrors>({})

  function validate(email: string, password: string): FieldErrors {
    const e: FieldErrors = {}
    if (!email)                                        e.email    = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email'
    if (!password)                                     e.password = 'Password is required'
    return e
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd       = new FormData(e.currentTarget)
    const email    = (fd.get('email')    as string).trim()
    const password = fd.get('password') as string

    const errs = validate(email, password)
    if (Object.keys(errs).length) {
      setErrors(errs)
      if (errs.email) emailRef.current?.focus()
      return
    }

    setErrors({})
    setFormError('')
    setLoading(true)

    try {
      const user = await loginRider({ email, password })
      login(user)
      navigate('/scan', { replace: true })
    } catch (err: any) {
      if (isAccountInactiveError(err)) {
        markDeactivated()
        return
      }
      setFormError(err.message ?? 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">
      <div className="flex flex-col flex-1 px-5 pt-8 pb-10">

        {/* Brand row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-[9px] w-[9px] rounded-[2px] bg-rust" />
            <span className="text-[15px] font-bold tracking-tight text-ink">ParcelMoover</span>
          </div>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-ink-2">
            RIDER
          </span>
        </div>

        {/* Headline */}
        <div className="mt-14 flex flex-col gap-2">
          <h1 className="text-[42px] font-bold leading-[1.06] tracking-[-1.2px] text-ink">
            Scan. Deliver.<br />Get settled.
          </h1>
          <p className="text-sm leading-snug text-ink-2">
            One app for your route, your parcels and every rupee you collect.
          </p>
        </div>

        {/* Error banner */}
        {formError && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-bright" />
            <p className="text-sm leading-snug text-red-bright">{formError}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-3.5">
          <Input
            ref={emailRef}
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="you@company.com"
            error={errors.email}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            error={errors.password}
          />

          <div className="pt-1">
            <Button type="submit" loading={loading}>
              Sign in
            </Button>
          </div>
        </form>

        {/* Footer note */}
        <div className="mt-auto flex flex-col items-center gap-4 pt-10 text-center">
          <p className="text-xs text-ink-3">
            Forgot your password? Your hub manager can reset it.
          </p>

          {canInstall && (
            <button
              onClick={() => {
                if (hasNativePrompt) {
                  install()
                } else {
                  setShowInstructions(true)
                }
              }}
              style={{ touchAction: 'manipulation' }}
              className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3 cursor-pointer"
            >
              <Download size={13} />
              Install app
            </button>
          )}

          {showInstructions && (
            <div className="w-full rounded-sm border border-line bg-surface px-4 py-3.5 text-left">
              <p className="mb-1 text-sm font-semibold text-ink">Add to Home Screen</p>
              <p className="text-xs leading-relaxed text-ink-2">
                Tap the <strong>Share</strong> button in Safari, then select{' '}
                <strong>Add to Home Screen</strong> to install the app.
              </p>
              <button
                onClick={() => setShowInstructions(false)}
                className="mt-2 text-xs font-semibold text-rust cursor-pointer"
              >
                Got it
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
