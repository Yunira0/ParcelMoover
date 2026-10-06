import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat, NotFoundException } from '@zxing/library'
import {
  ScanLine, Flashlight, AlertCircle, RefreshCw,
  Keyboard, X, ZoomIn, ZoomOut, CheckCircle,
} from 'lucide-react'
import { getParcelByTrackingId, type Parcel } from '../lib/api'
import ParcelActionSheet from '../components/ParcelActionSheet'
import Button from '../components/Button'
import Input from '../components/Input'

type ScanState = 'scanning' | 'loading' | 'found' | 'error'

// Waybills only ever carry a QR code or a CODE128 barcode (see
// client/src/utils/printLabels.ts) - the other five formats zxing supports
// were dead weight, and checking every format against every frame is what
// was making detection feel slow. Narrowing the hint list to just the two
// formats actually printed cuts each frame's decode work accordingly.
const SCAN_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128,
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

/* Pen "Bracket": 28×28 rounded corner, 3px rust stroke, round caps.
   Flipped via scale for the other three corners. */
const BRACKET_D = 'M2 26l0-17q0-7 7-7l17 0'

function Bracket({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" width={28} height={28} fill="none" aria-hidden className={`absolute text-rust ${className}`}>
      <path d={BRACKET_D} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}

export default function ScannerPage() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const pausedRef   = useRef(false)
  const resumeTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const [cameraError,    setCameraError]    = useState<string | null>(null)
  const [cameraKey,      setCameraKey]      = useState(0)
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
    const video = videoRef.current
    if (!video) return

    const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 200 })
    let mounted  = true
    let activeStream: MediaStream | null = null

    async function start() {
      try {
        // In standalone PWA mode on some mobile browsers, mediaDevices may be
        // undefined when the page is not served over HTTPS (secure context).
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError(
            'Camera API unavailable. Make sure the app is served over HTTPS and your browser supports camera access.',
          )
          return
        }

        // Get camera stream ourselves — avoids @zxing/browser's internal
        // getUserMedia + play() race conditions with React StrictMode.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        activeStream = stream

        video!.srcObject = stream

        // Let zxing decode from the video element (it handles play + canvas loop)
        const controls = await reader.decodeFromVideoElement(
          video!,
          (res, err) => {
            if (!mounted) return
            if (res) {
              onCodeDetected(res.getText())
            } else if (err && !(err instanceof NotFoundException)) {
              // IndexSizeError = canvas 0×0 at startup; harmless, ZXing recovers automatically
              // AbortError = React StrictMode cleanup interrupted play(); ignore it
              if (err.name !== 'IndexSizeError' && err.name !== 'AbortError') {
                console.warn('[scanner]', err)
              }
            }
          }
        )
        if (!mounted) controls.stop()
        else controlsRef.current = controls
      } catch (err: any) {
        if (!mounted) return
        // AbortError from React StrictMode double-mount is harmless
        if (err.name === 'AbortError') return
        // If preferred resolution fails, retry with any rear camera
        if (err.name === 'OverconstrainedError' || err.name === 'NotReadableError') {
          try {
            activeStream?.getTracks().forEach(t => t.stop())
            const fallback = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
            })
            if (!mounted) { fallback.getTracks().forEach(t => t.stop()); return }
            activeStream = fallback
            video!.srcObject = fallback
            const controls = await reader.decodeFromVideoElement(video!, (res, err) => {
              if (!mounted) return
              if (res) onCodeDetected(res.getText())
              else if (err && !(err instanceof NotFoundException)
                && err.name !== 'IndexSizeError' && err.name !== 'AbortError')
                console.warn('[scanner]', err)
            })
            if (!mounted) controls.stop()
            else controlsRef.current = controls
            return
          } catch { /* fall through */ }
        }
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Tap Retry, then allow camera access when prompted.'
            : err.name === 'NotFoundError'
              ? 'No camera found on this device.'
              : err.name === 'NotReadableError'
                ? 'Camera is in use by another app. Close other apps using the camera and tap Retry.'
                : err.name === 'OverconstrainedError'
                  ? 'Camera does not meet the required constraints. Tap Retry to try with lower resolution.'
                  : `Could not start camera (${err.name ?? 'unknown error'}). Tap Retry to try again.`
        )
      }
    }

    start()
    return () => {
      mounted = false
      clearResumeTimer()
      abortRef.current?.abort()
      controlsRef.current?.stop()
      controlsRef.current = null
      // Stop all camera tracks on cleanup
      activeStream?.getTracks().forEach(t => t.stop())
    }
  }, [cameraKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-bg px-8 text-center">
          <div className="h-16 w-16 rounded-md bg-red-tint border border-red-bright/25 flex items-center justify-center">
            <AlertCircle size={28} className="text-red-bright" />
          </div>
          <p className="text-sm font-medium text-ink-2 leading-relaxed">{cameraError}</p>
          <button
            onClick={() => { setCameraError(null); setCameraKey(k => k + 1) }}
            style={{ touchAction: 'manipulation' }}
            className="flex items-center gap-2 bg-rust text-white rounded-md px-5 py-2.5 text-sm font-semibold cursor-pointer active:bg-rust-deep transition-colors"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {!cameraError && (
        <>
          {/* Top + bottom scrims (pen "Top Scrim" / "Bottom Scrim") */}
          <div
            className="absolute top-0 inset-x-0 h-[150px] pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0))' }}
          />
          <div
            className="absolute bottom-0 inset-x-0 h-[190px] pointer-events-none"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0))' }}
          />

          {/* Viewfinder: 250×222 @ 31.9% top, rust corner brackets + scan beam */}
          <div
            className="absolute inset-x-0 flex justify-center pointer-events-none"
            style={{ top: '31.9%' }}
          >
            <div className="relative" style={{ width: '63.6%', aspectRatio: '250 / 222' }}>
              <Bracket className="top-0 left-0" />
              <Bracket className="top-0 right-0 -scale-x-100" />
              <Bracket className="bottom-0 left-0 -scale-y-100" />
              <Bracket className="bottom-0 right-0 -scale-x-100 -scale-y-100" />

              {scanState === 'scanning' && (
                <div className="absolute left-[10px] right-[10px] top-0 bottom-0 overflow-hidden">
                  <div
                    className="absolute left-0 right-0 h-[2px] rounded-full bg-rust"
                    style={{
                      animation: 'scanBeam 2s ease-in-out infinite',
                      boxShadow: '0 0 16px 3px rgba(194,65,12,0.6)',
                    }}
                  />
                </div>
              )}

              {scanState === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 rounded-full border-2 border-rust border-t-transparent animate-spin" />
                  <button
                    onClick={resetScanner}
                    style={{ touchAction: 'manipulation', background: 'rgba(255,255,255,0.93)' }}
                    className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-[#161616] cursor-pointer"
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              )}

              {scanState === 'found' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <CheckCircle size={48} className="text-green" style={{ animation: 'popIn 0.25s cubic-bezier(0,0,0.2,1)' }} />
                </div>
              )}
            </div>
          </div>

          {/* Hint pill (pen "Hint Pill": white/93, mono 10px, ink) */}
          {scanState === 'scanning' && (
            <div className="absolute flex justify-center inset-x-0 pointer-events-none" style={{ top: '68.5%' }}>
              <div className="flex items-center gap-[7px] rounded-full px-[15px] py-[9px]" style={{ background: 'rgba(255,255,255,0.93)' }}>
                <ScanLine size={13} className="text-[#161616]" />
                <span className="font-mono text-[10px] font-semibold tracking-[1.4px] text-[#161616]">
                  ALIGN THE BARCODE
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
              <div className="flex items-start gap-2 bg-red-bright/95 backdrop-blur-sm rounded-md px-4 py-3 w-full">
                <AlertCircle size={16} className="text-white shrink-0 mt-0.5" />
                <span className="text-xs font-semibold text-white flex-1 leading-snug">{scanError}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetScanner}
                  style={{ touchAction: 'manipulation', background: 'rgba(255,255,255,0.93)' }}
                  className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-[#161616] cursor-pointer"
                >
                  <RefreshCw size={12} />
                  {resumeIn > 0 ? `Retry (${resumeIn}s)` : 'Retry'}
                </button>
                <button
                  onClick={() => { clearResumeTimer(); setResumeIn(0); setManualMode(true) }}
                  style={{ touchAction: 'manipulation', background: 'rgba(255,255,255,0.93)' }}
                  className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-[#161616] cursor-pointer"
                >
                  <Keyboard size={12} /> Enter ID
                </button>
              </div>
            </div>
          )}

          {/* Right-side controls (pen "Controls": 44px circles, white/13, gap 10) */}
          <div className="absolute top-5 right-5 flex flex-col gap-[10px]">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                style={{ touchAction: 'manipulation' }}
                aria-label={torchOn ? 'Turn off torch' : 'Turn on torch'}
                className={`w-11 h-11 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors cursor-pointer
                  ${torchOn ? 'bg-rust text-white' : 'bg-white/[0.13] text-white'}`}
              >
                <Flashlight size={19} />
              </button>
            )}
            {zoomSupported && (
              <>
                <button
                  onClick={zoomIn}
                  disabled={zoomLevel >= zoomRange.max}
                  style={{ touchAction: 'manipulation' }}
                  aria-label="Zoom in"
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.13] text-white backdrop-blur-sm cursor-pointer disabled:opacity-30"
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  onClick={zoomOut}
                  disabled={zoomLevel <= zoomRange.min}
                  style={{ touchAction: 'manipulation' }}
                  aria-label="Zoom out"
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.13] text-white backdrop-blur-sm cursor-pointer disabled:opacity-30"
                >
                  <ZoomOut size={18} />
                </button>
              </>
            )}
          </div>

          {/* Manual entry link (pen "Manual Link": plain 13/500 white/76) */}
          {scanState === 'scanning' && (
            <button
              onClick={() => setManualMode(true)}
              style={{ touchAction: 'manipulation' }}
              className="absolute bottom-[52px] left-1/2 -translate-x-1/2 text-[13px] font-medium text-white/[0.76] cursor-pointer"
            >
              Can't scan?&nbsp; Type the tracking ID
            </button>
          )}

          {scanState === 'found' && parcel && (
            <div className="absolute inset-0 z-10">
              <div className="absolute inset-0 bg-black/40" onClick={resetScanner} />
              <ParcelActionSheet parcel={parcel} onClose={resetScanner} onDone={resetScanner} />
            </div>
          )}

          {/* Manual entry sheet — pen "Manual Sheet": dim + white r20 sheet */}
          {manualMode && (
            <>
              <div className="absolute inset-0 bg-[#0C0C0B]/50" onClick={() => { setManualMode(false); setManualId(''); setManualError('') }} />
              <div
                className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[20px] bg-surface"
                style={{ boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', animation: 'slideUp 0.25s cubic-bezier(0,0,0.2,1)' }}
              >
                <div className="pt-2.5"><div className="mx-auto h-1 w-9 rounded-full bg-line-strong" /></div>
                <div className="flex items-start justify-between px-5 pt-3 pb-1.5">
                  <h2 className="text-[16.5px] font-bold tracking-[-0.2px] text-ink">Enter tracking ID</h2>
                  <button
                    onClick={() => { setManualMode(false); setManualId(''); setManualError('') }}
                    style={{ touchAction: 'manipulation' }}
                    aria-label="Close"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg text-ink-2 cursor-pointer hover:text-ink transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="flex flex-col gap-3.5 px-5 pt-2.5 pb-[22px]">
                  <Input
                    ref={manualInputRef}
                    label="Tracking ID"
                    value={manualId}
                    onChange={e => { setManualId(e.target.value.toUpperCase()); setManualError('') }}
                    onKeyDown={e => e.key === 'Enter' && submitManual()}
                    placeholder="e.g. PM-240801-3902"
                    autoCapitalize="characters"
                    className="font-mono font-medium placeholder:font-sans placeholder:font-normal"
                  />
                  {manualError && (
                    <div role="alert" className="flex items-start gap-2 rounded-sm border border-red-bright/25 bg-red-tint px-3.5 py-3">
                      <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-bright" />
                      <span className="text-xs leading-snug text-red-bright">{manualError}</span>
                    </div>
                  )}
                  <Button loading={manualLoading} disabled={!manualId.trim()} onClick={submitManual}>
                    Look up parcel
                  </Button>
                  <p className="text-[11.5px] leading-[1.5] text-ink-3 text-center">
                    The tracking ID is printed on the parcel waybill, under the barcode.
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
