import { Fragment, useEffect, useState } from 'react'
import {
  RefreshCw, AlertCircle, Banknote, CircleCheckBig,
  Timer, ArrowUpRight, Ban, PackageOpen, Loader2, ChevronRight,
} from 'lucide-react'
import {
  getMyPendingCod, getMySettlements, getParcelByTrackingId,
  type PendingCodResult, type SettlementStatement, type Parcel,
} from '../lib/api'
import SettlementDetailSheet from '../components/SettlementDetailSheet'
import ParcelActionSheet from '../components/ParcelActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import { toBsDate } from '../lib/nepaliDate'

const PAGE_SIZE = 20

const fmt = (n: number) => n.toLocaleString()

// Pen shows BS dates romanized: "12 Shrawan 2082".
const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Ashar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]

function bsPretty(value?: string | null): string {
  const bs = toBsDate(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bs)) return bs || ''
  const [y, m, d] = bs.split('-').map(Number)
  return `${d} ${BS_MONTHS_EN[m - 1] ?? ''} ${y}`
}

// Pen "Screen / Settlements": COD LEDGER caption (ls 1.4), OWED TO OFFICE card
// with uniform gap-10 rhythm and a 46/700 amount, then section heads with
// bottom-aligned right-side counts over bare hairline-divided lists.
export default function SettlementsPage() {
  const [pending, setPending] = useState<PendingCodResult | null>(null)
  const [settlements, setSettlements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // "To hand over" rows only carry a settlement-summary shape (PendingCodOrder) -
  // tapping one fetches the full Parcel by tracking id so ParcelActionSheet (the
  // same detail view used everywhere else in the app) can render it.
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null)
  const [loadingTrackingId, setLoadingTrackingId] = useState<string | null>(null)
  const [parcelError, setParcelError] = useState('')

  async function openParcel(trackingId: string) {
    setLoadingTrackingId(trackingId)
    setParcelError('')
    try {
      setSelectedParcel(await getParcelByTrackingId(trackingId))
    } catch (e: any) {
      setParcelError(e?.response?.data?.message ?? e?.message ?? 'Failed to load parcel')
    } finally {
      setLoadingTrackingId(null)
    }
  }

  // Statement history paginates - a rider settled for months/years would
  // otherwise never be able to see anything before their most recent 20.
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [pendingResult, settlementsResult] = await Promise.all([
        getMyPendingCod(),
        getMySettlements(1, PAGE_SIZE),
      ])
      setPending(pendingResult)
      setSettlements(settlementsResult.data)
      setHistoryPage(1)
      setHistoryTotalPages(settlementsResult.meta.totalPages)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load settlements')
    } finally {
      setLoading(false)
    }
  }

  async function loadMoreHistory() {
    if (loadingMore || historyPage >= historyTotalPages) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const nextPage = historyPage + 1
      const result = await getMySettlements(nextPage, PAGE_SIZE)
      setSettlements(prev => [...prev, ...result.data])
      setHistoryPage(nextPage)
      setHistoryTotalPages(result.meta.totalPages)
    } catch (e: any) {
      setLoadMoreError(e?.response?.data?.message ?? e?.message ?? 'Failed to load more settlements')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <PullToRefresh onRefresh={load} className="flex flex-col flex-1 bg-bg">

      {/* Header — pen Body pad top 6; caption fs10/500 ls1.4, title 27/700 ls-0.5 */}
      <div className="flex items-center justify-between px-5 pt-1.5">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium tracking-[1.4px] text-ink-3">COD LEDGER</p>
          <h1 className="text-[27px] font-bold leading-none tracking-[-0.5px] text-ink">Settlements</h1>
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

      {error && (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
          <AlertCircle size={15} className="shrink-0 text-red-bright" />
          <p className="flex-1 text-sm text-red-bright">{error}</p>
          <button onClick={load} className="cursor-pointer text-red-bright" aria-label="Retry">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {parcelError && (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
          <AlertCircle size={15} className="shrink-0 text-red-bright" />
          <p className="flex-1 text-sm text-red-bright">{parcelError}</p>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex flex-col gap-[22px] px-5 pb-6">
          <div className="h-[170px] rounded-[14px] bg-surface-2 animate-pulse" />
          <div className="h-[180px] rounded-[14px] bg-surface-2 animate-pulse" />
        </div>
      )}

      {!loading && pending && (
        <>
          {/* Owed card — white r14, 1px #E7E7E3 border, uniform gap 10 */}
          <div className="mx-5 mt-[22px] rounded-[14px] border border-line bg-surface px-[18px] pt-[18px] pb-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-[1.8px] text-rust">OWED TO OFFICE</span>
              <ArrowUpRight size={15} className="text-ink-3" />
            </div>
            <div className="mt-2.5 flex items-end gap-[7px]">
              <span className="text-[15px] font-semibold text-ink-2">Rs</span>
              <span className="text-[46px] font-bold leading-none tracking-[-1.4px] tabular-nums text-ink">
                {fmt(pending.totalNetPayable)}
              </span>
            </div>
            <div className="my-[10px] h-px bg-line" />
            <div className="flex items-center gap-1.5">
              <Banknote size={13} className="shrink-0 text-olive" />
              <span className="text-xs font-medium text-ink-2">
                {pending.items.length} order{pending.items.length === 1 ? '' : 's'} to hand over
              </span>
            </div>
          </div>

          {/* Not yet handed over */}
          {pending.items.length > 0 && (
            <div className="mx-5 mt-[22px]">
              <div className="flex items-end justify-between">
                <p className="text-[14.5px] font-semibold text-ink">To hand over</p>
                <p className="text-[10px] font-medium uppercase tracking-[1px] text-ink-3">
                  {pending.items.length} orders
                </p>
              </div>
              <div className="mt-[6px] flex flex-col">
                {pending.items.map((item, i) => (
                  <Fragment key={item.codCollectionId}>
                    {i > 0 && <div className="h-px bg-line" />}
                    <button
                      onClick={() => openParcel(item.trackingId)}
                      disabled={loadingTrackingId === item.trackingId}
                      style={{ touchAction: 'manipulation' }}
                      className="flex w-full cursor-pointer items-center justify-between gap-2.5 py-[11px] text-left disabled:opacity-60"
                    >
                      <div className="flex min-w-0 flex-col gap-[2px]">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{item.trackingId}</span>
                        <span className="truncate text-[12.5px] text-ink-3">{item.receiverName}</span>
                      </div>
                      <span className="ml-3 flex shrink-0 items-center gap-2">
                        <span className="text-[13.5px] font-semibold tabular-nums text-ink">
                          Rs {fmt(item.netPayable)}
                        </span>
                        {loadingTrackingId === item.trackingId
                          ? <Loader2 size={14} className="shrink-0 animate-spin text-ink-3" />
                          : <ChevronRight size={15} className="shrink-0 text-ink-3" />}
                      </span>
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          <div className="mx-5 mt-[22px] mb-6">
            <div className="flex items-end justify-between">
              <p className="text-[14.5px] font-semibold text-ink">History</p>
              <p className="text-[10px] font-medium uppercase tracking-[1px] text-ink-3">{settlements.length} shown</p>
            </div>

            {settlements.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <PackageOpen size={22} className="text-ink-3" strokeWidth={1.5} />
                <p className="text-sm text-ink-3">No settlements recorded yet</p>
              </div>
            ) : (
              <div className="mt-[6px] flex flex-col">
                {settlements.map((s, i) => (
                  <Fragment key={s.id}>
                    {i > 0 && <div className="h-px bg-line" />}
                    <button
                      onClick={() => setSelectedId(s.id)}
                      style={{ touchAction: 'manipulation' }}
                      className="flex w-full cursor-pointer items-center gap-3 py-[11px] text-left"
                    >
                      {s.status === 'settled'
                        ? <CircleCheckBig size={16} className="shrink-0 text-green" />
                        : s.status === 'cancelled'
                          ? <Ban size={16} className="shrink-0 text-ink-3" />
                          : <Timer size={16} className="shrink-0 text-olive" />}
                      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{s.statementId}</span>
                        <span className="truncate text-xs text-ink-3">
                          {s.orderCount} order{s.orderCount === 1 ? '' : 's'}
                          {s.transferDate ? ` · ${bsPretty(s.transferDate)}` : ''}
                        </span>
                      </div>
                      <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-ink">
                        Rs {fmt(s.amount)}
                      </span>
                    </button>
                  </Fragment>
                ))}
              </div>
            )}

            {loadMoreError && (
              <div className="mt-3 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
                <AlertCircle size={15} className="shrink-0 text-red-bright" />
                <p className="flex-1 text-xs text-red-bright">{loadMoreError}</p>
              </div>
            )}

            {historyPage < historyTotalPages && (
              <button
                onClick={loadMoreHistory}
                disabled={loadingMore}
                style={{ touchAction: 'manipulation' }}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-surface py-3 text-[13px] font-semibold text-ink-2 transition-colors active:bg-surface-2 disabled:opacity-60"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}

      {selectedId && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedId(null)} />
          <SettlementDetailSheet settlementId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}

      {selectedParcel && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedParcel(null)} />
          <ParcelActionSheet
            parcel={selectedParcel}
            onClose={() => setSelectedParcel(null)}
            onDone={() => setSelectedParcel(null)}
          />
        </div>
      )}
    </PullToRefresh>
  )
}
