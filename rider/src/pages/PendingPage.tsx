import { Fragment, useEffect, useState } from 'react'
import {
  RefreshCw, AlertCircle, Banknote, ChevronRight, ChevronDown, Inbox, CalendarDays, Loader2,
} from 'lucide-react'
import { usePending } from '../context/PendingContext'
import ParcelActionSheet from '../components/ParcelActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import StatusChip from '../components/StatusChip'
import DateFilterSheet, { dateFilterLabel, type DateFilter } from '../components/DateFilterSheet'
import { getRiderParcelsPage, getRiderStatusCounts, type Parcel, type ParcelStatus } from '../lib/api'
import { toBsDate } from '../lib/nepaliDate'

const PAGE_SIZE = 20

// ── Lanes ──────────────────────────────────────────────────────────────────
// Three filters, each covering the whole lane: parcels still awaiting a rider
// action (from the live queue, PendingContext) plus the ones that lane has
// already completed (paginated below - a rider's lifetime history has no
// natural cap the way the live queue does).

type FilterKey = 'pickup' | 'delivery' | 'return'

interface FilterDef {
  key: FilterKey
  label: string
  statuses: ParcelStatus[]
}

const FILTERS: FilterDef[] = [
  {
    key: 'pickup',
    label: 'Pickup',
    statuses: ['rider_assigned', 'picked_up', 'failed_pickup'],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    statuses: ['sent_for_delivery', 'dispatched', 'delivered', 'partially_delivered', 'failed_delivery'],
  },
  {
    key: 'return',
    label: 'Return',
    statuses: ['sent_to_vendor', 'returned_to_vendor'],
  },
]

// The completed subset of each lane - i.e. its statuses minus whatever
// PendingContext already carries live (rider_assigned/picked_up/sent_for_delivery).
// This is what gets paginated; the live portion is small/bounded and comes
// straight from the queue context instead.
const LANE_COMPLETED_STATUSES: Record<FilterKey, ParcelStatus[]> = {
  pickup: ['failed_pickup'],
  delivery: ['delivered', 'partially_delivered', 'failed_delivery'],
  return: ['sent_to_vendor', 'returned_to_vendor'],
}

// ── Row — pen "Row / Parcel": bare row in a hairline-divided list ──────────

// Caption above each queue bucket - matches the dashboard's uppercase
// caption style (10px/500/1.4px tracking, ink-3).
function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 pb-2 pt-4 first:pt-0">
      <span className="text-[10px] font-semibold tracking-[1.4px] text-ink-3">{label}</span>
      <span className="text-[10px] font-medium tracking-[1.4px] text-ink-3/60">{count}</span>
    </div>
  )
}

