import { Calendar, Check, X } from 'lucide-react'
import { toBsDate } from '../lib/nepaliDate'

export type DateFilter =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'week' }
  | { kind: 'custom'; date: string } // AD "YYYY-MM-DD" from <input type="date">

const PRESETS: { kind: Exclude<DateFilter['kind'], 'custom'>; label: string }[] = [
  { kind: 'all', label: 'All time' },
  { kind: 'today', label: 'Today' },
  { kind: 'yesterday', label: 'Yesterday' },
  { kind: 'week', label: 'Last 7 days' },
]

const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Ashar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]

/** "12 Bhadra 2083" - same romanized-BS treatment used on the settlements sheet. */
export function dateFilterLabel(filter: DateFilter): string {
  if (filter.kind !== 'custom') return PRESETS.find(p => p.kind === filter.kind)!.label
  const bs = toBsDate(filter.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bs)) return 'Custom'
  const [y, m, d] = bs.split('-').map(Number)
  return `${d} ${BS_MONTHS_EN[m - 1] ?? ''} ${y}`
}

interface Props {
  value: DateFilter
  onChange: (filter: DateFilter) => void
  onClose: () => void
}

// Pen "Detail Sheet" chrome (same grabber/header/rounded-r20 treatment as
// SettlementDetailSheet) reused here for a filter picker instead of a detail
// view, so the queue gets one sheet language instead of a second one.
export default function DateFilterSheet({ value, onChange, onClose }: Props) {
  const todayAd = new Date().toISOString().slice(0, 10)

  return (
    <div
      className="absolute bottom-0 inset-x-0 z-10 flex max-h-[85%] flex-col rounded-t-[20px] bg-surface"
      style={{ boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)' }}
    >
      <div className="shrink-0 pt-2.5">
        <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
      </div>

      <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-3.5">
        <h2 className="text-base font-bold leading-none text-ink">Filter by date</h2>
        <button
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg text-ink-2 cursor-pointer hover:text-ink transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="h-px shrink-0 bg-line" />

      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-[max(18px,env(safe-area-inset-bottom))]">
        {PRESETS.map(preset => {
          const active = value.kind === preset.kind
          return (
            <button
              key={preset.kind}
              onClick={() => { onChange({ kind: preset.kind }); onClose() }}
              style={{ touchAction: 'manipulation' }}
              className="flex w-full cursor-pointer items-center justify-between border-b border-line py-3.5 text-left last:border-b-0"
            >
              <span className={`text-[14.5px] ${active ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
                {preset.label}
              </span>
              {active && <Check size={17} className="shrink-0 text-rust" strokeWidth={2.4} />}
            </button>
          )
        })}

        {/* Custom date - native picker, so the OS supplies a proper calendar UI
            instead of a hand-rolled one. The <input> is a transparent overlay
            across the whole row (standard trick for styling a date input) so
            the entire row - not just a bare icon - is the tap target. */}
        <div className="relative flex w-full items-center justify-between py-3.5">
          <span className={`text-[14.5px] ${value.kind === 'custom' ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
            {value.kind === 'custom' ? dateFilterLabel(value) : 'Custom date…'}
          </span>
          <span className="flex items-center gap-2">
            {value.kind === 'custom' && <Check size={17} className="shrink-0 text-rust" strokeWidth={2.4} />}
            <Calendar size={17} className="shrink-0 text-ink-3" strokeWidth={1.8} />
          </span>
          <input
            type="date"
            max={todayAd}
            defaultValue={value.kind === 'custom' ? value.date : undefined}
            onChange={(e) => {
              if (!e.target.value) return
              onChange({ kind: 'custom', date: e.target.value })
              onClose()
            }}
            style={{ touchAction: 'manipulation' }}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            aria-label="Pick a custom date"
          />
        </div>
      </div>
    </div>
  )
}
