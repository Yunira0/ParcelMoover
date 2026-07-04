import { Bell } from 'lucide-react'

export default function NotificationsPage() {
  return (
    <div className="flex flex-col flex-1 bg-bg overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-6 pb-2">
        <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
        <p className="text-sm text-text-muted mt-0.5">Your delivery alerts</p>
      </div>

      {/* Empty */}
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-surface-2 flex items-center justify-center border border-border">
          <Bell size={36} className="text-text-muted" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-base font-semibold text-text-primary">All caught up</p>
          <p className="text-sm text-text-muted mt-1">New alerts will show here</p>
        </div>
      </div>
    </div>
  )
}
