import { useNavigate, useLocation } from 'react-router-dom'
import { LayoutGrid, ScanLine, Clock, Wallet } from 'lucide-react'
import { usePending } from '../context/PendingContext'

export default function BottomNav() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { parcels }  = usePending()
  const pendingCount = parcels.length

  const tabs = [
    { path: '/dashboard',   icon: LayoutGrid, label: 'Dashboard',   badge: 0 },
    { path: '/scan',        icon: ScanLine,   label: 'Scan',        badge: 0 },
    { path: '/pending',     icon: Clock,      label: 'Pending',     badge: pendingCount },
    { path: '/settlements', icon: Wallet,     label: 'Settlements', badge: 0 },
  ]

  return (
    <nav
      className="flex items-center justify-around bg-surface border-t border-border"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))', paddingTop: 10 }}
    >
      {tabs.map(({ path, icon: Icon, label, badge }) => {
        const active = pathname === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            style={{ touchAction: 'manipulation', minWidth: 64, minHeight: 44 }}
            className="flex flex-col items-center gap-1 cursor-pointer"
          >
            <span
              className={`
                relative flex items-center justify-center w-12 h-12 rounded-2xl
                transition-all duration-200
                ${active
                  ? 'bg-brand text-white scale-105'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'}
              `}
              style={active ? { boxShadow: '0 4px 16px rgba(249,115,22,0.35)' } : {}}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {badge > 0 && !active && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold px-1"
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
