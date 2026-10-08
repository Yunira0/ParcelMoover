import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppUpdater, autoCheckDue, fetchUpdateManifest, isNativeAndroid, isSnoozed, markChecked, snooze,
  type InstalledApp, type UpdateManifest,
} from '../lib/appUpdater'

// idle → checking → available → downloading → (permission →) installing
// "installing" means the system installer is on screen; if the rider backs out
// of it they land back here and can tap Install again.
export type UpdatePhase =
  | 'idle' | 'checking' | 'upToDate' | 'available'
  | 'downloading' | 'permission' | 'installing' | 'error'

interface UpdateState {
  installed: InstalledApp | null
  update: UpdateManifest | null
  phase: UpdatePhase
  /** Installed version is below the release's minSupportedVersionCode - no "Later". */
  required: boolean
  open: boolean
  progress: { done: number; total: number }
  error: string
}

interface UpdateContextValue extends UpdateState {
  /** Manual checks always open the sheet if there's an update and surface errors. */
  check: (opts?: { manual?: boolean }) => Promise<void>
  startUpdate: () => Promise<void>
  grantInstallPermission: () => Promise<void>
  install: () => Promise<void>
  openSheet: () => void
  later: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

const BUSY: UpdatePhase[] = ['checking', 'downloading', 'permission', 'installing']

const errorMessage = (e: unknown, fallback: string) =>
  (e as { message?: string })?.message || fallback

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({
    installed: null,
    update: null,
    phase: 'idle',
    required: false,
    open: false,
    progress: { done: 0, total: 0 },
    error: '',
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const apkPath = useRef<string | null>(null)

  const patch = useCallback((p: Partial<UpdateState>) => setState((s) => ({ ...s, ...p })), [])

  const check = useCallback(async ({ manual = false } = {}) => {
    if (!isNativeAndroid || BUSY.includes(stateRef.current.phase) || stateRef.current.open) return
    patch({ phase: 'checking', error: '' })
    try {
      const [installed, update] = await Promise.all([
        stateRef.current.installed ?? AppUpdater.getAppInfo(),
        fetchUpdateManifest(),
      ])
      markChecked()
      if (update.versionCode <= installed.versionCode) {
        patch({ installed, update: null, phase: manual ? 'upToDate' : 'idle', open: false, required: false })
        return
      }
      const required = installed.versionCode < update.minSupportedVersionCode
      patch({
        installed,
        update,
        required,
        phase: 'available',
        open: manual || required || !isSnoozed(update.versionCode),
      })
    } catch (e) {
      // Background checks fail silently (riders are often on bad networks);
      // only a check the rider asked for reports the problem.
      patch({ phase: manual ? 'error' : 'idle', error: manual ? errorMessage(e, "Couldn't check for updates") : '' })
    }
  }, [patch])

  const install = useCallback(async () => {
    const path = apkPath.current
    if (!path) return
    try {
      const { allowed } = await AppUpdater.canInstall()
      if (!allowed) {
        patch({ phase: 'permission', error: '' })
        return
      }
      await AppUpdater.installUpdate({ path })
      patch({ phase: 'installing', error: '' })
    } catch (e) {
      patch({ phase: 'error', error: errorMessage(e, 'Could not start the installer') })
    }
  }, [patch])

  const startUpdate = useCallback(async () => {
    const { update } = stateRef.current
    if (!update || stateRef.current.phase === 'downloading') return
    patch({ phase: 'downloading', error: '', progress: { done: 0, total: update.size } })
    const sub = await AppUpdater.addListener('downloadProgress', ({ downloadedBytes, totalBytes }) => {
      patch({ progress: { done: downloadedBytes, total: totalBytes > 0 ? totalBytes : update.size } })
    })
    try {
      const { path } = await AppUpdater.downloadUpdate({
        url: update.apkUrl,
        sha256: update.sha256,
        versionCode: update.versionCode,
      })
      apkPath.current = path
      await install()
    } catch (e) {
      patch({ phase: 'error', error: errorMessage(e, 'Download failed. Check your connection and try again.') })
    } finally {
      sub.remove()
    }
  }, [patch, install])

  const grantInstallPermission = useCallback(async () => {
    try {
      const { allowed } = await AppUpdater.openInstallSettings()
      if (allowed) await install()
      else patch({ error: 'Permission is still off. Turn on "Allow from this source" to continue.' })
    } catch (e) {
      patch({ error: errorMessage(e, 'Could not open settings') })
    }
  }, [install, patch])

  const later = useCallback(() => {
    const { update, required, phase } = stateRef.current
    if (required || phase === 'downloading') return
    if (update) snooze(update.versionCode)
    // Back to "available" so Profile still offers the update.
    patch({ open: false, phase: update ? 'available' : 'idle', error: '' })
  }, [patch])

  const openSheet = useCallback(() => patch({ open: true }), [patch])

  // Check on every launch, then again when the app returns to the foreground
  // if the last check is older than AUTO_CHECK_INTERVAL_MS.
  useEffect(() => {
    if (!isNativeAndroid) return
    void check()
    const sub = AppUpdater.addListener('appResumed', () => {
      const { phase } = stateRef.current
      if (phase === 'permission') {
        // Rider may have flipped the toggle via the system Settings app
        // rather than our button - pick it up without another tap.
        void AppUpdater.canInstall().then(({ allowed }) => { if (allowed) void install() })
      } else if (autoCheckDue()) {
        void check()
      }
    })
    return () => { void sub.then((h) => h.remove()) }
  }, [check, install])

  return (
    <UpdateContext.Provider value={{ ...state, check, startUpdate, grantInstallPermission, install, openSheet, later }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useAppUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useAppUpdate must be used inside UpdateProvider')
  return ctx
}
