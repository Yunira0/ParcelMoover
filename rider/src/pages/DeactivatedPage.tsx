import { Ban } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Full-screen lockout shown when the server reports the rider's account was
// deactivated by an admin (code ACCOUNT_INACTIVE). Rendered by AuthRouter in
// place of the whole app - a deactivated rider gets no portal at all, only
// this screen, until an admin re-activates the account.
// Pen "Screen / Deactivated": 32px side padding, 64px red-tint circle,
// 23/700 title, 14/400 ink-2 body, white h50 back button pinned low.
export default function DeactivatedPage() {
  const { resetDeactivated } = useAuth()

  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-bg px-8 pt-6 pb-10">

      <div className="flex-1" />

      {/* Hero */}
      <div className="flex flex-col">
        <div className="h-16 w-16 rounded-full bg-red-tint flex items-center justify-center">
          <Ban size={26} strokeWidth={2} className="text-red" />
        </div>

        <h1 className="mt-[22px] text-[23px] font-bold tracking-tight text-ink">
          Account deactivated
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-2">
          This rider account has been deactivated by the operations team.
          If you believe this is a mistake, contact your hub manager.
        </p>
      </div>

      <div className="flex-1" />

      {/* CTA - once re-activated, the rider signs back in from here */}
      <button
        onClick={resetDeactivated}
        style={{ touchAction: 'manipulation' }}
        className="flex h-[50px] w-full items-center justify-center rounded-[12px] bg-surface text-[14.5px] font-semibold text-ink cursor-pointer active:bg-surface-2 transition-colors"
      >
        Back to sign in
      </button>
    </div>
  )
}
