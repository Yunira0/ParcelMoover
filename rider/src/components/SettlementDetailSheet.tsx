import { useEffect, useState } from 'react'
import { X, CheckCircle2, Clock } from 'lucide-react'
import { getSettlementDetail, type SettlementDetail } from '../lib/api'
import { toBsDate } from '../lib/nepaliDate'

interface Props {
  settlementId: string
  onClose: () => void
}

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

  return (
    <div
      className="absolute bottom-0 inset-x-0 bg-surface rounded-t-3xl border-t border-border flex flex-col"
      style={{ boxShadow: '0 -12px 48px rgba(0,0,0,0.7)', animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)', maxHeight: '85%' }}
    >
      <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 shrink-0" />

      <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
        <h2 className="text-base font-bold text-text-primary font-mono">{detail?.statementId ?? 'Settlement'}</h2>
        <button
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-surface-2 text-text-muted hover:text-text-primary cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {loading && (
          <div className="flex flex-col gap-2 pt-4">
            {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl bg-surface-2 animate-pulse" />)}
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-error pt-4">{error}</p>
        )}

        {!loading && detail && (
          <>
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="flex items-center gap-1.5">
                {detail.status === 'settled'
                  ? <CheckCircle2 size={15} className="text-success" />
                  : <Clock size={15} className="text-yellow-400" />}
                <span className="text-sm font-semibold text-text-primary">
                  {detail.status === 'settled' ? 'Settled' : 'Pending'}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-lg font-bold text-text-primary tabular-nums">Rs {detail.payableAmount.toLocaleString()}</span>
                {detail.transferDate && <span className="text-xs text-text-muted">{toBsDate(detail.transferDate)}</span>}
              </div>
            </div>

            <p className="text-xs font-semibold text-text-muted mt-4 mb-2 uppercase tracking-wider">
              Orders ({detail.items.length})
            </p>

            {detail.items.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center">No orders linked to this settlement.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.items.map(item => (
                  <div key={item.trackingId} className="flex items-center justify-between bg-surface-2 rounded-2xl border border-border px-4 py-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-bold text-text-primary font-mono truncate">{item.trackingId}</span>
                      <span className="text-xs text-text-muted truncate">{item.receiverName}</span>
                    </div>
                    <span className="text-sm font-bold text-text-primary tabular-nums shrink-0">
                      Rs {item.settledAmount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
