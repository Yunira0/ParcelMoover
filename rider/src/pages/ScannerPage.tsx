import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat, NotFoundException } from '@zxing/library'
import {
  ScanLine, Flashlight, AlertCircle, RefreshCw,
  Keyboard, X, ZoomIn, ZoomOut, CheckCircle,
} from 'lucide-react'
import { getParcelByTrackingId, type Parcel } from '../lib/api'
import ParcelActionSheet from '../components/ParcelActionSheet'

type ScanState = 'scanning' | 'loading' | 'found' | 'error'

const SCAN_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
]

// TRY_HARDER is meant for a single best-effort decode of a static image - in
// a continuous video loop, combined with checking 7 formats every frame, it
// makes each decode attempt too expensive to keep up with real-time frames
// on mid/low-end Android hardware, so scans never complete in practice
// (reported as "camera shows video, never detects a code"). Leaving it off
// here trades rare edge-case robustness for actually finishing each frame's
// decode before the next one arrives.
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS],
])

/** Always returns the live video track — avoids stale-ref bugs. */
function liveTrack(videoEl: HTMLVideoElement | null): MediaStreamTrack | undefined {
  return (videoEl?.srcObject as MediaStream | null)?.getVideoTracks()[0]
}

export default function ScannerPage() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const pausedRef   = useRef(false)
  const resumeTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const [cameraError,    setCameraError]    = useState<string | null>(null)
  const [torchOn,        setTorchOn]        = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [zoomSupported,  setZoomSupported]  = useState(false)
  const [zoomLevel,      setZoomLevel]      = useState(1)
  const [zoomRange,      setZoomRange]      = useState<{ min: number; max: number; step: number }>({ min: 1, max: 4, step: 0.5 })
  const [scanState,      setScanState]      = useState<ScanState>('scanning')
  const [parcel,         setParcel]         = useState<Parcel | null>(null)
  const [scanError,      setScanError]      = useState('')
  const [resumeIn,       setResumeIn]       = useState(0)

  const abortRef = useRef<AbortController | null>(null)

  const [manualMode,    setManualMode]    = useState(false)
  const [manualId,      setManualId]      = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError,   setManualError]   = useState('')
  const manualInputRef  = useRef<HTMLInputElement>(null)

  const clearResumeTimer = useCallback(() => {
    if (resumeTimer.current) { clearInterval(resumeTimer.current); resumeTimer.current = null }
  }, [])

  const resetScanner = useCallback(() => {
    clearResumeTimer()
    abortRef.current?.abort()
    abortRef.current = null
    // Hardware torch stays on across scans; only reset UI state
    setScanState('scanning')
    setParcel(null)
    setScanError('')
    setResumeIn(0)
    setManualMode(false)
    setManualId('')
    setManualError('')
    pausedRef.current = false
  }, [clearResumeTimer])

  const startResumeCountdown = useCallback((seconds: number) => {
    setResumeIn(seconds)
    let remaining = seconds
    resumeTimer.current = setInterval(() => {
      remaining -= 1
      setResumeIn(remaining)
      if (remaining <= 0) {
        clearInterval(resumeTimer.current!)
        resumeTimer.current = null
        resetScanner()
      }
    }, 1000)
  }, [resetScanner])

  // Read torch/zoom capabilities once the video is actually playing
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlaying = () => {
      const track = liveTrack(video)
      if (!track) return
      const caps = track.getCapabilities?.() as any
      if (caps?.torch) setTorchSupported(true)
      if (caps?.zoom && caps.zoom.min < caps.zoom.max) {
        setZoomSupported(true)
        const rawStep = caps.zoom.step ?? 0.5
        const step    = rawStep < 0.1 ? 0.5 : rawStep
        setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step })
        setZoomLevel(caps.zoom.min)
      }
    }
    video.addEventListener('playing', onPlaying, { once: true })
    return () => video.removeEventListener('playing', onPlaying)
  }, [])

  const toggleTorch = useCallback(async () => {
    const track = liveTrack(videoRef.current)
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] })
      setTorchOn(next)
    } catch (e) {
      console.warn('[torch]', e)
    }
  }, [torchOn])

  const applyZoom = useCallback(async (level: number) => {
    const track = liveTrack(videoRef.current)
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ zoom: level } as any] })
      setZoomLevel(level)
    } catch (e) {
      console.warn('[zoom]', e)
    }
  }, [])

  const zoomIn = useCallback(() => {
    applyZoom(Math.min(+(zoomLevel + zoomRange.step).toFixed(2), zoomRange.max))
  }, [zoomLevel, zoomRange, applyZoom])

  const zoomOut = useCallback(() => {
    applyZoom(Math.max(+(zoomLevel - zoomRange.step).toFixed(2), zoomRange.min))
  }, [zoomLevel, zoomRange, applyZoom])

  const tapToFocus = useCallback(async (e: React.MouseEvent<HTMLVideoElement>) => {
    const track = liveTrack(videoRef.current)
    if (!track || scanState !== 'scanning') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top)  / rect.height
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual', pointOfInterest: { x, y } } as any] })
    } catch { /* not all browsers support pointOfInterest */ }
  }, [scanState])

  const onCodeDetected = useCallback(async (text: string) => {
    if (pausedRef.current) return
    pausedRef.current = true

    const trimmed = text.trim()
    navigator.vibrate?.(40)
    setScanState('loading')
    setScanError('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const data = await getParcelByTrackingId(trimmed, controller.signal)
      abortRef.current = null
      setParcel(data)
      setScanState('found')
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return
      const msg = e?.response?.status === 404
        ? `Parcel "${trimmed}" not found or not assigned to you.`
        : e?.code === 'ECONNABORTED'
          ? 'Request timed out. Check your connection and try again.'
          : (e?.message ?? `Could not load parcel "${trimmed}"`)
      setScanError(msg)
      setScanState('error')
      startResumeCountdown(5)
    }
  }, [startResumeCountdown])

  const submitManual = useCallback(async () => {
    const trimmed = manualId.trim().toUpperCase()
    if (!trimmed) return
    setManualLoading(true)
    setManualError('')
    try {
      const data = await getParcelByTrackingId(trimmed)
      setParcel(data)
      setManualMode(false)
      setScanState('found')
      navigator.vibrate?.(40)
    } catch (e: any) {
      const msg = e?.response?.status === 404
        ? `Parcel "${trimmed}" not found or not assigned to you.`
        : (e?.message ?? `Could not load parcel "${trimmed}"`)
      setManualError(msg)
    } finally {
      setManualLoading(false)
    }
  }, [manualId])

  useEffect(() => {
    if (manualMode) setTimeout(() => manualInputRef.current?.focus(), 150)
  }, [manualMode])

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 200 })
    let mounted  = true

    const startWithConstraints = async (constraints: MediaStreamConstraints) => {
      const controls = await reader.decodeFromConstraints(
        constraints,
        videoRef.current!,
        (res, err) => {
          if (!mounted) return
          if (res) {
            onCodeDetected(res.getText())
          } else if (err && !(err instanceof NotFoundException)) {
            // IndexSizeError = canvas 0×0 at startup; harmless, ZXing recovers automatically
            if (err.name !== 'IndexSizeError') {
              console.warn('[scanner]', err)
            }
          }
        }
      )
      if (!mounted) controls.stop()
      else controlsRef.current = controls
    }

    async function start() {
      try {
        // 1280x720 has plenty of resolution for a QR/barcode at normal scanning
        // distance, at under half the pixels of 1080p to decode every frame -
        // see the HINTS comment above for why frame cost matters here.
        await startWithConstraints({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
      } catch (err: any) {
        if (!mounted) return
        // Relax constraints on overconstrained / device-busy errors
        if (err.name === 'OverconstrainedError' || err.name === 'NotReadableError') {
          try {
            await startWithConstraints({ video: { facingMode: 'environment' } })
            return
          } catch { /* fall through */ }
        }
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access in your browser settings.'
            : err.name === 'NotFoundError'
              ? 'No camera found on this device.'
              : 'Could not start camera.'
        )
      }
    }

    start()
    return () => {
      mounted = false
      clearResumeTimer()
      abortRef.current?.abort()
      controlsRef.current?.stop()
      // Ensure torch is off when leaving the scanner
      const track = liveTrack(videoRef.current)
      if (track) track.applyConstraints({ advanced: [{ torch: false } as any] }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 bg-black overflow-hidden">

      <video
        ref={videoRef}
        autoPlay playsInline muted
        onClick={tapToFocus}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ cursor: scanState === 'scanning' ? 'crosshair' : 'default' }}
      />

      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg px-8 text-center">
          <div className="w-16 h-16 rounded-3xl bg-error/10 flex items-center justify-center">
            <AlertCircle size={28} className="text-error" />
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">{cameraError}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ touchAction: 'manipulation' }}
            className="flex items-center gap-2 bg-brand text-white rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {!cameraError && (
        <>
          {/* Dark overlay with rectangular scan-window cutout */}
          <div
            className="absolute inset-0 pointer-events-none bg-black/55"
            style={{
              WebkitMaskImage: `radial-gradient(ellipse 76% 44% at 50% 44%, transparent 99%, black 100%)`,
              maskImage:       `radial-gradient(ellipse 76% 44% at 50% 44%, transparent 99%, black 100%)`,
            }}
          />

          {/* Scan window frame */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ marginBottom: '3%' }}
          >
            <div className="relative" style={{ width: '74%', aspectRatio: '1' }}>
              {[
                'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg',
                'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg',
                'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg',
                'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg',
              ].map((cls, i) => (
                <span key={i} className={`absolute w-9 h-9 border-brand ${cls}`} />
              ))}

              {scanState === 'scanning' && (
                <div className="absolute inset-x-3 overflow-hidden" style={{ top: '6%', bottom: '6%' }}>
                  <div
                    className="w-full h-[2px] rounded-full bg-brand"
                    style={{
                      animation: 'scanBeam 2s ease-in-out infinite',
                      boxShadow: '0 0 12px 5px rgba(249,115,22,0.55)',
                    }}
                  />
                </div>
              )}

              {scanState === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  <button
                    onClick={resetScanner}
                    style={{ touchAction: 'manipulation' }}
                    className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              )}

              {scanState === 'found' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <CheckCircle size={48} className="text-success" style={{ animation: 'popIn 0.25s cubic-bezier(0,0,0.2,1)' }} />
                </div>
              )}
            </div>
          </div>

          {/* Hint */}
          {scanState === 'scanning' && (
            <div className="absolute flex justify-center inset-x-0 pointer-events-none" style={{ top: '74%' }}>
              <div className="flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
                <ScanLine size={14} className="text-brand" />
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-widest">
                  Align Tracking Code
                </span>
              </div>
            </div>
          )}

          {/* Error + auto-resume */}
          {scanState === 'error' && (
            <div
              className="absolute inset-x-5 flex flex-col items-center gap-3"
              style={{ top: '68%', animation: 'fadeIn 0.2s ease-out' }}
            >
              <div className="flex items-start gap-2 bg-error/90 backdrop-blur-sm rounded-2xl px-4 py-3 w-full">
                <AlertCircle size={16} className="text-white shrink-0 mt-0.5" />
                <span className="text-xs font-semibold text-white flex-1 leading-snug">{scanError}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetScanner}
                  style={{ touchAction: 'manipulation' }}
                  className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  <RefreshCw size={12} />
                  {resumeIn > 0 ? `Retry (${resumeIn}s)` : 'Retry'}
                </button>
                <button
                  onClick={() => { clearResumeTimer(); setResumeIn(0); setManualMode(true) }}
                  style={{ touchAction: 'manipulation' }}
                  className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  <Keyboard size={12} /> Enter ID
                </button>
              </div>
            </div>
          )}

          {/* Top-right controls: torch + zoom */}
          <div className="absolute top-5 right-5 flex flex-col gap-2">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                style={{ touchAction: 'manipulation' }}
                aria-label={torchOn ? 'Turn off torch' : 'Turn on torch'}
                className={`w-11 h-11 flex items-center justify-center rounded-2xl backdrop-blur-sm transition-colors cursor-pointer
                  ${torchOn ? 'bg-brand text-white' : 'bg-black/50 text-white'}`}
              >
                <Flashlight size={20} />
              </button>
            )}
            {zoomSupported && (
              <>
                <button
                  onClick={zoomIn}
                  disabled={zoomLevel >= zoomRange.max}
                  style={{ touchAction: 'manipulation' }}
                  aria-label="Zoom in"
                  className="w-11 h-11 flex items-center justify-center rounded-2xl bg-black/50 text-white backdrop-blur-sm cursor-pointer disabled:opacity-30"
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  onClick={zoomOut}
                  disabled={zoomLevel <= zoomRange.min}
                  style={{ touchAction: 'manipulation' }}
                  aria-label="Zoom out"
                  className="w-11 h-11 flex items-center justify-center rounded-2xl bg-black/50 text-white backdrop-blur-sm cursor-pointer disabled:opacity-30"
                >
                  <ZoomOut size={18} />
                </button>
              </>
            )}
          </div>

          {/* Manual entry trigger */}
          {scanState === 'scanning' && (
            <button
              onClick={() => setManualMode(true)}
              style={{ touchAction: 'manipulation' }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-sm text-white/80 rounded-full px-5 py-2.5 text-xs font-medium cursor-pointer"
            >
              <Keyboard size={13} /> Can't scan? Enter ID manually
            </button>
          )}

          {scanState === 'found' && parcel && (
            <div className="absolute inset-0 z-10">
              <div className="absolute inset-0 bg-black/40" onClick={resetScanner} />
              <ParcelActionSheet parcel={parcel} onClose={resetScanner} onDone={resetScanner} />
            </div>
          )}

          {/* Manual entry sheet */}
          {manualMode && (
            <div
              className="absolute inset-x-0 bottom-0 bg-surface rounded-t-3xl border-t border-border flex flex-col"
              style={{ boxShadow: '0 -12px 48px rgba(0,0,0,0.7)', animation: 'slideUp 0.25s cubic-bezier(0,0,0.2,1)' }}
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3" />
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 className="text-base font-bold text-text-primary">Enter Tracking ID</h2>
                <button
                  onClick={() => { setManualMode(false); setManualId(''); setManualError('') }}
                  style={{ touchAction: 'manipulation' }}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-surface-2 text-text-muted cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 pb-8 flex flex-col gap-3">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualId}
                  onChange={e => { setManualId(e.target.value.toUpperCase()); setManualError('') }}
                  onKeyDown={e => e.key === 'Enter' && submitManual()}
                  placeholder="e.g. PM-20240629-XXXX"
                  autoCapitalize="characters"
                  className="w-full bg-surface-2 border border-border rounded-2xl px-4 py-3 text-sm font-mono text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
                {manualError && (
                  <div className="flex items-start gap-2 bg-error/10 border border-error/30 rounded-xl px-3 py-2.5">
                    <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
                    <span className="text-xs text-error leading-snug">{manualError}</span>
                  </div>
                )}
                <button
                  onClick={submitManual}
                  disabled={!manualId.trim() || manualLoading}
                  style={{ touchAction: 'manipulation' }}
                  className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-brand text-white text-sm font-semibold cursor-pointer disabled:opacity-40 active:opacity-80 transition-opacity"
                >
                  {manualLoading ? <RefreshCw size={16} className="animate-spin" /> : 'Look Up Parcel'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes scanBeam {
          0%   { transform: translateY(0%);  opacity: 0.5; }
          50%  { transform: translateY(88%); opacity: 1;   }
          100% { transform: translateY(0%);  opacity: 0.5; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1);   }
        }
      `}</style>
    </div>
  )
}
