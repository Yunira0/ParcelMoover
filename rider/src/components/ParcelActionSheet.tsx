import { useState } from 'react'
import {
  X, Package, User, Phone, MapPin, Weight,
  Banknote, CheckCheck, Truck, Building2, XCircle, RefreshCw, ChevronRight,
} from 'lucide-react'
import type { Parcel, ParcelStatus } from '../lib/api'
import { updateParcelStatus, RIDER_TRANSITIONS } from '../lib/api'

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
}

const ACTION_META: Record<string, { label: string; icon: typeof CheckCheck; danger?: boolean; partial?: boolean }> = {
  picked_up:         { label: 'Confirm Pickup',          icon: Truck      },
  arrived:           { label: 'Mark Arrived at Origin',  icon: Building2  },
  arrived_at_branch: { label: 'Arrived at Destination',  icon: Building2  },
  delivered:         { label: 'Mark as Delivered',       icon: CheckCheck },
  partially_delivered: { label: 'Mark Partial Delivery', icon: CheckCheck, partial: true },
  failed_pickup:     { label: 'Report Failed Pickup',    icon: XCircle,   danger: true },
  failed_delivery:   { label: 'Report Failed Delivery',  icon: XCircle,   danger: true },
}

const STATUS_PILL: Record<string, string> = {
  delivered:         'text-success bg-success/10',
  partially_delivered: 'text-yellow-400 bg-yellow-400/10',
  picked_up:         'text-brand bg-brand-dim',
  arrived:           'text-blue-400 bg-blue-400/10',
  arrived_at_branch: 'text-blue-400 bg-blue-400/10',
  sent_for_delivery: 'text-brand bg-brand-dim',
  rider_assigned:    'text-yellow-400 bg-yellow-400/10',
  failed_pickup:     'text-error bg-error/10',
  failed_delivery:   'text-error bg-error/10',
  cancelled:         'text-error bg-error/10',
}

interface Props {
  parcel: Parcel
  onClose: () => void
  onDone: () => void
}

