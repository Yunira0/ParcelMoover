import { useEffect, useState } from 'react'
import {
  Truck, AlertCircle, RefreshCw, LogOut,
  PackageCheck, RotateCcw, Banknote, Coins,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getDashboardSummary, type DashboardSummary } from '../lib/api'

export default function DashboardPage() {
  const { rider, logout } = useAuth()

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setSummary(await getDashboardSummary())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-2">
        <div>
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">Dashboard</p>
          <h1 className="text-xl font-bold text-text-primary mt-0.5">
            Hey, {rider?.fullName?.split(' ')[0] ?? 'Rider'} 👋
          </h1>
        </div>
        <button
          onClick={logout}
          style={{ touchAction: 'manipulation' }}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 border border-border text-text-muted hover:text-error hover:border-error/30 hover:bg-error/10 transition-colors cursor-pointer"
          aria-label="Sign out"
        >
          <LogOut size={15} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 flex items-center gap-3 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
          <AlertCircle size={16} className="text-error shrink-0" />
          <p className="text-sm text-error flex-1">{error}</p>
          <button onClick={load} className="text-error cursor-pointer" aria-label="Retry">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {/* Skeleton loader */}
      {loading && (
        <div className="px-5 mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
          <div className="h-40 rounded-2xl bg-surface-2 animate-pulse" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* Lifetime stats */}
          <div className="px-5 mt-4">
            <p className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">Overall</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2 bg-surface rounded-2xl p-4 border border-border">
                <Truck size={17} className="text-brand" />
                <span className="text-2xl font-bold text-text-primary">{summary.overview.totalPickedUp}</span>
                <span className="text-xs text-text-muted">Total Picked Up</span>
              </div>
              <div className="flex flex-col gap-2 bg-surface rounded-2xl p-4 border border-border">
                <PackageCheck size={17} className="text-success" />
                <span className="text-2xl font-bold text-text-primary">{summary.overview.totalDelivered}</span>
                <span className="text-xs text-text-muted">Total Delivered</span>
              </div>
              <div className="flex flex-col gap-2 bg-surface rounded-2xl p-4 border border-border">
                <RotateCcw size={17} className="text-blue-400" />
                <span className="text-2xl font-bold text-text-primary">{summary.overview.totalReturns}</span>
                <span className="text-xs text-text-muted">Total RTV</span>
              </div>
              <div className="flex flex-col gap-2 bg-surface rounded-2xl p-4 border border-border">
                <Coins size={17} className="text-yellow-400" />
                <span className="text-2xl font-bold text-text-primary">
                  {summary.codSettlement.totalCod > 0
                    ? `Rs ${summary.codSettlement.totalCod.toLocaleString()}`
                    : '—'}
                </span>
                <span className="text-xs text-text-muted">Total COD</span>
              </div>
            </div>
          </div>

          {/* To Pay card */}
          <div className="px-5 mt-4">
            <div className="bg-surface rounded-2xl border border-border p-4 flex flex-col gap-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">To Pay</p>

              {/* Main amount */}
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold text-text-muted">Rs</span>
                <span className="text-4xl font-bold text-text-primary tabular-nums leading-none">
                  {summary.codSettlement.pendingCod > 0
                    ? summary.codSettlement.pendingCod.toLocaleString()
                    : '0'}
                </span>
              </div>

              {/* Divider */}
              <div className="h-px bg-border" />

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Banknote size={13} className="text-yellow-400 shrink-0" />
                    <span className="text-xl font-bold text-text-primary tabular-nums">
                      {summary.codSettlement.pendingCodCount}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted">Parcels w/ COD</span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <PackageCheck size={13} className="text-success shrink-0" />
                    <span className="text-xl font-bold text-text-primary tabular-nums">
                      {summary.overview.totalDelivered}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted">Delivered</span>
                </div>
              </div>
            </div>
          </div>

          {/* Active parcels list */}
        </>
      )}
    </div>
  )
}
