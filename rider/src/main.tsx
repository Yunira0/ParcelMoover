import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

if ('serviceWorker' in navigator) {
  if (Capacitor.isNativePlatform()) {
    // APK builds before 1.4.0 registered the PWA worker; remove it and its
    // caches so an updated APK always runs its own bundled code.
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()))
    if ('caches' in window) void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)))
  } else {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./sw.js', { scope: './' })
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
