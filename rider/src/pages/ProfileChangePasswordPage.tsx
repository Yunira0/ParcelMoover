import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CircleCheckBig } from 'lucide-react'
import ChangePasswordForm from '../components/ChangePasswordForm'
import Button from '../components/Button'

// Voluntary version of the password-change flow, reached from Profile.
// ChangePasswordPage (the forced first-login one) shares the same form.
export default function ProfileChangePasswordPage() {
  const navigate = useNavigate()
  const [done, setDone] = useState(false)

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">

      <div className="flex flex-shrink-0 items-center gap-3 px-5 pt-1.5">
        <button
          onClick={() => navigate('/profile')}
          style={{ touchAction: 'manipulation' }}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors cursor-pointer hover:text-ink-2 active:bg-surface-2"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.4px] text-ink">Change password</h1>
      </div>

      <div className="flex flex-col flex-1 px-6 pt-6 pb-7">
        {done ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-tint">
              <CircleCheckBig size={26} className="text-green" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-base font-semibold text-ink">Password updated</p>
              <p className="mt-1 text-sm text-ink-3">Use your new password next time you sign in.</p>
            </div>
            <Button size="md" onClick={() => navigate('/profile')} className="mt-2 w-auto px-8">
              Back to profile
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm leading-snug text-ink-2">
              Update the password you use to sign in.
            </p>
            <ChangePasswordForm submitLabel="Update password" onSuccess={() => setDone(true)} />
          </>
        )}
      </div>
    </div>
  )
}
