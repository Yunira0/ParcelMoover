import type { ParcelStatus } from '../lib/api'

// One place decides how a parcel status reads and looks: the label text and
// the chip tone (olive = needs action, green = done, red = failed,
// blue = in motion, neutral = nothing to act on). Queue, Orders and the
// action sheet all render through this so a status never disagrees.

export type ChipTone = 'olive' | 'green' | 'red' | 'blue' | 'neutral'

export const STATUS_LABEL: Record<ParcelStatus, string> = {
  pickup_ordered:      'Pickup Ordered',
  rider_assigned:      'To Pick Up',
  picked_up:           'Picked Up',
  arrived:             'At Origin Hub',
  ready_to_deliver:    'Ready to Deliver',
  sent_for_delivery:   'Out for Delivery',
  oov:                 'Out of Vicinity',
  dispatched:          'Dispatched',
  arrived_at_branch:   'At Destination',
  hold:                'On Hold',
  loss_and_damage:     'Loss & Damage',
  delivered:           'Delivered',
  partially_delivered: 'Partial',
  failed_pickup:       'Failed',
  failed_delivery:     'Failed',
  cancelled:           'Cancelled',
  follow_up:           'Follow Up',
  ready_to_return:     'To Return',
  sent_to_vendor:      'Returning',
  returned_to_vendor:  'Returned',
}

const STATUS_TONE: Record<ParcelStatus, ChipTone> = {
  pickup_ordered:      'blue',
  rider_assigned:      'olive',
  picked_up:           'green',
  arrived:             'blue',
  ready_to_deliver:    'blue',
  sent_for_delivery:   'blue',
  oov:                 'blue',
  dispatched:          'blue',
  arrived_at_branch:   'blue',
  hold:                'olive',
  loss_and_damage:     'red',
  delivered:           'green',
  partially_delivered: 'olive',
  failed_pickup:       'red',
  failed_delivery:     'red',
  cancelled:           'neutral',
  follow_up:           'olive',
  ready_to_return:     'olive',
  sent_to_vendor:      'blue',
  returned_to_vendor:  'green',
}

export function statusLabel(status: ParcelStatus): string {
  return STATUS_LABEL[status] ?? status
}

export function statusTone(status: ParcelStatus): ChipTone {
  return STATUS_TONE[status] ?? 'neutral'
}

// Pen "Chip / Status": tinted pill, radius 999, padding [4,9], 5px dot,
// 11/600 label, plus a hairline border tinted with the same tone
// (olive example in the pen: fill #B4530910, stroke #9A6A0038).
const TONE_CLS: Record<ChipTone, string> = {
  olive:   'border border-[#9A6A0038] bg-olive-tint text-olive',
  green:   'border border-[#15803D38] bg-green-tint text-green',
  red:     'border border-[#DC262638] bg-red-tint text-red-bright',
  blue:    'border border-[#1D4ED838] bg-blue-tint text-blue',
  neutral: 'border border-line bg-surface-2 text-ink-3',
}

const TONE_DOT: Record<ChipTone, string> = {
  olive:   'bg-olive',
  green:   'bg-green',
  red:     'bg-red-bright',
  blue:    'bg-blue',
  neutral: 'bg-ink-3',
}

export default function StatusChip({
  status,
  tone,
  label,
}: {
  status?: ParcelStatus
  tone?: ChipTone
  label?: string
}) {
  const t = tone ?? (status ? statusTone(status) : 'neutral')
  const text = label ?? (status ? statusLabel(status) : '')
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-[9px] py-1 text-[11px] font-semibold leading-none shrink-0 ${TONE_CLS[t]}`}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${TONE_DOT[t]}`} />
      {text}
    </span>
  )
}
