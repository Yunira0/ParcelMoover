import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { getRiderParcels, PENDING_QUEUE_STATUSES, type Parcel } from '../lib/api'

interface PendingCtx {
  parcels: Parcel[]
  loading: boolean
  error: string
  /** True when the server cut off some of the rider's actionable queue behind
   *  its unpaginated row cap - the badge/list may be missing parcels. */
  truncated: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<PendingCtx | null>(null)

export function PendingProvider({ children }: { children: ReactNode }) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [truncated, setTruncated] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      // Ask the backend for just the queue's statuses instead of pulling the
      // rider's entire order history and filtering client-side - cheaper for
      // high-volume riders, and far less likely to hit the list endpoint's
      // row cap than the full history would (though still possible - see
      // `truncated` above).
      const result = await getRiderParcels(PENDING_QUEUE_STATUSES)
      setParcels(result.data)
      setTruncated(result.truncated)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load parcels')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [])

  // Load the queue as soon as the rider is authenticated, not just when they
  // happen to visit the Pending tab - otherwise BottomNav's badge count sits
  // at 0 for however long they stay on Scan/Dashboard after logging in.
  useEffect(() => { refresh() }, [refresh])

  // The office can assign a new pickup at any time - without a poll, the
  // queue (and the BottomNav badge riders check for new work) would only
  // ever update after the rider's own actions, silently going stale for
  // however long they sit on Scan/Dashboard. Mirrors AuthContext's own
  // visibility/online re-check pattern for the same reason.
  useEffect(() => {
    const interval = setInterval(refresh, 45_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onOnline = () => refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])

  return <Ctx.Provider value={{ parcels, loading, error, truncated, refresh }}>{children}</Ctx.Provider>
}

export function usePending() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePending must be inside PendingProvider')
  return ctx
}
