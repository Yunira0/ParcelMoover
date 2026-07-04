import { useNavigate } from 'react-router-dom'
import { Package, Zap, MapPin, Bell } from 'lucide-react'
import Button from '../components/Button'

const features = [
  { icon: Zap,     label: 'Instant dispatch',        desc: 'Get notified the moment a parcel is assigned' },
  { icon: MapPin,  label: 'Route guidance',           desc: 'Pickup and delivery addresses at a glance'    },
  { icon: Bell,    label: 'Real-time alerts',         desc: 'Never miss a status update'                   },
]

export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col flex-1 relative overflow-hidden bg-bg">

      {/* Gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 w-80 h-80 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-40 -right-20 w-64 h-64 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }}
        />
      </div>

      {/* Hero section */}
      <div className="flex flex-col items-center pt-20 pb-10 px-6 gap-6 relative">
        {/* Logo */}
        <div className="relative">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center bg-brand"
            style={{ boxShadow: '0 8px 32px rgba(249,115,22,0.45)' }}
          >
            <Package size={46} strokeWidth={1.75} className="text-white" />
          </div>
          {/* Ping animation */}
          <span className="absolute inset-0 rounded-3xl bg-brand opacity-30 animate-ping" />
        </div>

        {/* Wordmark */}
        <div className="text-center flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand uppercase">
            ParcelMoover
          </p>
          <h1 className="text-4xl font-extrabold text-text-primary tracking-tight leading-none">
            Rider App
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed mt-1">
            Everything you need to pick up<br />and deliver — right here.
          </p>
        </div>
      </div>

      {/* Feature cards */}
      <div className="flex flex-col gap-3 px-5 flex-1">
        {features.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className="flex items-center gap-4 bg-surface rounded-2xl px-4 py-4 border border-border"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-dim flex items-center justify-center shrink-0">
              <Icon size={18} className="text-brand" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-text-primary">{label}</span>
              <span className="text-xs text-text-muted leading-snug">{desc}</span>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="px-5 pt-6 pb-10 flex flex-col gap-3">
        <Button onClick={() => navigate('/login')}>
          Sign in to your account
        </Button>
        <p className="text-xs text-center text-text-muted">
          Don't have an account? Contact your manager.
        </p>
      </div>
    </div>
  )
}