export default function ParcelActionSheet({ parcel, onClose, onDone }: Props) {
  const [remarksFor, setRemarksFor] = useState<ParcelStatus | null>(null)
  const [remarks,    setRemarks]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [done,       setDone]       = useState<ParcelStatus | null>(null)
  const [error,      setError]      = useState('')
  const [partialCodCollected, setPartialCodCollected] = useState('')

  const nextStatuses = RIDER_TRANSITIONS[parcel.status] ?? []
  const pillClass    = STATUS_PILL[parcel.status] ?? 'text-text-secondary bg-surface-2'

  async function confirmAction(status: ParcelStatus) {
    setLoading(true)
    setError('')
    try {
      if (status === 'partially_delivered') {
        if (!remarks.trim()) {
          setError('Remarks are required for partial delivery.')
          setLoading(false)
          return
        }
        const codValue = parseFloat(partialCodCollected)
        if (isNaN(codValue) || codValue < 0) {
          setError('COD collected must be non-negative.')
          setLoading(false)
          return
        }
        if (parcel.codAmount && codValue > parcel.codAmount) {
          setError(`COD collected (${codValue}) cannot exceed parcel COD (${parcel.codAmount}).`)
          setLoading(false)
          return
        }
        await updateParcelStatus(parcel.id, status, remarks, codValue)
      } else {
        await updateParcelStatus(parcel.id, status, remarks || undefined)
      }
      setDone(status)
      navigator.vibrate?.(80)
      setTimeout(onDone, 2000)
    } catch (e: any) {
      setError(e.message ?? 'Update failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="absolute bottom-0 inset-x-0 bg-surface rounded-t-3xl border-t border-border flex flex-col"
      style={{ boxShadow: '0 -12px 48px rgba(0,0,0,0.7)', animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)', maxHeight: '85%' }}
    >
      {/* Handle */}
      <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
        <h2 className="text-base font-bold text-text-primary">Parcel Details</h2>
        <button
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-surface-2 text-text-muted hover:text-text-primary cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto flex-1 px-5 pb-8 flex flex-col gap-4">

        {/* Tracking ID + status */}
        <div className="flex items-center justify-between gap-3 bg-surface-2 rounded-2xl px-4 py-3 border border-border">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold tracking-widest text-text-muted uppercase">Tracking ID</span>
            <span className="text-sm font-bold text-text-primary font-mono">{parcel.trackingId}</span>
          </div>
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full shrink-0 ${pillClass}`}>
            {STATUS_LABELS[parcel.status] ?? parcel.status}
          </span>
        </div>

        {/* Sender */}
        <div className="bg-surface-2 rounded-2xl px-4 py-3 border border-border flex flex-col gap-2">
          <span className="text-[10px] font-bold tracking-widest text-text-muted uppercase">Sender</span>
          <div className="flex items-center gap-2">
            <User size={13} className="text-text-muted shrink-0" />
            <span className="text-sm font-semibold text-text-primary">{parcel.senderName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone size={13} className="text-text-muted shrink-0" />
            <span className="text-sm text-text-secondary">{parcel.senderPhone}</span>
          </div>
          {parcel.origin && (
            <div className="flex items-start gap-2">
              <MapPin size={13} className="text-text-muted shrink-0 mt-0.5" />
              <span className="text-xs text-text-muted leading-snug">{parcel.origin}</span>
            </div>
          )}
        </div>

        {/* Receiver */}
        <div className="bg-surface-2 rounded-2xl px-4 py-3 border border-border flex flex-col gap-2">
          <span className="text-[10px] font-bold tracking-widest text-text-muted uppercase">Receiver</span>
          <div className="flex items-center gap-2">
            <User size={13} className="text-text-muted shrink-0" />
            <span className="text-sm font-semibold text-text-primary">{parcel.receiverName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone size={13} className="text-text-muted shrink-0" />
            <span className="text-sm text-text-secondary">{parcel.receiverPhone}</span>
          </div>
          {parcel.destination && (
            <div className="flex items-start gap-2">
              <MapPin size={13} className="text-text-muted shrink-0 mt-0.5" />
              <span className="text-xs text-text-muted leading-snug">{parcel.destination}</span>
            </div>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex gap-2 flex-wrap">
          {parcel.pieces != null && (
            <div className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-xl px-3 py-2">
              <Package size={12} className="text-text-muted" />
              <span className="text-xs font-semibold text-text-secondary">{parcel.pieces} pcs</span>
            </div>
          )}
          {parcel.weightKg != null && (
            <div className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-xl px-3 py-2">
              <Weight size={12} className="text-text-muted" />
              <span className="text-xs font-semibold text-text-secondary">{parcel.weightKg} kg</span>
            </div>
          )}
          {!!parcel.codAmount && (
            <div className="flex items-center gap-1.5 bg-brand-dim border border-brand/20 rounded-xl px-3 py-2">
              <Banknote size={12} className="text-brand" />
              <span className="text-xs font-semibold text-brand">COD Rs {parcel.codAmount}</span>
            </div>
          )}
        </div>

        {/* Success state */}
        {done && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCheck size={32} className="text-success" />
            </div>
            <p className="text-base font-bold text-text-primary">{STATUS_LABELS[done]}</p>
            <p className="text-sm text-text-muted">Status updated successfully</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-error/10 border border-error/30 rounded-2xl px-4 py-3">
            <XCircle size={15} className="text-error shrink-0 mt-0.5" />
            <p className="text-sm text-error leading-snug">{error}</p>
          </div>
        )}

        {/* Remarks input for destructive actions */}
        {remarksFor && !done && remarksFor !== 'partially_delivered' && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-text-secondary">
              Remarks <span className="text-text-muted">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Reason for failure…"
              className="w-full bg-surface-2 border border-border rounded-2xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
            />
          </div>
        )}

        {/* Partial delivery form */}
        {remarksFor === 'partially_delivered' && !done && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                Remarks <span className="text-error">*</span>
              </label>
              <textarea
                rows={3}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Reason for partial delivery…"
                className="w-full bg-surface-2 border border-border rounded-2xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">
                COD Collected <span className="text-error">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={partialCodCollected}
                onChange={e => setPartialCodCollected(e.target.value)}
                placeholder="Amount collected"
                className="w-full bg-surface-2 border border-border rounded-2xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
              />
            </div>
            <button
              onClick={() => confirmAction('partially_delivered')}
              disabled={loading || !remarks.trim() || !partialCodCollected}
              style={{ touchAction: 'manipulation' }}
              className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-yellow-500 text-white text-sm font-semibold cursor-pointer active:opacity-80 disabled:opacity-50"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <><CheckCheck size={16} /> Confirm Partial Delivery</>}
            </button>
          </div>
        )}

        {/* Action buttons */}
        {!done && nextStatuses.length > 0 && (
          <div className="flex flex-col gap-3 pt-1">
            {nextStatuses.map(status => {
              const meta     = ACTION_META[status]
              if (!meta) return null
              const Icon     = meta.icon
              const isDanger = !!meta.danger
              const isPartial = !!meta.partial
              const selected = remarksFor === status

              // Skip partial delivery here - it has its own form above
              if (isPartial) {
                if (!selected) {
                  return (
                    <button key={status}
                      onClick={() => { setRemarksFor(status as ParcelStatus); setError('') }}
                      style={{ touchAction: 'manipulation' }}
                      className="flex items-center justify-between h-12 rounded-2xl px-4 border border-yellow-500/30 bg-yellow-500/8 text-yellow-500 cursor-pointer active:opacity-70 transition-opacity"
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={17} />
                        <span className="text-sm font-semibold">{meta.label}</span>
                      </div>
                      <ChevronRight size={15} className="opacity-50" />
                    </button>
                  )
                }
                return null // Form is rendered above
              }

              if (isDanger && !selected) {
                return (
                  <button key={status}
                    onClick={() => { setRemarksFor(status as ParcelStatus); setError('') }}
                    style={{ touchAction: 'manipulation' }}
                    className="flex items-center justify-between h-12 rounded-2xl px-4 border border-error/30 bg-error/8 text-error cursor-pointer active:opacity-70 transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={17} />
                      <span className="text-sm font-semibold">{meta.label}</span>
                    </div>
                    <ChevronRight size={15} className="opacity-50" />
                  </button>
                )
              }

              if (isDanger && selected) {
                return (
                  <button key={status}
                    onClick={() => confirmAction(status as ParcelStatus)}
                    disabled={loading}
                    style={{ touchAction: 'manipulation' }}
                    className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-error text-white text-sm font-semibold cursor-pointer active:opacity-80 disabled:opacity-50"
                  >
                    {loading ? <RefreshCw size={16} className="animate-spin" /> : <><Icon size={16} /> Confirm — {meta.label}</>}
                  </button>
                )
              }

              return (
                <button key={status}
                  onClick={() => confirmAction(status as ParcelStatus)}
                  disabled={loading}
                  style={{ touchAction: 'manipulation', boxShadow: '0 4px 20px rgba(249,115,22,0.3)' }}
                  className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-brand text-white text-sm font-semibold cursor-pointer active:bg-brand-dark disabled:opacity-50 transition-colors"
                >
                  {loading ? <RefreshCw size={16} className="animate-spin" /> : <><Icon size={16} /> {meta.label}</>}
                </button>
              )
            })}
          </div>
        )}

        {/* No rider action available */}
        {!done && nextStatuses.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-sm font-semibold text-text-secondary">No actions available</p>
            <p className="text-xs text-text-muted leading-relaxed">
              This parcel is <span className="text-text-primary font-medium">{STATUS_LABELS[parcel.status]}</span>.
              No rider action is needed right now.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
