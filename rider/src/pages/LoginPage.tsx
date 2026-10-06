import { useState, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { isAccountInactiveError, loginRider } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Button from '../components/Button'
import Input from '../components/Input'

interface FieldErrors { email?: string; password?: string }

export default function LoginPage() {
  const navigate   = useNavigate()
  const { login, markDeactivated } = useAuth()
  const emailRef   = useRef<HTMLInputElement>(null)

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
      <div className="flex flex-col flex-1 px-5 pt-14 pb-10">
        <h1 className="text-[28px] font-bold leading-tight text-ink">Rider sign in</h1>

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

        </div>
      </div>
    </div>
  )
}
