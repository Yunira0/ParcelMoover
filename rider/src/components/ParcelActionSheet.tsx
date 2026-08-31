import { useRef, useState } from 'react'
import {
  X, Phone, MapPin, Navigation,
  Banknote, CheckCheck, Truck, XCircle, RefreshCw, RotateCcw,
} from 'lucide-react'
import type { Parcel, ParcelStatus } from '../lib/api'
import { updateParcelStatus, addParcelRemark, getCachedRider, RIDER_TRANSITIONS } from '../lib/api'
import Button from './Button'
import StatusChip from './StatusChip'

// Dials a number and logs the call as a parcel remark so the office sees it.
function callAndLog(orderId: string, phone: string, party: 'sender' | 'receiver') {
  const name = getCachedRider()?.fullName || 'Rider'
  // Best-effort log — never block or fail the actual call on it.
  addParcelRemark(orderId, `${name} called ${party} on ${phone}`).catch(() => {})
  window.location.href = `tel:${phone}`
}

// Opens Google Maps directions to an address in the native maps app / browser.
function openDirections(destination: string) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, '_blank', 'noopener')
}

// Searches the (free-text) address on Google Maps — Google geocodes the query,
// so a plain typed address works without stored coordinates.
function searchOnMaps(address: string) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener')
}

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered:    'Pickup Ordered',
  rider_assigned:    'Rider Assigned',
  picked_up:         'Picked Up',
  arrived:           'Arrived at Origin',
  ready_to_deliver:  'Ready to Deliver',
  sent_for_delivery: 'Out for Delivery',
  oov:               'Out of Vicinity',
  dispatched:        'Dispatched',
  arrived_at_branch: 'Arrived at Destination',
  hold:              'On Hold',
  loss_and_damage:   'Loss & Damage',
  delivered:         'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_pickup:     'Failed Pickup',
  failed_delivery:   'Failed Delivery',
  cancelled:         'Cancelled',
  follow_up:         'Follow Up',
  ready_to_return:   'Ready to Return',
  sent_to_vendor:    'Returning to Vendor',
  returned_to_vendor: 'Returned to Vendor',
}

const ACTION_META: Record<string, { label: string; icon: typeof CheckCheck; danger?: boolean; partial?: boolean; secondary?: boolean }> = {
  picked_up:           { label: 'Confirm Pickup',        icon: Truck },
  delivered:           { label: 'Mark as Delivered',     icon: CheckCheck },
  partially_delivered: { label: 'Partial delivery…',     icon: CheckCheck, partial: true },
  failed_pickup:       { label: 'Report Failed Pickup',  icon: XCircle, danger: true },
  failed_delivery:     { label: 'Report failed',         icon: XCircle, danger: true },
  // From failed_pickup this releases the parcel back into the pool for
  // dispatch to hand out again - a neutral action, not a danger one. It's
  // the alternative to the reclaim action below, still available to
  // whoever's actually assigned (assertRiderOwnsLeg) when they'd rather not
  // take the retry themselves. failed_delivery has no such release - it only
  // reclaims straight to sent_for_delivery below.
  pickup_ordered:      { label: 'Send Back to Dispatch', icon: RotateCcw, secondary: true },
  // Rider self-assign/reclaim: claims the parcel to the scanning rider (any
  // rider, not just whoever it was assigned to before) and advances it in one
  // step - from ready_to_deliver (unclaimed) or failed_delivery (reclaim) for
  // sent_for_delivery, from failed_pickup (reclaim) for rider_assigned. See
  // RIDER_TRANSITIONS in lib/api.ts.
  sent_for_delivery:   { label: 'Claim & Start Delivery', icon: Truck },
  rider_assigned:      { label: 'Claim & Start Pickup',   icon: Truck },
}

interface Props {
  parcel: Parcel
  onClose: () => void
  onDone: () => void
}

const fmt = (n: number) => n.toLocaleString()

