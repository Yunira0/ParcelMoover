import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { getRiderParcels, RIDER_TRANSITIONS, type Parcel } from '../lib/api'

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
      const all = await getRiderParcels()
      const actionable = Object.keys(RIDER_TRANSITIONS) as string[]
      setParcels(all.filter(p => actionable.includes(p.status)))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load parcels')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [])

  return <Ctx.Provider value={{ parcels, loading, error, refresh }}>{children}</Ctx.Provider>
}

export function usePending() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePending must be inside PendingProvider')
  return ctx
}
