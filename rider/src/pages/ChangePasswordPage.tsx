import { KeyRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Button from '../components/Button'
import ChangePasswordForm from '../components/ChangePasswordForm'

// Forced first-login flow - blocks the whole app until resolved (see
// ProtectedLayout in App.tsx). The voluntary version reachable from Profile
// is ProfileChangePasswordPage; both share ChangePasswordForm.
export default function ChangePasswordPage() {
  const { logout } = useAuth()

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">
      <div className="flex flex-col flex-1 px-6 pt-5 pb-7">

        {/* Icon — pen: 48×48 rust-tint box, radius 12, rust key */}
        <div className="h-12 w-12 rounded-xl bg-rust-tint flex items-center justify-center">
          <KeyRound size={22} strokeWidth={2} className="text-rust" />
        </div>

        <h1 className="mt-5 text-[27px] font-bold leading-tight tracking-tight text-ink">
          Set a new password
        </h1>
        <p className="mt-2 text-sm leading-snug text-ink-2">
          For your account's security, set your own password before you start working.
        </p>

        <div className="flex-1" />

        <ChangePasswordForm
          submitLabel="Set new password"
          onSuccess={() => {}}
          footer={
            <Button type="button" variant="ghost" size="md" onClick={logout}>
              Sign out instead
            </Button>
          }
        />
      </div>
    </div>
  )
}
