import { ShieldOff, Phone, LogIn } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Button from '../components/Button'

// Full-screen lockout shown when the server reports the rider's account was
// deactivated by an admin (code ACCOUNT_INACTIVE). Rendered by AuthRouter in
// place of the whole app - a deactivated rider gets no portal at all, only
// this screen, until an admin re-activates the account.
export default function DeactivatedPage() {
  const { resetDeactivated } = useAuth()

  return (
    <div className="flex flex-col flex-1 min-h-dvh relative overflow-hidden bg-bg">

      {/* Red gradient orb - mirrors the welcome screen's brand orbs, in error tone */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-48 -right-20 w-64 h-64 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 70%)' }}
        />
      </div>

      {/* Hero */}
      <div className="flex flex-col items-center flex-1 justify-center px-6 gap-6 relative text-center">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center bg-error/10 border border-error/30">
          <ShieldOff size={42} strokeWidth={1.75} className="text-error" />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-[0.2em] text-error uppercase">
            Access revoked
          </p>
          <h1 className="text-3xl font-extrabold text-text-primary tracking-tight leading-tight">
            Account deactivated
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed max-w-xs mx-auto">
            Your rider account has been deactivated by your administrator.
            You can no longer sign in or receive parcels on this app.
          </p>
        </div>

        {/* What to do */}
        <div className="flex items-center gap-4 bg-surface rounded-2xl px-4 py-4 border border-border w-full max-w-sm text-left">
          <div className="w-10 h-10 rounded-xl bg-brand-dim flex items-center justify-center shrink-0">
            <Phone size={18} className="text-brand" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">Think this is a mistake?</span>
            <span className="text-xs text-text-muted leading-snug">
              Contact your hub manager to have your account re-activated.
            </span>
          </div>
        </div>
      </div>

      {/* CTA - once re-activated, the rider signs back in from here */}
      <div className="px-5 pt-6 pb-10 flex flex-col gap-3 relative">
        <Button variant="secondary" onClick={resetDeactivated}>
          <LogIn size={18} />
          Back to sign in
        </Button>
        <p className="text-xs text-center text-text-muted">
          Re-activated already? Sign in again to continue.
        </p>
      </div>
    </div>
  )
}
