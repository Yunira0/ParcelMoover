import { useEffect, useState } from 'react'
import {
  Package, Truck, MapPin, RotateCcw,
  RefreshCw, AlertCircle, Banknote, ChevronRight, CheckCircle2, XCircle,
} from 'lucide-react'
import { usePending } from '../context/PendingContext'
import ParcelActionSheet from '../components/ParcelActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import { getRiderParcels, type Parcel, type ParcelStatus } from '../lib/api'

// ── Lanes ──────────────────────────────────────────────────────────────────
// Three filters, each covering the whole lane: the parcels still awaiting a
// rider action (pending) plus the ones that lane has already completed.

type FilterKey = 'pickup' | 'delivery' | 'return'

interface FilterDef {
  key: FilterKey
  label: string
  statuses: ParcelStatus[]
  icon: typeof Package
  accent: string   // Tailwind text colour
  border: string   // left-border colour class
  bg: string       // icon bg
}

const FILTERS: FilterDef[] = [
  {
    key: 'pickup',
    label: 'Pickup',
    statuses: ['rider_assigned', 'picked_up', 'failed_pickup'],
    icon: Truck,
    accent: 'text-yellow-400',
    border: 'border-l-yellow-400',
    bg: 'bg-yellow-400/10',
  },
  {
    key: 'delivery',
    label: 'Delivery',
    statuses: ['sent_for_delivery', 'dispatched', 'delivered', 'partially_delivered', 'failed_delivery'],
    icon: MapPin,
    accent: 'text-brand',
    border: 'border-l-brand',
    bg: 'bg-brand-dim',
  },
  {
    key: 'return',
    label: 'Return',
    statuses: ['sent_to_vendor', 'returned_to_vendor'],
    icon: RotateCcw,
    accent: 'text-blue-400',
    border: 'border-l-blue-400',
    bg: 'bg-blue-400/10',
  },
]

// Completed / return statuses aren't in the actionable queue the PendingContext
// tracks (it feeds the nav badge, which must stay = work-to-do). Fetch them
// separately so each lane can also show what it has already finished.
const COMPLETED_STATUSES: ParcelStatus[] = [
  'delivered', 'partially_delivered', 'failed_pickup', 'failed_delivery',
  'sent_to_vendor', 'returned_to_vendor',
]

// Statuses that count as "done" within their lane — shown with a success pill
// so a rider can tell finished parcels apart from ones still needing action.
const DONE_STATUSES = new Set<ParcelStatus>([
  'picked_up', 'delivered', 'partially_delivered', 'returned_to_vendor',
])

// Terminal failures — shown with an error pill so they read differently from
// both actionable and successfully-completed parcels.
const FAILED_STATUSES = new Set<ParcelStatus>(['failed_pickup', 'failed_delivery'])

const STATUS_LABEL: Record<string, string> = {
  rider_assigned:      'To Pick Up',
  picked_up:           'Picked Up',
  sent_for_delivery:   'To Deliver',
  dispatched:          'Dispatched',
  delivered:           'Delivered',
  partially_delivered: 'Partial',
  ready_to_return:     'To Return',
  sent_to_vendor:      'Returning',
  returned_to_vendor:  'Returned',
  failed_pickup:       'Failed',
  failed_delivery:     'Failed',
}

function laneFor(status: ParcelStatus): FilterDef {
  return FILTERS.find(f => (f.statuses as string[]).includes(status)) ?? FILTERS[0]
}

// ── Parcel card ───────────────────────────────────────────────────────────

