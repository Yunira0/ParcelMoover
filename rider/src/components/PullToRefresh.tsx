import { useRef, useState, useCallback, type ReactNode, type TouchEvent } from 'react'
import { RefreshCw } from 'lucide-react'

const TRIGGER_DISTANCE = 64
const MAX_PULL = 96
// Pulling 1:1 with the finger feels twitchy - damping it makes the gesture
// feel resistive, like the list is being stretched rather than dragged.
const DAMPING = 0.5

interface Props {
  onRefresh: () => Promise<void> | void
  children: ReactNode
  className?: string
}

// Touch-driven pull-to-refresh for a scrollable container. Only starts
// tracking when the container is already scrolled to the top - otherwise an
// ordinary upward scroll gesture would get hijacked as a pull.
export default function PullToRefresh({ onRefresh, children, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startY       = useRef(0)
  const tracking     = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing,   setRefreshing]   = useState(false)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current
    if (!el || refreshing || el.scrollTop > 0) return
    startY.current = e.touches[0].clientY
    tracking.current = true
  }, [refreshing])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!tracking.current || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta <= 0) { setPullDistance(0); return }
    setPullDistance(Math.min(MAX_PULL, delta * DAMPING))
  }, [refreshing])

  const onTouchEnd = useCallback(async () => {
    if (!tracking.current) return
    tracking.current = false
    if (pullDistance < TRIGGER_DISTANCE) {
      setPullDistance(0)
      return
    }
    setRefreshing(true)
    setPullDistance(TRIGGER_DISTANCE)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
      setPullDistance(0)
    }
  }, [pullDistance, onRefresh])

  const progress = Math.min(pullDistance / TRIGGER_DISTANCE, 1)

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`overflow-y-auto ${className}`}
    >
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ height: pullDistance, transition: tracking.current ? 'none' : 'height 0.2s ease-out' }}
      >
        <RefreshCw
          size={18}
          className={`text-brand ${refreshing ? 'animate-spin' : ''}`}
          style={{
            opacity: progress,
            transform: refreshing ? undefined : `rotate(${progress * 180}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  )
}
