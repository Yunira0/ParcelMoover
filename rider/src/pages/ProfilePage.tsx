import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, KeyRound, Laptop, LogOut, Moon, Phone, ShieldCheck, Sun } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useThemePreference, type ThemePreference } from '../context/ThemeContext'
import { PHONE_DISPLAY, PHONE_TEL } from '../constants/contact'
import Button from '../components/Button'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}

// Pen "Row / Action": bare hairline-divided row, icon + label left, chevron
// or trailing value right - same shape the Queue/Orders lists already use.
function ActionRow({
  icon: Icon, label, trailing, href, onClick,
}: {
  icon: typeof KeyRound
  label: string
  trailing?: string
  href?: string
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg">
        <Icon size={16} className="text-ink-2" strokeWidth={1.8} />
      </span>
      <span className="flex-1 text-[14px] font-medium text-ink">{label}</span>
      {trailing && <span className="text-[12.5px] text-ink-3">{trailing}</span>}
      <ChevronRight size={16} className="shrink-0 text-ink-3" />
    </>
  )
  const className = "flex w-full cursor-pointer items-center gap-3 py-[13px] text-left"
  return href
    ? <a href={href} style={{ touchAction: 'manipulation' }} className={className}>{content}</a>
    : <button onClick={onClick} style={{ touchAction: 'manipulation' }} className={className}>{content}</button>
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { rider, logout } = useAuth()
  const { preference, setPreference } = useThemePreference()

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">

      {/* Header — matches OrderListPage's back-header treatment */}
      <div className="flex flex-shrink-0 items-center gap-3 px-5 pt-1.5">
        <button
          onClick={() => navigate('/dashboard')}
          style={{ touchAction: 'manipulation' }}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors cursor-pointer hover:text-ink-2 active:bg-surface-2"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.4px] text-ink">Profile</h1>
      </div>

      <div className="flex flex-col gap-6 px-5 pb-8 pt-6">

        {/* Identity */}
        <div className="flex items-center gap-3.5">
          <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-ink">
            <span className="text-xl font-bold text-bg">{initialsFor(rider?.fullName ?? '?')}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <p className="truncate text-lg font-bold text-ink">{rider?.fullName ?? 'Rider'}</p>
            <p className="truncate font-mono text-[12.5px] text-ink-3">{rider?.email ?? '—'}</p>
          </div>
        </div>

        {/* Info card */}
        <div className="rounded-[14px] border border-line bg-surface px-[14px]">
          <div className="flex items-center gap-3 border-b border-line py-[13px]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg">
              <Phone size={16} className="text-ink-2" strokeWidth={1.8} />
            </span>
            <span className="flex-1 text-[13px] font-medium text-ink-2">Phone</span>
            <span className="font-mono text-[13.5px] font-semibold text-ink">{rider?.phone ?? '—'}</span>
          </div>
          <div className="flex items-center gap-3 py-[13px]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg">
              <ShieldCheck size={16} className="text-ink-2" strokeWidth={1.8} />
            </span>
            <span className="flex-1 text-[13px] font-medium text-ink-2">Role</span>
            <span className="text-[13.5px] font-semibold text-ink">Rider</span>
          </div>
        </div>

        {/* Appearance */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-[1.4px] text-ink-3">APPEARANCE</p>
          <div className="flex gap-1 rounded-[12px] border border-line bg-bg p-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = preference === value
              return (
                <button
                  key={value}
                  onClick={() => setPreference(value)}
                  style={{ touchAction: 'manipulation' }}
                  aria-pressed={active}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] py-2.5 text-[12.5px] font-semibold transition-colors
                    ${active ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'}`}
                >
                  <Icon size={14} strokeWidth={2} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-[1.4px] text-ink-3">ACCOUNT</p>
          <div className="rounded-[14px] border border-line bg-surface px-[14px]">
            <div className="border-b border-line">
              <ActionRow icon={KeyRound} label="Change password" onClick={() => navigate('/profile/change-password')} />
            </div>
            <ActionRow icon={Phone} label="Call support" trailing={PHONE_DISPLAY} href={PHONE_TEL} />
          </div>
        </div>

        <Button variant="secondary" onClick={logout} className="mt-1">
          <LogOut size={17} strokeWidth={2} />
          Log out
        </Button>
      </div>
    </div>
  )
}
