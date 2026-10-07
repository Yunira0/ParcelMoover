import { ArrowRight, Download, ShieldCheck } from 'lucide-react'
import { useAppUpdate } from '../context/UpdateContext'
import { formatBytes } from '../lib/appUpdater'
import Button from './Button'

function releaseDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Same sheet anatomy as SettlementDetailSheet (grabber, small caps label over a
// bold title, hairline sections), but fixed to the viewport so it can appear
// over any screen - including the login page - on launch.
export default function UpdateSheet() {
  const {
    open, update, installed, phase, required, progress, error,
    startUpdate, grantInstallPermission, install, later,
  } = useAppUpdate()

  if (!open || !update) return null

  const canDismiss = !required && phase !== 'downloading'
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  const meta = [releaseDate(update.publishedAt), formatBytes(update.size)].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="absolute inset-0 bg-black/40" onClick={canDismiss ? later : undefined} />
      <div
        className="absolute bottom-0 inset-x-0 flex max-h-[85%] flex-col rounded-t-[20px] bg-surface"
        style={{
          boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
          animation: 'slideUp 0.3s cubic-bezier(0,0,0.2,1)',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="shrink-0 pt-2.5">
          <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 flex-col gap-[5px] px-5 pt-3 pb-4">
          <p className={`text-[9.5px] font-semibold tracking-[1.6px] ${required ? 'text-red' : 'text-rust'}`}>
            {required ? 'UPDATE REQUIRED' : 'UPDATE AVAILABLE'}
          </p>
          <h2 id="update-title" className="text-lg font-bold leading-tight text-ink">
            PM Rider {update.versionName}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-[6px] border border-line bg-bg px-2 py-[3px] font-mono text-[12px] font-semibold text-ink-2">
              {installed?.versionName ?? '—'}
              <ArrowRight size={12} className="text-ink-3" />
              <span className="text-ink">{update.versionName}</span>
            </span>
            {meta && <span className="text-[12.5px] text-ink-3">{meta}</span>}
          </div>
        </div>

        {/* What's new */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
          <p className="mb-2 text-[10px] font-semibold tracking-[1.4px] text-ink-3">WHAT'S NEW</p>
          {update.notes.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {update.notes.map((note, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] font-medium leading-snug text-ink">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-rust" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] font-medium text-ink-2">Bug fixes and improvements.</p>
          )}
          {required && (
            <p className="mt-4 text-[13px] font-medium text-ink-2">
              This version is required to keep using the app.
            </p>
          )}
        </div>

        {/* Phase-specific footer */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-5 pt-4">
          {phase === 'downloading' && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-rust transition-[width] duration-200" style={{ width: `${pct}%` }} />
              </div>
              <p className="font-mono text-[12px] text-ink-3">
                Downloading… {formatBytes(progress.done) || '0 KB'}
                {progress.total > 0 && ` / ${formatBytes(progress.total)}`}
              </p>
            </div>
          )}

          {phase === 'permission' && (
            <div className="flex gap-3 rounded-[12px] border border-line bg-bg p-3">
              <ShieldCheck size={18} className="mt-[1px] shrink-0 text-ink-2" strokeWidth={1.8} />
              <p className="text-[13px] font-medium leading-snug text-ink-2">
                Android needs your OK once: turn on <span className="text-ink">Allow from this source</span>, then come back here.
              </p>
            </div>
          )}

          {phase === 'installing' && (
            <p className="text-[13px] font-medium leading-snug text-ink-2">
              Confirm <span className="text-ink">Update</span> on Android's screen. You'll stay logged in.
            </p>
          )}

          {error && (
            <p role="alert" className="text-[13px] font-medium leading-snug text-red">{error}</p>
          )}

          <div className="flex gap-2.5">
            {canDismiss && (
              <Button variant="secondary" size="md" onClick={later} className="flex-1">Later</Button>
            )}
            {phase === 'permission' ? (
              <Button size="md" onClick={grantInstallPermission} className="flex-[2]">Open settings</Button>
            ) : phase === 'installing' ? (
              <Button size="md" onClick={install} className="flex-[2]">Install</Button>
            ) : (
              <Button size="md" onClick={startUpdate} loading={phase === 'downloading'} className="flex-[2]">
                <Download size={16} strokeWidth={2} />
                {phase === 'error' ? 'Try again' : 'Update now'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