function ParcelRow({ parcel, onTap }: { parcel: Parcel; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      style={{ touchAction: 'manipulation' }}
      className="flex w-full items-center gap-2.5 py-[13px] text-left cursor-pointer"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-ink">{parcel.trackingId}</span>
          {!!parcel.codAmount && (
            <span className="inline-flex shrink-0 items-center gap-[3px] rounded-full bg-olive-tint px-[6px] py-[2px]">
              <Banknote size={9} className="text-olive" />
              <span className="text-[9px] font-bold tracking-[0.4px] text-olive">COD</span>
            </span>
          )}
        </div>
        <span className="truncate text-[12.5px] text-ink-3">
          {parcel.receiverName}{parcel.destination ? ` · ${parcel.destination}` : ''}
        </span>
      </div>
      <StatusChip status={parcel.status} />
      <ChevronRight size={16} className="shrink-0 text-ink-3" />
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PendingPage() {
  const { parcels: queue, loading, error, truncated: queueTruncated, refresh } = usePending()
  const [activeFilter, setActiveFilter] = useState<FilterKey>('pickup')
  const [selected, setSelected] = useState<Parcel | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>({ kind: 'all' })
  const [dateFilterOpen, setDateFilterOpen] = useState(false)

  // Tab badge totals - fetched independently of whatever page of history has
  // actually loaded, so "Delivery 17" stays accurate even though only the
  // active lane's completed history is paginated in below.
  const [tabCounts, setTabCounts] = useState<Partial<Record<FilterKey, number>>>({})

  // Completed history for the active lane only - keyset-paginated, refetched
  // from page 1 whenever the lane tab changes.
  const [completedItems, setCompletedItems] = useState<Parcel[]>([])
  const [completedLoading, setCompletedLoading] = useState(true)
  const [completedError, setCompletedError] = useState('')
  const [completedCursor, setCompletedCursor] = useState<string | null>(null)
  const [completedHasMore, setCompletedHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')

  async function loadTabCounts() {
    try {
      const groups = Object.fromEntries(FILTERS.map(f => [f.key, f.statuses])) as Record<FilterKey, ParcelStatus[]>
      setTabCounts(await getRiderStatusCounts(groups))
    } catch {
      // Non-fatal: tab badges just stay blank until the next refresh.
    }
  }

  async function loadCompletedFirstPage() {
    setCompletedLoading(true)
    setCompletedError('')
    try {
      const result = await getRiderParcelsPage(LANE_COMPLETED_STATUSES[activeFilter], { pageSize: PAGE_SIZE })
      setCompletedItems(result.data)
      setCompletedCursor(result.nextCursor)
      setCompletedHasMore(result.hasNextPage)
    } catch (e: any) {
      setCompletedError(e?.message ?? 'Failed to load history')
    } finally {
      setCompletedLoading(false)
    }
  }

  async function loadMoreCompleted() {
    if (!completedCursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const result = await getRiderParcelsPage(LANE_COMPLETED_STATUSES[activeFilter], {
        cursor: completedCursor,
        pageSize: PAGE_SIZE,
      })
      setCompletedItems(prev => [...prev, ...result.data])
      setCompletedCursor(result.nextCursor)
      setCompletedHasMore(result.hasNextPage)
    } catch (e: any) {
      setLoadMoreError(e?.message ?? 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  async function refreshAll() {
    await Promise.all([refresh(), loadCompletedFirstPage(), loadTabCounts()])
  }

  // Re-page from the top whenever the active lane changes - a cursor from one
  // lane's completed-status set means nothing against another's.
  useEffect(() => { loadCompletedFirstPage() }, [activeFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTabCounts() }, [])

  const handleDone = () => { setSelected(null); refreshAll() }

  const active = FILTERS.find(f => f.key === activeFilter)!

  // Live (still-actionable) items for this lane, plus however much completed
  // history has been paginated in so far - de-duped by id (a status can
  // appear in both sources briefly after an update), sorted newest-first.
  const laneQueue = queue.filter(p => (active.statuses as string[]).includes(p.status))
  const seen = new Set<string>()
  const all: Parcel[] = [...laneQueue, ...completedItems]
    .filter(p => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  // "Today" throughout is lastUpdatedAt (when the parcel entered its current
  // status), not createdAt (the order's original booking date) - an old order
  // still sitting in this lane should read as backlog, not as today, even if
  // it was booked long ago.
  const todayBs = toBsDate(new Date())
  const yesterdayBs = toBsDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const last7Bs = new Set(
    Array.from({ length: 7 }, (_, i) => toBsDate(new Date(Date.now() - i * 24 * 60 * 60 * 1000))),
  )

  function matchesDateFilter(p: Parcel): boolean {
    const day = toBsDate(p.lastUpdatedAt)
    switch (dateFilter.kind) {
      case 'all': return true
      case 'today': return day === todayBs
      case 'yesterday': return day === yesterdayBs
      case 'week': return last7Bs.has(day)
      case 'custom': return day === toBsDate(dateFilter.date)
    }
  }

  const filteredParcels = all.filter(matchesDateFilter)
  // A preset that already names exactly one day (today/yesterday/custom)
  // makes the Today/Other split redundant - the filter chip above the list
  // already says which day this is. "all" and "week" can still span several
  // days, so those two keep the split.
  const isSingleDayFilter = dateFilter.kind === 'today' || dateFilter.kind === 'yesterday' || dateFilter.kind === 'custom'
  const todayParcels = isSingleDayFilter ? [] : filteredParcels.filter(p => toBsDate(p.lastUpdatedAt) === todayBs)
  const otherParcels = isSingleDayFilter ? filteredParcels : filteredParcels.filter(p => toBsDate(p.lastUpdatedAt) !== todayBs)

  const listLoading = loading || completedLoading

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-hidden">

      {/* ── Sticky header + tabs ── */}
      <div className="flex-shrink-0 bg-bg">
        {/* Pen Body pad top 6; header items centered on the 40px refresh */}
        <div className="flex items-center justify-between px-5 pt-1.5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-[9px]">
              <h1 className="text-[27px] font-bold leading-none tracking-[-0.5px] text-ink">Queue</h1>
              {queue.length > 0 && (
                <span className="rounded-full bg-rust-tint px-2 py-[3px] text-xs font-semibold text-rust">
                  {queue.length}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={refreshAll}
            disabled={loading}
            style={{ touchAction: 'manipulation' }}
            aria-label="Refresh"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors cursor-pointer hover:text-ink disabled:opacity-40"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Underline tabs — pen "Tabs": bottom-only hairline rail across the
            content width, active bar in ink hugging the label, no icons. */}
        <div className="mx-5 mt-5 border-b border-line">
          <div className="flex gap-6">
            {FILTERS.map(f => {
              const on = activeFilter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  style={{ touchAction: 'manipulation' }}
                  aria-current={on ? 'true' : undefined}
                  className="flex h-10 cursor-pointer flex-col justify-start gap-[7px] px-0.5"
                >
                  <span className="flex items-end gap-1.5">
                    <span className={`text-[14.5px] leading-none ${on ? 'font-semibold text-ink' : 'font-medium text-ink-3'}`}>
                      {f.label}
                    </span>
                    <span className={`text-[11px] font-medium leading-none ${on ? 'text-rust' : 'text-ink-3'}`}>
                      {tabCounts[f.key] ?? ''}
                    </span>
                  </span>
                  <span className={`h-0.5 self-stretch ${on ? 'bg-ink' : 'bg-transparent'}`} />
                </button>
              )
            })}
          </div>
        </div>

        {/* Date filter trigger - opens DateFilterSheet. Shown as a pill so the
            active scope (All time / Today / a picked date) is always visible
            without opening the sheet. */}
        <div className="mx-5 mt-3 flex justify-end">
          <button
            onClick={() => setDateFilterOpen(true)}
            style={{ touchAction: 'manipulation' }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[12px] font-semibold transition-colors cursor-pointer
              ${dateFilter.kind === 'all'
                ? 'border-line-strong bg-surface text-ink-2'
                : 'border-rust/30 bg-rust-tint text-rust'}`}
          >
            <CalendarDays size={13} strokeWidth={2.2} />
            {dateFilterLabel(dateFilter)}
            <ChevronDown size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── Scrollable list ── */}
      <PullToRefresh onRefresh={refreshAll} className="flex-1 px-5">

        {(error || completedError) && (
          <div className="mt-4 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
            <AlertCircle size={15} className="shrink-0 text-red-bright" />
            <p className="flex-1 text-sm text-red-bright">{error || completedError}</p>
            <button onClick={refreshAll} className="cursor-pointer text-red-bright" aria-label="Retry">
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {!error && !completedError && queueTruncated && (
          <div className="mt-4 flex items-start gap-3 rounded-sm border border-[#9A6A0038] bg-olive-tint px-3.5 py-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-olive" />
            <p className="flex-1 text-xs leading-snug text-olive">
              You have a large number of active orders — some may not be shown below. Contact your hub manager if a parcel is missing.
            </p>
          </div>
        )}

        {listLoading && all.length === 0 && (
          <div className="mt-2 flex flex-col">
            {[1, 2, 3, 4, 5].map(i => (
              <Fragment key={i}>
                {i > 1 && <div className="h-px bg-line" />}
                <div className="my-[13px] h-[52px] rounded-md bg-surface-2 opacity-60 animate-pulse" />
              </Fragment>
            ))}
          </div>
        )}

        {!listLoading && !error && !completedError && filteredParcels.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 pt-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
              <Inbox size={26} className="text-ink-3" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-ink-2">
              No <span className="font-semibold">{active.label.toLowerCase()}</span> orders
              {dateFilter.kind === 'all' ? ' right now' : <> for <span className="font-semibold">{dateFilterLabel(dateFilter).toLowerCase()}</span></>}
            </p>
            {completedHasMore && (
              <p className="text-xs text-ink-3">More history is available below.</p>
            )}
          </div>
        )}

        {!listLoading && (filteredParcels.length > 0 || loadMoreError || completedHasMore) && (
          <div className="pb-6">
            {todayParcels.length > 0 && (
              <>
                {!isSingleDayFilter && <SectionLabel label="TODAY" count={todayParcels.length} />}
                {todayParcels.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 && <div className="h-px bg-line" />}
                    <ParcelRow parcel={p} onTap={() => setSelected(p)} />
                  </Fragment>
                ))}
              </>
            )}
            {otherParcels.length > 0 && (
              <>
                {!isSingleDayFilter && <SectionLabel label="OTHER" count={otherParcels.length} />}
                {otherParcels.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 && <div className="h-px bg-line" />}
                    <ParcelRow parcel={p} onTap={() => setSelected(p)} />
                  </Fragment>
                ))}
              </>
            )}

            {loadMoreError && (
              <div className="mt-3 flex items-center gap-3 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
                <AlertCircle size={15} className="shrink-0 text-red-bright" />
                <p className="flex-1 text-xs text-red-bright">{loadMoreError}</p>
              </div>
            )}
            {completedHasMore && (
              <button
                onClick={loadMoreCompleted}
                disabled={loadingMore}
                style={{ touchAction: 'manipulation' }}
                className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-surface py-3 text-[13px] font-semibold text-ink-2 transition-colors active:bg-surface-2 disabled:opacity-60 ${filteredParcels.length > 0 ? 'mt-3' : ''}`}
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
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

      {/* Date filter sheet */}
      {dateFilterOpen && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDateFilterOpen(false)} />
          <DateFilterSheet
            value={dateFilter}
            onChange={setDateFilter}
            onClose={() => setDateFilterOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
