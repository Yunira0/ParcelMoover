import { useNavigate, useLocation } from 'react-router-dom'
import { LayoutGrid, ScanLine, Inbox, Wallet } from 'lucide-react'
import { usePending } from '../context/PendingContext'

// Pen "Tab Bar": white surface with a 1px top hairline, items row h56 padded
// [7,6,0,6]; each tab is a vertical stack (icon 21, label 10.5, 4px rust dot).
// Active tab renders icon + label in ink; inactive in ink-3. The dot sits
// under every tab; the Queue tab carries the pending-count badge (17x16).
export default function BottomNav() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { parcels }  = usePending()
  const pendingCount = parcels.length

  const tabs = [
    { path: '/dashboard',   icon: LayoutGrid, label: 'Dashboard', badge: 0 },
    { path: '/scan',        icon: ScanLine,   label: 'Scan',      badge: 0 },
    { path: '/pending',     icon: Inbox,      label: 'Queue',     badge: pendingCount },
    { path: '/settlements', icon: Wallet,     label: 'Money',     badge: 0 },
  ]

  return (
    <nav
      className="flex items-stretch bg-surface border-t border-line"
      style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
    >
      {tabs.map(({ path, icon: Icon, label, badge }) => {
        const active = pathname === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            style={{ touchAction: 'manipulation', minHeight: 56 }}
            className={`flex flex-col items-center justify-start gap-[3px] flex-1 pt-[7px] pb-1 cursor-pointer transition-colors
              ${active ? 'text-ink' : 'text-ink-3 active:text-ink-2'}`}
          >
            <span className="relative">
              <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
              {badge > 0 && !active && (
                <span
                  className="absolute -top-1.5 -right-2 min-w-[17px] h-4 flex items-center justify-center rounded-full bg-rust px-1 text-[9.5px] font-semibold leading-none text-white"
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span className={`text-[10.5px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
              {label}
            </span>
            {/* Rust dot under every tab, per the pen component */}
            <span className="h-1 w-1 rounded-full bg-rust" />
          </button>
        )
      })}
    </nav>
  )
}
