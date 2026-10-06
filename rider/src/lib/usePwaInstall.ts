import { useState, useEffect, useCallback } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isMobile(): boolean {
  return /android|iphone|ipad|ipod|opera mini|iemobile/i.test(window.navigator.userAgent)
}

export default function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true

  const install = useCallback(async () => {
    if (deferred) {
      await deferred.prompt()
      await deferred.userChoice
      setDeferred(null)
    }
  }, [deferred])

  // Show button on mobile when not already installed as standalone PWA.
  // On Chromium browsers the deferred prompt will fire and install natively.
  // On iOS Safari there's no programmatic prompt, so we expose the intent
  // and the caller can show manual instructions.
  const canInstall = !isStandalone && isMobile()
  const hasNativePrompt = !!deferred

  return { canInstall, hasNativePrompt, install }
}
