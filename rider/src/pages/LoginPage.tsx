import { useState, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, AlertCircle, Download } from 'lucide-react'
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
      // A deactivated account isn't a bad-credentials problem - route to the
      // dedicated lockout screen instead of showing an inline form error.
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

      {/* Top bar */}
      <div className="flex items-center px-3 pt-3">
        <button
          onClick={() => navigate(-1)}
          style={{ touchAction: 'manipulation' }}
          className="w-11 h-11 flex items-center justify-center rounded-2xl text-text-muted hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
          aria-label="Go back"
        >
          <ChevronLeft size={22} />
        </button>
      </div>

      <div className="flex flex-col flex-1 px-5 pt-4 pb-10 gap-8">

        {/* Brand heading */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Welcome back</h1>
          <p className="text-sm text-text-secondary">Sign in with your rider credentials</p>
        </div>

        {/* Error banner */}
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5 border border-error/30 bg-error/8"
          >
            <AlertCircle size={16} className="text-error shrink-0 mt-0.5" />
            <p className="text-sm text-error leading-snug">{formError}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            ref={emailRef}
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="rider@parcelmoover.com"
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

          <div className="pt-2">
            <Button type="submit" loading={loading}>
              Sign in
            </Button>
          </div>
        </form>

        {/* Footer note */}
        <div className="mt-auto flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-text-muted">
            Forgot password? Your manager can reset it.
          </p>

          {canInstall && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (hasNativePrompt) {
                  install()
                } else {
                  setShowInstructions(true)
                }
              }}
            >
              <Download size={16} />
              Download App
            </Button>
          )}

          {showInstructions && (
            <div className="rounded-2xl px-4 py-3.5 border border-border bg-surface-2 text-left">
              <p className="text-sm text-text-primary font-medium mb-1">Add to Home Screen</p>
              <p className="text-xs text-text-secondary leading-relaxed">
                Tap the <strong>Share</strong> button in Safari, then select{' '}
                <strong>Add to Home Screen</strong> to install the app.
              </p>
              <button
                onClick={() => setShowInstructions(false)}
                className="mt-2 text-xs text-brand font-medium cursor-pointer"
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
