import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../lib/useOnlineStatus'

// Riders work in areas with spotty connectivity - without this, a lost
// connection just shows up as failed requests with no explanation. This only
// surfaces connectivity state; it doesn't change how any request behaves.
export default function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-error text-white text-xs font-semibold py-2 px-4 shrink-0"
      style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
    >
      <WifiOff size={13} />
      You're offline — changes won't be saved until you're back online
    </div>
  )
}
