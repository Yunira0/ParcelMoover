import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

// Riders work in areas with spotty connectivity - without this, a lost
// connection just shows up as failed requests with no explanation. This only
// surfaces connectivity state; it doesn't change how any request behaves.
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-error text-white text-xs font-semibold shrink-0">
      <WifiOff size={14} />
      You're offline - some actions may not go through
    </div>
  )
}
