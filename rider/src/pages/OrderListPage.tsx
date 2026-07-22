import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft, RefreshCw, AlertCircle, Package, Banknote, ChevronRight,
} from 'lucide-react'
import { getRiderParcels, type Parcel, type ParcelStatus } from '../lib/api'
import ParcelActionSheet from '../components/ParcelActionSheet'
import PullToRefresh from '../components/PullToRefresh'

// Each dashboard stat drills into the orders behind it. Keyed by the ?view=
// query param so the Dashboard cards can deep-link straight to a filtered list.
const VIEWS: Record<string, { title: string; subtitle: string; statuses: ParcelStatus[] }> = {
  picked_up: {
    title: 'Picked Up',
    subtitle: 'Orders you have collected',
    statuses: ['picked_up'],
  },
  delivered: {
    title: 'Delivered',
    subtitle: 'Orders you have delivered',
    statuses: ['delivered', 'partially_delivered'],
  },
  return: {
    title: 'Returns',
    subtitle: 'Orders being returned to vendor',
    statuses: ['sent_to_vendor', 'returned_to_vendor'],
  },
}

const PILL: Partial<Record<ParcelStatus, { label: string; cls: string }>> = {
  picked_up:           { label: 'Picked Up', cls: 'text-brand bg-brand-dim' },
  delivered:           { label: 'Delivered', cls: 'text-success bg-success/10' },
  partially_delivered: { label: 'Partial',   cls: 'text-yellow-400 bg-yellow-400/10' },
  sent_to_vendor:      { label: 'Returning', cls: 'text-blue-400 bg-blue-400/10' },
  returned_to_vendor:  { label: 'Returned',  cls: 'text-success bg-success/10' },
}

export default function OrderListPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const view = params.get('view') ?? 'picked_up'
  const cfg = VIEWS[view] ?? VIEWS.picked_up

  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [selected, setSelected] = useState<Parcel | null>(null)

  // Re-fetch on the specific status set — cfg identity is stable per view.
  const statusesKey = useMemo(() => cfg.statuses.join(','), [cfg])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await getRiderParcels(cfg.statuses)
      setParcels(result.data)
      setTruncated(result.truncated)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-1">
        <button
          onClick={() => navigate('/dashboard')}
          style={{ touchAction: 'manipulation' }}
          aria-label="Back"
          className="w-10 h-10 flex items-center justify-center rounded-2xl text-text-muted hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">{cfg.subtitle}</p>
          <h1 className="text-xl font-bold text-text-primary">
            {cfg.title}
            {parcels.length > 0 && (
              <span className="ml-2 text-sm font-semibold text-brand bg-brand-dim px-2 py-0.5 rounded-full">
                {parcels.length}
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ touchAction: 'manipulation' }}
          aria-label="Refresh"
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 border border-border text-text-muted transition-colors cursor-pointer disabled:opacity-40"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <PullToRefresh onRefresh={load} className="flex-1">
        {error && (
          <div className="mx-5 mt-4 flex items-center gap-3 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-error shrink-0" />
            <p className="text-sm text-error flex-1">{error}</p>
            <button onClick={load} className="text-error cursor-pointer" aria-label="Retry">
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {!error && truncated && (
          <div className="mx-5 mt-4 flex items-start gap-3 bg-yellow-400/10 border border-yellow-400/30 rounded-2xl px-4 py-3">
            <AlertCircle size={15} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-400 leading-snug flex-1">
              You have a large number of orders — some may not be shown below. Contact your hub manager if a parcel is missing.
            </p>
          </div>
        )}

        {loading && (
          <div className="px-5 mt-4 flex flex-col gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !error && parcels.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 px-8 text-center pt-20">
            <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center border border-border">
              <Package size={36} className="text-text-muted" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-base font-semibold text-text-primary">Nothing here yet</p>
              <p className="text-sm text-text-muted mt-1">No {cfg.title.toLowerCase()} orders to show</p>
            </div>
          </div>
        )}

        {parcels.length > 0 && (
          <div className="px-5 pt-4 pb-6 flex flex-col gap-2.5">
            {parcels.map(p => {
              const pill = PILL[p.status]
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full flex items-center gap-3 bg-surface-2 rounded-2xl border border-border px-4 py-3.5 active:opacity-70 transition-opacity cursor-pointer text-left"
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-text-primary font-mono truncate">{p.trackingId}</span>
                      {!!p.codAmount && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-full shrink-0">
                          <Banknote size={9} /> COD
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-muted truncate">
                      {p.receiverName}{p.destination ? ` · ${p.destination}` : ''}
                    </span>
                  </div>
                  {pill && (
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${pill.cls}`}>
                      {pill.label}
                    </span>
                  )}
                  <ChevronRight size={14} className="text-text-muted shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </PullToRefresh>

      {selected && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <ParcelActionSheet
            parcel={selected}
            onClose={() => setSelected(null)}
            onDone={() => { setSelected(null); load() }}
          />
        </div>
      )}
    </div>
  )
}