// Pen "Action Sheet": white sheet r20; header carries tracking + chip + meta;
// hairline rules separate the Receiver and Sender blocks; COD strip; then a
// primary button, a Partial/Failed split row, and a footnote.
export default function ParcelActionSheet({ parcel, onClose, onDone }: Props) {
  const [remarksFor, setRemarksFor] = useState<ParcelStatus | null>(null)
  const [remarks,    setRemarks]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [done,       setDone]       = useState<ParcelStatus | null>(null)
  const [error,      setError]      = useState('')
  const [partialCodCollected, setPartialCodCollected] = useState('')
  // On an exchange delivery the rider must collect the customer's exchange
  // parcel to carry back to the vendor - so we gate "Delivered" behind a
  // confirmation that they actually received it.
  const [exchangePrompt, setExchangePrompt] = useState(false)

  const isExchange = parcel.orderType === 'exchange'

  const nextStatuses = RIDER_TRANSITIONS[parcel.status] ?? []

  // Partition transitions into the pen's action layout: one primary button,
  // a Partial/Failed split row, then any neutral releases.
  const primary     = nextStatuses.find(s => { const m = ACTION_META[s]; return m && !m.partial && !m.danger && !m.secondary })
  const partialKey  = nextStatuses.find(s => ACTION_META[s]?.partial)
  const dangers     = nextStatuses.filter(s => ACTION_META[s]?.danger)
  const secondaries = nextStatuses.filter(s => ACTION_META[s]?.secondary)
  const failedSelected  = !!remarksFor && !!ACTION_META[remarksFor]?.danger
  const partialSelected = remarksFor != null && remarksFor === partialKey

  const receiverAddr = parcel.receiverAddress || parcel.destination || ''
  const senderAddr   = parcel.senderAddress || parcel.origin || ''
  const metaLine = [
    isExchange ? 'Exchange' : 'Delivery',
    parcel.pieces != null ? `${parcel.pieces} pcs` : null,
    parcel.weightKg != null ? `${parcel.weightKg} kg` : null,
    parcel.codAmount ? `COD Rs ${fmt(parcel.codAmount)}` : null,
  ].filter(Boolean).join(' · ')

  // A re-tap after a timeout/network error is a retry of the same attempt,
  // not a new one — reuse its idempotency key so the backend can dedupe it,
  // instead of minting a fresh key that defeats the point of retrying safely.
  const idempotencyRef = useRef<{ status: ParcelStatus; key: string } | null>(null)
  function idempotencyKeyFor(status: ParcelStatus): string {
    if (idempotencyRef.current?.status !== status) {
      idempotencyRef.current = { status, key: crypto.randomUUID() }
    }
    return idempotencyRef.current.key
  }

  async function confirmAction(status: ParcelStatus, opts?: { exchangeReturnReceived?: boolean }) {
    setLoading(true)
    setError('')
    try {
      if (status === 'partially_delivered') {
        if (!remarks.trim()) { setError('Remarks are required for partial delivery.'); setLoading(false); return }
        const codValue = parseFloat(partialCodCollected)
        if (isNaN(codValue) || codValue < 0) { setError('COD collected must be non-negative.'); setLoading(false); return }
        if (parcel.codAmount && codValue > parcel.codAmount) {
          setError(`COD collected (${codValue}) cannot exceed parcel COD (${parcel.codAmount}).`)
          setLoading(false); return
        }
        await updateParcelStatus(parcel.id, status, remarks, codValue, idempotencyKeyFor(status))
      } else {
        if (ACTION_META[status]?.danger && !remarks.trim()) {
          setError('A reason remark is required to report a failure.'); setLoading(false); return
        }
        await updateParcelStatus(
          parcel.id,
          status,
          remarks || undefined,
          undefined,
          idempotencyKeyFor(status),
          opts?.exchangeReturnReceived,
        )
      }
      idempotencyRef.current = null
      setDone(status)
      navigator.vibrate?.(80)
      setTimeout(onDone, 2000)
    } catch (e: any) {
      setError(!navigator.onLine
        ? "You're offline — check your connection and try again."
        : e.message ?? 'Update failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // Delivering an exchange order first asks whether the rider received the
  // exchange parcel to bring back; every other action goes straight through.
  function handlePrimaryAction(status: ParcelStatus) {
    if (status === 'delivered' && isExchange) {
      setError('')
      setExchangePrompt(true)
      return
    }
    confirmAction(status)
  }

  const addrChips = (addr: string) => (
    <div className="mt-[3px] flex items-center gap-2">
      <button type="button" onClick={() => openDirections(addr)} style={{ touchAction: 'manipulation' }}
        className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-line-strong bg-bg px-[13px] text-[12.5px] font-medium text-ink cursor-pointer active:bg-surface-2 transition-colors">
        <Navigation size={12} /> Directions
      </button>
      <button type="button" onClick={() => searchOnMaps(addr)} style={{ touchAction: 'manipulation' }}
        className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-line-strong bg-bg px-[13px] text-[12.5px] font-medium text-ink cursor-pointer active:bg-surface-2 transition-colors">
        <MapPin size={12} /> Open map
      </button>
    </div>
  )

  return (
    <div
      className="absolute bottom-0 inset-x-0 flex max-h-[85%] flex-col rounded-t-[20px] bg-surface"
      style={{ boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)' }}
    >
      {/* Grabber */}
      <div className="shrink-0 pt-2.5"><div className="mx-auto h-1 w-9 rounded-full bg-line-strong" /></div>

      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 px-5 pt-3 pb-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-bold text-ink">{parcel.trackingId}</h2>
            <StatusChip status={parcel.status} />
          </div>
          <p className="text-[12.5px] text-ink-3">{metaLine}</p>
        </div>
        <button onClick={onClose} style={{ touchAction: 'manipulation' }} aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg text-ink-2 cursor-pointer transition-colors">
          <X size={15} />
        </button>
      </div>
      <div className="h-px shrink-0 bg-line" />

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-[18px]">

        {/* Receiver */}
        <div className="flex flex-col gap-[7px]">
          <p className="text-[9.5px] font-semibold tracking-[1.6px] text-ink-3">RECEIVER</p>
          <p className="text-[16.5px] font-semibold leading-tight tracking-[-0.2px] text-ink">{parcel.receiverName}</p>
          <button type="button" onClick={() => callAndLog(parcel.id, parcel.receiverPhone, 'receiver')}
            style={{ touchAction: 'manipulation' }}
            className="flex items-center gap-[7px] text-rust cursor-pointer active:opacity-70">
            <Phone size={13} /><span className="text-[13.5px] font-medium">{parcel.receiverPhone}</span>
          </button>
          {receiverAddr && (
            <>
              <p className="text-[13px] leading-[1.5] text-ink-2">{receiverAddr}</p>
              {addrChips(receiverAddr)}
            </>
          )}
        </div>

        {/* Pen: the rule touches the receiver block; the sender block carries
            its own 14px top padding. */}
        <div className="h-px bg-line" />

        {/* Sender */}
        <div className="mt-[14px] flex flex-col gap-1.5">
          <p className="text-[9.5px] font-semibold tracking-[1.6px] text-ink-3">SENDER</p>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-[14.5px] font-semibold text-ink">{parcel.senderName}</span>
            <button type="button" onClick={() => callAndLog(parcel.id, parcel.senderPhone, 'sender')}
              style={{ touchAction: 'manipulation' }}
              className="flex shrink-0 items-center gap-1.5 text-rust cursor-pointer active:opacity-70">
              <Phone size={12} /><span className="text-[12.5px] font-medium">{parcel.senderPhone}</span>
            </button>
          </div>
          {senderAddr && (
            <>
              <p className="text-[13px] leading-[1.5] text-ink-2">{senderAddr}</p>
              {addrChips(senderAddr)}
            </>
          )}
        </div>

        {/* COD strip */}
        {!!parcel.codAmount && (
          <div className="mt-3.5 flex items-center gap-2">
            <div className="flex items-center gap-[7px] rounded-[10px] bg-olive-tint px-[13px] py-[9px]">
              <Banknote size={15} className="shrink-0 text-olive" />
              <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-olive">COD Rs {fmt(parcel.codAmount)}</span>
            </div>
            <span className="min-w-0 text-[12.5px] text-ink-3">Collect on delivery</span>
          </div>
        )}

        {/* Success state */}
        {done && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-tint">
              <CheckCheck size={30} className="text-green" />
            </div>
            <p className="text-base font-bold text-ink">
              {ACTION_META[done]?.secondary ? 'Sent Back to Dispatch' : STATUS_LABELS[done]}
            </p>
            <p className="text-sm text-ink-3">
              {ACTION_META[done]?.secondary ? "It's off your list now — dispatch will hand it to another rider." : 'Status updated successfully'}
            </p>
          </div>
        )}

        {/* Error */}
        {error && !done && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
            <XCircle size={15} className="mt-0.5 shrink-0 text-red-bright" />
            <p className="text-sm leading-snug text-red-bright">{error}</p>
          </div>
        )}

        {/* Failure flow: reason required, then confirm */}
        {failedSelected && !done && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium text-ink-2">
              Remarks <span className="text-red-bright">*</span>
            </label>
            <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Reason for failure…"
              className="w-full resize-none rounded-[10px] border border-line-strong bg-surface px-4 py-3 text-sm font-medium text-ink placeholder:text-ink-3 outline-none focus:border-rust focus:ring-2 focus:ring-rust/25" />
            <Button variant="danger" loading={loading} disabled={!remarks.trim()}
              onClick={() => confirmAction(remarksFor!)}>
              Confirm — {ACTION_META[remarksFor!].label}
            </Button>
          </div>
        )}

        {/* Partial flow */}
        {partialSelected && !done && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-[7px]">
              <label className="text-sm font-medium text-ink-2">Remarks <span className="text-red-bright">*</span></label>
              <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder="Reason for partial delivery…"
                className="w-full resize-none rounded-[10px] border border-line-strong bg-surface px-4 py-3 text-sm font-medium text-ink placeholder:text-ink-3 outline-none focus:border-rust focus:ring-2 focus:ring-rust/25" />
            </div>
            <div className="flex flex-col gap-[7px]">
              <label className="text-sm font-medium text-ink-2">COD Collected <span className="text-red-bright">*</span></label>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={partialCodCollected}
                onChange={e => setPartialCodCollected(e.target.value)} placeholder="Amount collected"
                className="w-full h-[50px] rounded-[10px] border border-line-strong bg-surface px-[14px] font-mono text-sm font-medium text-ink outline-none focus:border-rust focus:ring-2 focus:ring-rust/25 placeholder:font-sans placeholder:text-ink-3" />
            </div>
            <button onClick={() => confirmAction('partially_delivered')} disabled={loading || !remarks.trim() || !partialCodCollected}
              style={{ touchAction: 'manipulation' }}
              className="flex h-[52px] items-center justify-center gap-2 rounded-[12px] bg-olive text-[15px] font-semibold text-white cursor-pointer active:bg-[#7d5500] disabled:opacity-40 transition-colors">
              {loading ? <RefreshCw size={18} className="animate-spin" /> : <><CheckCheck size={17} /> Confirm Partial Delivery</>}
            </button>
          </div>
        )}

        {/* Exchange gate */}
        {exchangePrompt && !done && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-[#C2410C38] bg-rust-tint px-4 py-4">
            <div className="flex items-start gap-2.5">
              <RefreshCw size={18} className="mt-0.5 shrink-0 text-rust" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-bold text-ink">Exchange delivery</p>
                <p className="text-xs leading-snug text-ink-2">
                  Did you receive the exchange parcel from the customer to return to the vendor?
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button loading={loading} onClick={() => confirmAction('delivered', { exchangeReturnReceived: true })}>
                <CheckCheck size={17} /> Yes, I received it
              </Button>
              <button onClick={() => {
                  setExchangePrompt(false)
                  setError('You must collect the exchange parcel from the customer before completing this delivery.')
                }} disabled={loading} style={{ touchAction: 'manipulation' }}
                className="flex h-[46px] items-center justify-center rounded-[12px] border border-line-strong bg-surface text-sm font-semibold text-ink-2 cursor-pointer active:bg-surface-2 disabled:opacity-40 transition-colors">
                No, not yet
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!done && !exchangePrompt && !failedSelected && !partialSelected &&
         (primary || partialKey || dangers.length > 0 || secondaries.length > 0) && (
          <div className="mt-4 flex flex-col gap-2.5">
            {primary && (() => {
              const Icon = ACTION_META[primary].icon
              return (
                <Button loading={loading} onClick={() => handlePrimaryAction(primary)}>
                  <Icon size={17} /> {ACTION_META[primary].label}
                </Button>
              )
            })()}

            {(partialKey || dangers.length > 0) && (
              <div className="flex gap-2.5">
                {partialKey && (
                  <button onClick={() => { setRemarksFor(partialKey); setError(''); setRemarks(''); setPartialCodCollected('') }}
                    style={{ touchAction: 'manipulation' }}
                    className="flex h-12 flex-1 items-center justify-center rounded-[12px] border border-line-strong bg-surface text-[13.5px] font-semibold text-ink-2 cursor-pointer active:bg-surface-2 transition-colors">
                    {ACTION_META[partialKey].label}
                  </button>
                )}
                {dangers[0] && (
                  <button onClick={() => { setRemarksFor(dangers[0]); setError(''); setRemarks('') }}
                    style={{ touchAction: 'manipulation' }}
                    className="flex h-12 flex-1 items-center justify-center rounded-[12px] border border-[#DC262645] bg-surface text-[13.5px] font-semibold text-red cursor-pointer active:bg-[#DC262614] transition-colors">
                    {ACTION_META[dangers[0]].label}
                  </button>
                )}
              </div>
            )}

            {dangers.slice(1).map(status => (
              <button key={status} onClick={() => { setRemarksFor(status); setError(''); setRemarks('') }}
                style={{ touchAction: 'manipulation' }}
                className="flex h-12 items-center justify-center rounded-[12px] border border-[#DC262645] bg-surface text-sm font-semibold text-red cursor-pointer active:bg-[#DC262614] transition-colors">
                {ACTION_META[status].label}
              </button>
            ))}

            {secondaries.map(status => {
              const Icon = ACTION_META[status].icon
              return (
                <button key={status}
                  disabled={loading}
                  onClick={() => confirmAction(status)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex h-12 items-center justify-center gap-2 rounded-[12px] border border-line-strong bg-surface text-sm font-semibold text-ink-2 cursor-pointer active:bg-surface-2 disabled:opacity-40 transition-colors">
                  <Icon size={16} /> {ACTION_META[status].label}
                </button>
              )
            })}

            <p className="pt-0.5 text-center text-[11px] text-ink-3">
              Remarks are required for partial and failed reports.
            </p>
          </div>
        )}

        {/* No rider action available */}
        {!done && nextStatuses.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm font-semibold text-ink-2">No actions available</p>
            <p className="text-xs leading-relaxed text-ink-3">
              This parcel is <span className="font-medium text-ink">{STATUS_LABELS[parcel.status]}</span>.
              No rider action is needed right now.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
