import { useEffect, useState } from 'react'
import {
  Package, Truck, Building2, MapPin,
  RefreshCw, AlertCircle, Banknote, ChevronRight,
} from 'lucide-react'
import { usePending } from '../context/PendingContext'
import ParcelActionSheet from '../components/ParcelActionSheet'
import { PENDING_QUEUE_STATUSES, type Parcel, type ParcelStatus } from '../lib/api'

// ── Filter definitions ────────────────────────────────────────────────────

type FilterKey = 'all' | 'pickup' | 'delivery' | 'dropoff'

interface FilterDef {
  key: FilterKey
  label: string
  statuses: ParcelStatus[]
  icon: typeof Package
  accent: string          // Tailwind text colour
  border: string          // left-border colour class
  bg: string              // icon bg
}

const FILTERS: FilterDef[] = [
  {
    key:      'all',
    label:    'All',
    statuses: PENDING_QUEUE_STATUSES,
    icon:     Package,
    accent:   'text-text-primary',
    border:   'border-l-border',
    bg:       'bg-surface',
  },
  {
    key:      'pickup',
    label:    'Pickup',
    statuses: ['rider_assigned'],
    icon:     Truck,
    accent:   'text-yellow-400',
    border:   'border-l-yellow-400',
    bg:       'bg-yellow-400/10',
  },
  {
    key:      'dropoff',
    label:    'Dispatch',
    statuses: ['picked_up', 'dispatched'],
    icon:     Building2,
    accent:   'text-blue-400',
    border:   'border-l-blue-400',
    bg:       'bg-blue-400/10',
  },
  {
    key:      'delivery',
    label:    'Deliver',
    statuses: ['sent_for_delivery'],
    icon:     MapPin,
    accent:   'text-brand',
    border:   'border-l-brand',
    bg:       'bg-brand-dim',
  },
]

const STATUS_LABEL: Record<string, string> = {
  rider_assigned:    'Pickup',
  picked_up:         'Drop at Hub',
  dispatched:        'Drop at Branch',
  sent_for_delivery: 'Deliver',
}

function filterFor(key: FilterKey): FilterDef {
  return FILTERS.find(f => f.key === key)!
}

// ── Parcel card ───────────────────────────────────────────────────────────

function ParcelCard({ parcel, onTap }: { parcel: Parcel; onTap: () => void }) {
  const def   = FILTERS.find(f => (f.statuses as string[]).includes(parcel.status)) ?? FILTERS[0]
  const Icon  = def.icon

  return (
    <button
      onClick={onTap}
      style={{ touchAction: 'manipulation' }}
      className={`w-full flex items-stretch gap-0 bg-surface-2 rounded-2xl border border-border border-l-4 ${def.border} active:opacity-70 transition-opacity cursor-pointer text-left overflow-hidden`}
    >
      {/* Icon column */}
      <div className={`flex items-center justify-center w-12 shrink-0 ${def.bg}`}>
        <Icon size={15} className={def.accent} />
      </div>

      {/* Content */}
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
            {parcel.receiverName}
            {parcel.destination ? ` · ${parcel.destination}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${def.bg} ${def.accent}`}>
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
  const { parcels, loading, error, refresh } = usePending()
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [selected,     setSelected]     = useState<Parcel | null>(null)

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDone = () => { setSelected(null); refresh() }

  const countFor = (f: FilterDef) =>
    parcels.filter(p => (f.statuses as string[]).includes(p.status)).length

  const visibleParcels = parcels.filter(p =>
    (filterFor(activeFilter).statuses as string[]).includes(p.status)
  )

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden">

      {/* ── Sticky header + filters ── */}
      <div className="flex-shrink-0 bg-bg">
        <div className="flex items-center justify-between px-5 pt-6 pb-3">
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">Your Queue</p>
            <h1 className="text-xl font-bold text-text-primary mt-0.5">
              Pending
              {parcels.length > 0 && (
                <span className="ml-2 text-sm font-semibold text-brand bg-brand-dim px-2 py-0.5 rounded-full">
                  {parcels.length}
                </span>
              )}
            </h1>
          </div>
          <button
            onClick={refresh}
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
            const active = activeFilter === f.key
            const Icon   = f.icon
            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                style={{ touchAction: 'manipulation' }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all cursor-pointer shrink-0
                  ${active
                    ? `${f.bg} ${f.accent} border-transparent`
                    : 'bg-surface-2 text-text-muted border-border hover:text-text-secondary'
                  }`}
              >
                <Icon size={11} />
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center
                    ${active ? 'bg-black/10' : 'bg-surface text-text-muted border border-border'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-border mx-5" />
      </div>

      {/* ── Scrollable list ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 flex items-center gap-3 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-error shrink-0" />
            <p className="text-sm text-error flex-1">{error}</p>
            <button onClick={refresh} className="text-error cursor-pointer" aria-label="Retry">
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {/* Skeleton */}
        {loading && parcels.length === 0 && (
          <div className="px-5 mt-4 flex flex-col gap-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty: no parcels at all */}
        {!loading && !error && parcels.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pt-16">
            <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center border border-border">
              <Package size={36} className="text-text-muted" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-base font-semibold text-text-primary">All clear</p>
              <p className="text-sm text-text-muted mt-1">No parcels waiting for action</p>
            </div>
          </div>
        )}

        {/* Empty: filter has no results */}
        {!loading && !error && parcels.length > 0 && visibleParcels.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 text-center pt-16">
            <div className="w-16 h-16 rounded-3xl bg-surface-2 flex items-center justify-center border border-border">
              {(() => { const Icon = filterFor(activeFilter).icon; return <Icon size={26} className="text-text-muted" strokeWidth={1.5} /> })()}
            </div>
            <p className="text-sm text-text-secondary">
              No <span className="font-semibold">{filterFor(activeFilter).label.toLowerCase()}</span> parcels right now
            </p>
          </div>
        )}

        {/* List */}
        {visibleParcels.length > 0 && (
          <div className="px-5 pt-4 pb-6 flex flex-col gap-2.5">
            {visibleParcels.map(p => (
              <ParcelCard key={p.id} parcel={p} onTap={() => setSelected(p)} />
            ))}
          </div>
        )}
      </div>

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
