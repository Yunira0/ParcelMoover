import { useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { changeRiderPassword } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Button from './Button'
import Input from './Input'

interface FieldErrors { currentPassword?: string; newPassword?: string; confirmPassword?: string }

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

interface Props {
  submitLabel: string
  /** Rendered under the submit button (e.g. a "sign out instead" escape hatch). */
  footer?: ReactNode
  onSuccess: () => void
}

// Shared by the forced first-login flow (ChangePasswordPage) and the
// voluntary one reachable from Profile - same validation and API call,
// different framing/chrome around it.
export default function ChangePasswordForm({ submitLabel, footer, onSuccess }: Props) {
  const { updateRider } = useAuth()

  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

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
      onSuccess()
    } catch (err: any) {
      setFormError(err.message ?? 'Could not change password. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {formError && (
        <div
          role="alert"
          className="mb-3.5 flex items-start gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-bright" />
          <p className="text-sm leading-snug text-red-bright">{formError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
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

        <div className="pt-1 flex flex-col gap-2">
          <Button type="submit" loading={loading}>
            {submitLabel}
          </Button>
          {footer}
        </div>
      </form>
    </>
  )
}
