import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { getRiderParcels, PENDING_QUEUE_STATUSES, type Parcel } from '../lib/api'

interface PendingCtx {
  parcels: Parcel[]
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const Ctx = createContext<PendingCtx | null>(null)

export function PendingProvider({ children }: { children: ReactNode }) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      // Ask the backend for just the queue's statuses instead of pulling the
      // rider's entire order history and filtering client-side - cheaper for
      // high-volume riders, and immune to the list endpoint's row cap cutting
      // off actionable parcels behind older delivered/cancelled ones.
      const parcels = await getRiderParcels(PENDING_QUEUE_STATUSES)
      setParcels(parcels)
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

  return <Ctx.Provider value={{ parcels, loading, error, refresh }}>{children}</Ctx.Provider>
}

export function usePending() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePending must be inside PendingProvider')
  return ctx
}
