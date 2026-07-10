import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Banknote, CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import {
  getMyPendingCod, getMySettlements,
  type PendingCodResult, type SettlementStatement,
} from '../lib/api'
import SettlementDetailSheet from '../components/SettlementDetailSheet'

export default function SettlementsPage() {
  const [pending, setPending] = useState<PendingCodResult | null>(null)
  const [settlements, setSettlements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [pendingResult, settlementsResult] = await Promise.all([
        getMyPendingCod(),
        getMySettlements(1, 20),
      ])
      setPending(pendingResult)
      setSettlements(settlementsResult.data)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load settlements')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">
      <div className="flex items-center justify-between px-5 pt-6 pb-2">
        <div>
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">COD</p>
          <h1 className="text-xl font-bold text-text-primary mt-0.5">Settlements</h1>
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

      {error && (
        <div className="mx-5 mt-4 flex items-center gap-3 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
          <AlertCircle size={16} className="text-error shrink-0" />
          <p className="text-sm text-error flex-1">{error}</p>
          <button onClick={load} className="text-error cursor-pointer" aria-label="Retry">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {loading && (
        <div className="px-5 mt-4 flex flex-col gap-4">
          <div className="h-32 rounded-2xl bg-surface-2 animate-pulse" />
          <div className="h-40 rounded-2xl bg-surface-2 animate-pulse" />
        </div>
      )}

      {!loading && pending && (
        <>
          {/* Amount owed to office */}
          <div className="px-5 mt-4">
            <div className="bg-surface rounded-2xl border border-border p-4 flex flex-col gap-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Owed to Office</p>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold text-text-muted">Rs</span>
                <span className="text-4xl font-bold text-text-primary tabular-nums leading-none">
                  {pending.totalNetPayable > 0 ? pending.totalNetPayable.toLocaleString() : '0'}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center gap-1.5">
                <Banknote size={13} className="text-yellow-400 shrink-0" />
                <span className="text-sm font-semibold text-text-primary tabular-nums">
                  {pending.items.length}
                </span>
                <span className="text-xs text-text-muted">order{pending.items.length === 1 ? '' : 's'} not yet remitted</span>
              </div>
            </div>
          </div>

          {/* Pending orders list */}
          {pending.items.length > 0 && (
            <div className="px-5 mt-5">
              <p className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">Not Yet Remitted</p>
              <div className="flex flex-col gap-2">
                {pending.items.map((item) => (
                  <div
                    key={item.codCollectionId}
                    className="flex items-center justify-between bg-surface-2 rounded-2xl border border-border px-4 py-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-bold text-text-primary font-mono truncate">{item.trackingId}</span>
                      <span className="text-xs text-text-muted truncate">{item.receiverName}</span>
                    </div>
                    <span className="text-sm font-bold text-text-primary tabular-nums shrink-0">
                      Rs {item.netPayable.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settlement history */}
          <div className="px-5 mt-6 mb-6">
            <p className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">History</p>
            {settlements.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Clock size={22} className="text-text-muted" strokeWidth={1.5} />
                <p className="text-sm text-text-muted">No settlements recorded yet</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {settlements.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    style={{ touchAction: 'manipulation' }}
                    className="w-full flex items-center justify-between bg-surface-2 rounded-2xl border border-border px-4 py-3 cursor-pointer active:opacity-70 transition-opacity text-left"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-bold text-text-primary font-mono truncate">{s.statementId}</span>
                      <span className="text-xs text-text-muted truncate">
                        {s.orderCount} order{s.orderCount === 1 ? '' : 's'}
                        {s.transferDate ? ` · ${s.transferDate}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-text-primary tabular-nums">
                        Rs {s.amount.toLocaleString()}
                      </span>
                      {s.status === 'settled' ? (
                        <CheckCircle2 size={16} className="text-success" />
                      ) : (
                        <Clock size={16} className="text-yellow-400" />
                      )}
                      <ChevronRight size={14} className="text-text-muted" />
                    </div>
                  </button>
                ))}
              </div>
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
    </div>
  )
}
