import { Fragment, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getSettlementDetail, type SettlementDetail } from '../lib/api'
import { toBsDate } from '../lib/nepaliDate'
import StatusChip, { type ChipTone } from './StatusChip'

interface Props {
  settlementId: string
  onClose: () => void
}

const fmt = (n: number) => n.toLocaleString()

// Romanized BS date, same treatment as the settlements page ("12 Shrawan 2082").
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

// Pen "Detail Sheet": white sheet r20 — SETTLEMENT label over a 16/700 ID,
// status chip beside a right-aligned 22/700 amount and BS date, then an
// ORDERS list of hairline-divided rows.
export default function SettlementDetailSheet({ settlementId, onClose }: Props) {
  const [detail, setDetail] = useState<SettlementDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getSettlementDetail(settlementId)
      .then((data) => { if (active) setDetail(data) })
      .catch((e: any) => { if (active) setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load detail') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [settlementId])

  const tone: ChipTone =
    detail?.status === 'settled' ? 'green'
    : detail?.status === 'cancelled' ? 'neutral'
    : 'olive'

  const statusLabel =
    detail?.status === 'settled' ? 'Settled'
    : detail?.status === 'cancelled' ? 'Cancelled'
    : 'Pending'

  return (
    <div
      className="absolute bottom-0 inset-x-0 z-10 flex max-h-[85%] flex-col rounded-t-[20px] bg-surface"
      style={{ boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)' }}
    >
      {/* Grabber */}
      <div className="shrink-0 pt-2.5">
        <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-start justify-between px-5 pt-3 pb-3.5">
        <div className="flex min-w-0 flex-col gap-[5px]">
          <p className="text-[9.5px] font-semibold tracking-[1.6px] text-ink-3">SETTLEMENT</p>
          <h2 className="truncate text-base font-bold leading-none text-ink">{detail?.statementId ?? 'Settlement'}</h2>
        </div>
        <button
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg text-ink-2 cursor-pointer hover:text-ink transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Status row */}
      {!loading && detail && (
        <>
          <div className="flex items-center justify-between px-5 pb-4">
            <StatusChip tone={tone} label={statusLabel} />
            <div className="flex flex-col items-end gap-[2px]">
              <span className="text-[22px] font-bold leading-none tabular-nums text-ink">
                Rs {fmt(detail.payableAmount)}
              </span>
              {detail.transferDate && (
                <span className="text-[10.5px] text-ink-3">{bsPretty(detail.transferDate)}</span>
              )}
            </div>
          </div>
          <div className="h-px shrink-0 bg-line" />
        </>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 pt-3.5 pb-[18px]">
        {loading && (
          <div className="flex flex-col">
            {[1, 2, 3, 4].map(i => (
              <Fragment key={i}>
                {i > 1 && <div className="h-px bg-line" />}
                <div className="my-[10px] h-10 rounded-md bg-surface-2 opacity-60 animate-pulse" />
              </Fragment>
            ))}
          </div>
        )}

        {!loading && error && (
          <p role="alert" className="pt-1 text-sm text-red-bright">{error}</p>
        )}

        {!loading && detail && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[9.5px] font-semibold tracking-[1.6px] text-ink-3">ORDERS</p>
              <p className="text-[10.5px] font-medium text-ink-3">{detail.items.length}</p>
            </div>

            {detail.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">No orders linked to this settlement.</p>
            ) : (
              <div className="mt-1 flex flex-col">
                {detail.items.map((item, i) => (
                  <Fragment key={item.trackingId}>
                    {i > 0 && <div className="h-px bg-line" />}
                    <div className="flex items-center justify-between py-[10px]">
                      <div className="flex min-w-0 flex-col gap-[2px]">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{item.trackingId}</span>
                        <span className="truncate text-xs text-ink-3">{item.receiverName}</span>
                      </div>
                      <span className="ml-3 shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                        Rs {fmt(item.settledAmount)}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
