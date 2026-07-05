import { useState, type FormEvent } from 'react'
import { KeyRound, AlertCircle } from 'lucide-react'
import { changeRiderPassword } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Button from '../components/Button'
import Input from '../components/Input'

interface FieldErrors { currentPassword?: string; newPassword?: string; confirmPassword?: string }

export default function ChangePasswordPage() {
  const { updateRider, logout } = useAuth()

  const [loading,   setLoading]   = useState(false)
  const [formError, setFormError] = useState('')
  const [errors,    setErrors]    = useState<FieldErrors>({})

  function validate(currentPassword: string, newPassword: string, confirmPassword: string): FieldErrors {
    const e: FieldErrors = {}
    if (!currentPassword) e.currentPassword = 'Enter your current password'
    if (!newPassword) e.newPassword = 'Enter a new password'
    else if (newPassword.length < 8) e.newPassword = 'Min. 8 characters'
    if (newPassword && newPassword === currentPassword) e.newPassword = 'Must be different from your current password'
    if (!confirmPassword) e.confirmPassword = 'Confirm your new password'
    else if (confirmPassword !== newPassword) e.confirmPassword = 'Passwords do not match'
    return e
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const currentPassword = fd.get('currentPassword') as string
    const newPassword     = fd.get('newPassword') as string
    const confirmPassword = fd.get('confirmPassword') as string

    const errs = validate(currentPassword, newPassword, confirmPassword)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }

    setErrors({})
    setFormError('')
    setLoading(true)

    try {
      await changeRiderPassword(currentPassword, newPassword)
      updateRider({ mustChangePassword: false })
    } catch (err: any) {
      setFormError(err.message ?? 'Could not change password. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">
      <div className="flex flex-col flex-1 px-5 pt-10 pb-10 gap-8">

        <div className="flex flex-col gap-3">
          <div
            className="w-12 h-12 rounded-2xl bg-brand flex items-center justify-center"
            style={{ boxShadow: '0 4px 20px rgba(249,115,22,0.35)' }}
          >
            <KeyRound size={22} className="text-white" strokeWidth={2} />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Set a new password</h1>
            <p className="text-sm text-text-secondary">
              For your account's security, you need to set your own password before continuing.
            </p>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5 border border-error/30 bg-error/8"
          >
            <AlertCircle size={16} className="text-error shrink-0 mt-0.5" />
            <p className="text-sm text-error leading-snug">{formError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            placeholder="The password you logged in with"
            error={errors.currentPassword}
          />
          <Input
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            error={errors.newPassword}
          />
          <Input
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            error={errors.confirmPassword}
          />

          <div className="pt-2 flex flex-col gap-3">
            <Button type="submit" loading={loading}>
              Set new password
            </Button>
            <Button type="button" variant="ghost" onClick={logout}>
              Sign out instead
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
