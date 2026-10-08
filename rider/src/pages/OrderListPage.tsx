import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft, RefreshCw, AlertCircle, Package,
  Banknote, ChevronRight, Loader2,
} from 'lucide-react'
import { getRiderParcelsPage, type Parcel, type ParcelStatus } from '../lib/api'
import ParcelActionSheet from '../components/ParcelActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import StatusChip from '../components/StatusChip'

const PAGE_SIZE = 20

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

// Pen "Screen / Orders": bordered white-circle back/refresh around a 24/700
// title with the subtitle below it, an 18px gap, then a bare hairline-divided
// parcel list.
export default function OrderListPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const view = params.get('view') ?? 'picked_up'
  const cfg = VIEWS[view] ?? VIEWS.picked_up

  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Parcel | null>(null)

  // Keyset pagination - this history can grow without bound over a rider's
  // whole career, unlike the actionable queue, so it loads a page at a time
  // instead of one capped, truncated fetch.
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')

  // Re-fetch on the specific status set — cfg identity is stable per view.
  const statusesKey = useMemo(() => cfg.statuses.join(','), [cfg])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await getRiderParcelsPage(cfg.statuses, { pageSize: PAGE_SIZE })
      setParcels(result.data)
      setCursor(result.nextCursor)
      setHasMore(result.hasNextPage)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const result = await getRiderParcelsPage(cfg.statuses, { cursor, pageSize: PAGE_SIZE })
      setParcels(prev => [...prev, ...result.data])
      setCursor(result.nextCursor)
      setHasMore(result.hasNextPage)
    } catch (e: any) {
      setLoadMoreError(e?.message ?? 'Failed to load more orders')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { load() }, [statusesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden">

      {/* Header — pen Body pad top 6, sides 20; header->list gap 18 */}
      <div className="flex flex-shrink-0 items-center gap-3 px-5 pt-1.5">
        <button
          onClick={() => navigate('/dashboard')}
          style={{ touchAction: 'manipulation' }}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors cursor-pointer hover:text-ink-2 active:bg-surface-2"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-[-0.4px] text-ink">{cfg.title}</h1>
          <p className="truncate text-[12.5px] text-ink-3">{cfg.subtitle}</p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          style={{ touchAction: 'manipulation' }}
          aria-label="Refresh"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors cursor-pointer hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <PullToRefresh onRefresh={load} className="flex-1 px-5">

        {error && (
          <div className="mt-4 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
            <AlertCircle size={15} className="shrink-0 text-red-bright" />
            <p className="flex-1 text-sm text-red-bright">{error}</p>
            <button onClick={load} className="cursor-pointer text-red-bright" aria-label="Retry">
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {loading && (
          <div className="mt-[18px] flex flex-col">
            {[1, 2, 3, 4].map(i => (
              <Fragment key={i}>
                {i > 1 && <div className="h-px bg-line" />}
                <div className="my-[13px] h-[52px] rounded-md bg-surface-2 opacity-60 animate-pulse" />
              </Fragment>
            ))}
          </div>
        )}

        {!loading && !error && parcels.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 px-8 pt-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
              <Package size={26} className="text-ink-3" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-base font-semibold text-ink">Nothing here yet</p>
              <p className="mt-1 text-sm text-ink-3">No {cfg.title.toLowerCase()} orders to show</p>
            </div>
          </div>
        )}

        {parcels.length > 0 && (
          <div className="pb-6 pt-[18px]">
            {parcels.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && <div className="h-px bg-line" />}
                <button
                  onClick={() => setSelected(p)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex w-full cursor-pointer items-center gap-2.5 py-[13px] text-left"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{p.trackingId}</span>
                      {!!p.codAmount && (
                        <span className="inline-flex shrink-0 items-center gap-[3px] rounded-full bg-olive-tint px-[6px] py-[2px]">
                          <Banknote size={9} className="text-olive" />
                          <span className="text-[9px] font-bold tracking-[0.4px] text-olive">COD</span>
                        </span>
                      )}
                    </div>
                    <span className="truncate text-[12.5px] text-ink-3">
                      {p.receiverName}{p.destination ? ` · ${p.destination}` : ''}
                    </span>
                  </div>
                  <StatusChip status={p.status} />
                  <ChevronRight size={16} className="shrink-0 text-ink-3" />
                </button>
              </Fragment>
            ))}

            {loadMoreError && (
              <div className="mt-3 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
                <AlertCircle size={15} className="shrink-0 text-red-bright" />
                <p className="flex-1 text-xs text-red-bright">{loadMoreError}</p>
              </div>
            )}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ touchAction: 'manipulation' }}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-surface py-3 text-[13px] font-semibold text-ink-2 transition-colors active:bg-surface-2 disabled:opacity-60"
              >
                {loadingMore
                  ? <Loader2 size={14} className="animate-spin" />
                  : null}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
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