function ParcelCard({ parcel, onTap }: { parcel: Parcel; onTap: () => void }) {
  const def    = laneFor(parcel.status)
  const done   = DONE_STATUSES.has(parcel.status)
  const failed = FAILED_STATUSES.has(parcel.status)
  const Icon   = def.icon

  const iconBg   = failed ? 'bg-error/10' : done ? 'bg-success/10' : def.bg
  const iconTone = failed ? 'text-error'  : done ? 'text-success'  : def.accent
  const pillCls  = failed ? 'text-error bg-error/10'
                 : done   ? 'text-success bg-success/10'
                 : `${def.bg} ${def.accent}`

  return (
    <button
      onClick={onTap}
      style={{ touchAction: 'manipulation' }}
      className={`w-full flex items-stretch gap-0 bg-surface-2 rounded-2xl border border-border border-l-4 ${failed ? 'border-l-error' : def.border} active:opacity-70 transition-opacity cursor-pointer text-left overflow-hidden`}
    >
      <div className={`flex items-center justify-center w-12 shrink-0 ${iconBg}`}>
        <Icon size={15} className={iconTone} />
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3.5">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-text-primary font-mono truncate">
              {parcel.trackingId}
            </span>
            {!!parcel.codAmount && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full shrink-0">
                <Banknote size={9} /> COD
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted truncate">
            {parcel.receiverName}{parcel.destination ? ` · ${parcel.destination}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${pillCls}`}>
            {failed ? <XCircle size={10} /> : done ? <CheckCircle2 size={10} /> : null}
            {STATUS_LABEL[parcel.status] ?? parcel.status}
          </span>
          <ChevronRight size={14} className="text-text-muted" />
        </div>
      </div>
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PendingPage() {
  const { parcels: queue, loading, error, truncated: queueTruncated, refresh } = usePending()
  const [completed, setCompleted] = useState<Parcel[]>([])
  const [completedTruncated, setCompletedTruncated] = useState(false)
  const [activeFilter, setActiveFilter] = useState<FilterKey>('pickup')
  const [selected, setSelected] = useState<Parcel | null>(null)

  async function loadCompleted() {
    try {
      const result = await getRiderParcels(COMPLETED_STATUSES)
      setCompleted(result.data)
      setCompletedTruncated(result.truncated)
    } catch {
      // Non-fatal: the actionable queue (which drives the badge) still loads;
      // completed/return history just won't appear until the next refresh.
    }
  }

  async function refreshAll() {
    await Promise.all([refresh(), loadCompleted()])
  }

  useEffect(() => { loadCompleted() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDone = () => { setSelected(null); refreshAll() }

  // Merge the actionable queue with the fetched completed/return parcels,
  // de-duped by id (a status can appear in both sources briefly after an update).
  const seen = new Set<string>()
  const all: Parcel[] = [...queue, ...completed].filter(p => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })

  const countFor = (f: FilterDef) =>
    all.filter(p => (f.statuses as string[]).includes(p.status)).length

  const active = FILTERS.find(f => f.key === activeFilter)!
  const visibleParcels = all.filter(p => (active.statuses as string[]).includes(p.status))

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden">

      {/* ── Sticky header + filters ── */}
      <div className="flex-shrink-0 bg-bg">
        <div className="flex items-center justify-between px-5 pt-6 pb-3">
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">Your Queue</p>
            <h1 className="text-xl font-bold text-text-primary mt-0.5">
              Pending
              {queue.length > 0 && (
                <span className="ml-2 text-sm font-semibold text-brand bg-brand-dim px-2 py-0.5 rounded-full">
                  {queue.length}
                </span>
              )}
            </h1>
          </div>
          <button
            onClick={refreshAll}
            disabled={loading}
            style={{ touchAction: 'manipulation' }}
            aria-label="Refresh"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 border border-border text-text-muted transition-colors cursor-pointer disabled:opacity-40"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 px-5 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => {
            const count  = countFor(f)
            const isOn   = activeFilter === f.key
            const Icon   = f.icon
            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                style={{ touchAction: 'manipulation' }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all cursor-pointer shrink-0
                  ${isOn
                    ? `${f.bg} ${f.accent} border-transparent`
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-secondary'
                  }`}
              >
                <Icon size={12} />
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center
                    ${isOn ? 'bg-black/10' : 'bg-surface text-text-muted border border-border'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="h-px bg-border mx-5" />
      </div>

      {/* ── Scrollable list ── */}
      <PullToRefresh onRefresh={refreshAll} className="flex-1">

        {error && (
          <div className="mx-5 mt-4 flex items-center gap-3 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-error shrink-0" />
            <p className="text-sm text-error flex-1">{error}</p>
            <button onClick={refreshAll} className="text-error cursor-pointer" aria-label="Retry">
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {!error && (queueTruncated || completedTruncated) && (
          <div className="mx-5 mt-4 flex items-start gap-3 bg-yellow-400/10 border border-yellow-400/30 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-400 leading-snug flex-1">
              You have a large number of orders — some may not be shown below. Contact your hub manager if a parcel is missing.
            </p>
          </div>
        )}

        {loading && all.length === 0 && (
          <div className="px-5 mt-4 flex flex-col gap-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !error && visibleParcels.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 text-center pt-16">
            <div className="w-16 h-16 rounded-3xl bg-surface-2 flex items-center justify-center border border-border">
              <active.icon size={26} className="text-text-muted" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-text-secondary">
              No <span className="font-semibold">{active.label.toLowerCase()}</span> orders right now
            </p>
          </div>
        )}

        {visibleParcels.length > 0 && (
          <div className="px-5 pt-4 pb-6 flex flex-col gap-2.5">
            {visibleParcels.map(p => (
              <ParcelCard key={p.id} parcel={p} onTap={() => setSelected(p)} />
            ))}
          </div>
        )}
      </PullToRefresh>

      {/* Action sheet overlay */}
      {selected && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <ParcelActionSheet
            parcel={selected}
            onClose={() => setSelected(null)}
            onDone={handleDone}
          />
        </div>
      )}
    </div>
  )
}
