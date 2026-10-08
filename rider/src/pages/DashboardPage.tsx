import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Truck, AlertCircle, RefreshCw, User, ArrowUpRight,
  PackageCheck, RotateCcw, Banknote, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getDashboardSummary, type DashboardSummary } from '../lib/api'
import PullToRefresh from '../components/PullToRefresh'

const fmt = (n: number) => n.toLocaleString()

// Pen "Screen / Dashboard" (p4WZNZ): uppercase English date caption over the
// rider's name, the To Pay card on TOP (white r14, 1px #E7E7E3 border, gap 10
// with explicit 6/12px spacers -> amount->rule 26px, rule->stats 32px), then
// the ledger card below it (24px gap, divider inset 47px).
export default function DashboardPage() {
  const { rider } = useAuth()
  const navigate = useNavigate()

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

  // Pen date caption: fs10 fw500 ls1.4 #75756E.
  const now = new Date()
  const caption = `${now.toLocaleDateString('en-US', { weekday: 'long' })}, ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'long' })}`.toUpperCase()

  // Stat rows drill into the orders behind them. Tone per pen ledger card:
  // picked up = rust, delivered = green, returns = blue, COD = olive.
  const statRows = summary ? [
    { icon: Truck,        tone: 'text-rust',   label: 'Picked up',     value: fmt(summary.overview.totalPickedUp),  onClick: () => navigate('/orders?view=picked_up') },
    { icon: PackageCheck, tone: 'text-green',  label: 'Delivered',     value: fmt(summary.overview.totalDelivered), onClick: () => navigate('/orders?view=delivered') },
    { icon: RotateCcw,    tone: 'text-blue',   label: 'Returns',       value: fmt(summary.overview.totalReturns),   onClick: () => navigate('/orders?view=return') },
    { icon: Banknote,     tone: 'text-olive',  label: 'COD collected', value: `Rs ${fmt(summary.codSettlement.totalCod)}`, onClick: () => navigate('/settlements') },
  ] : []

  return (
    <PullToRefresh onRefresh={load} className="flex flex-col flex-1 bg-bg">

      {/* Header — pen Body pad top 6, sides 20; Header->To Pay gap 0 */}
      <div className="flex items-center justify-between px-5 pt-1.5">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium tracking-[1.4px] text-ink-3">{caption}</p>
          <h1 className="text-[27px] font-bold leading-none tracking-[-0.5px] text-ink">
            {rider?.fullName ?? 'Rider'}
          </h1>
        </div>
        <button
          onClick={() => navigate('/profile')}
          style={{ touchAction: 'manipulation' }}
          aria-label="Profile"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors cursor-pointer"
        >
          <User size={16} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
          <AlertCircle size={15} className="shrink-0 text-red-bright" />
          <p className="flex-1 text-sm text-red-bright">{error}</p>
          <button onClick={load} className="text-red-bright cursor-pointer" aria-label="Retry">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {/* Skeleton loader */}
      {loading && (
        <div className="mt-4 flex flex-col gap-3.5 px-5">
          <div className="h-[177px] rounded-[14px] bg-surface-2 animate-pulse" />
          <div className="h-[219px] rounded-[14px] bg-surface-2 animate-pulse" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* To Pay card — white r14, 1px #E7E7E3 border; sits right under header (gap 0) */}
          <button
            onClick={() => navigate('/settlements')}
            style={{ touchAction: 'manipulation' }}
            className="mx-5 block text-left rounded-[14px] border border-line bg-surface px-[18px] pt-[18px] pb-4 cursor-pointer active:bg-surface-2/60 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-[1.8px] text-rust">TO PAY</span>
              <ArrowUpRight size={15} className="text-ink-3" />
            </div>

            <div className="mt-2.5 flex items-end gap-[7px]">
              <span className="text-[15px] font-semibold text-ink-2">Rs</span>
              <span className="text-[46px] font-bold leading-none tracking-[-1.4px] tabular-nums text-ink">
                {summary.codSettlement.pendingCod > 0 ? fmt(summary.codSettlement.pendingCod) : '0'}
              </span>
            </div>

            <div className="mt-[26px] h-px bg-line" />
            <div className="mt-8 flex items-center gap-5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <Banknote size={13} className="shrink-0 text-olive" />
                {fmt(summary.codSettlement.pendingCodCount)} parcels with COD
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                <PackageCheck size={13} className="shrink-0 text-green" />
                {fmt(summary.overview.totalDelivered)} delivered
              </span>
            </div>
          </button>

          {/* Ledger card — white r14, 1px #E7E7E3 border; 24px below To Pay card */}
          <div className="mx-5 mt-6 rounded-[14px] border border-line bg-surface overflow-hidden">
            {statRows.map(({ icon: Icon, tone, label, value, onClick }, i) => (
              <Fragment key={label}>
                {i > 0 && <div className="ml-[47px] h-px bg-line" />}
                <button
                  onClick={onClick}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full flex items-center gap-3 px-[18px] py-4 text-left cursor-pointer active:bg-surface-2/60 transition-colors"
                >
                  <Icon size={17} strokeWidth={2} className={`shrink-0 ${tone}`} />
                  <span className="text-sm font-medium text-ink-2">{label}</span>
                  <span className="ml-auto text-[17px] font-semibold tabular-nums text-ink">{value}</span>
                  <ChevronRight size={15} className="shrink-0 text-ink-3" />
                </button>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </PullToRefresh>
  )
}
