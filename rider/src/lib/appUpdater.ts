import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// ── In-app updater (Android APK only) ────────────────────────────────────────
// Releases are published to GitHub Releases by .github/workflows/rider-release.yml.
// Each release carries an update.json manifest; "releases/latest/download/..."
// always redirects to the newest release's copy and is served by GitHub's CDN,
// so it isn't subject to the 60-requests/hour limit of the GitHub REST API
// (which riders sharing one office Wi-Fi IP would hit).
export const UPDATE_MANIFEST_URL: string =
  import.meta.env.VITE_RIDER_UPDATE_MANIFEST_URL
  ?? 'https://github.com/Yunira0/ParcelMoover/releases/latest/download/update.json'

/** True only inside the Capacitor Android shell - the PWA updates itself via its service worker. */
export const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export interface InstalledApp {
  versionName: string
  versionCode: number
}

/** Shape written by scripts/release-manifest.mjs - keep the two in sync. */
export interface UpdateManifest {
  versionName: string
  versionCode: number
  /** Installs below this versionCode must update before using the app. */
  minSupportedVersionCode: number
  publishedAt: string
  apkUrl: string
  sha256: string
  size: number
  notes: string[]
}

interface AppUpdaterPlugin {
  getAppInfo(): Promise<InstalledApp & { packageName: string }>
  fetchManifest(opts: { url: string }): Promise<{ body: string }>
  downloadUpdate(opts: { url: string; sha256: string; versionCode: number }): Promise<{ path: string }>
  canInstall(): Promise<{ allowed: boolean }>
  openInstallSettings(): Promise<{ allowed: boolean }>
  installUpdate(opts: { path: string }): Promise<void>
  addListener(
    event: 'downloadProgress',
    cb: (e: { downloadedBytes: number; totalBytes: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'appResumed', cb: () => void): Promise<PluginListenerHandle>
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

export async function fetchUpdateManifest(): Promise<UpdateManifest> {
  // Cache-buster on top of the native no-cache header: some carrier proxies
  // ignore Cache-Control on redirects.
  const url = `${UPDATE_MANIFEST_URL}${UPDATE_MANIFEST_URL.includes('?') ? '&' : '?'}t=${Date.now()}`
  const { body } = await AppUpdater.fetchManifest({ url })
  return parseManifest(JSON.parse(body))
}

function parseManifest(raw: unknown): UpdateManifest {
  const m = raw as Partial<UpdateManifest> | null
  const ok = m
    && typeof m.versionName === 'string'
    && Number.isInteger(m.versionCode)
    && typeof m.apkUrl === 'string'
    && typeof m.sha256 === 'string'
  if (!ok) throw new Error('Update manifest is malformed')
  return {
    versionName: m.versionName!,
    versionCode: m.versionCode!,
    minSupportedVersionCode: Number.isInteger(m.minSupportedVersionCode) ? m.minSupportedVersionCode! : 0,
    publishedAt: typeof m.publishedAt === 'string' ? m.publishedAt : '',
    apkUrl: m.apkUrl!,
    sha256: m.sha256!,
    size: typeof m.size === 'number' ? m.size : 0,
    notes: Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === 'string') : [],
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Check throttling + "Later" snooze (per device, best-effort) ──────────────
const LAST_CHECK_KEY = 'riderUpdate.lastCheck'
const SNOOZE_KEY = 'riderUpdate.snooze'
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const SNOOZE_MS = 24 * 60 * 60 * 1000

export function autoCheckDue(): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0)
    return Date.now() - last > AUTO_CHECK_INTERVAL_MS
  } catch { return true }
}

export function markChecked() {
  try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())) } catch { /* ignore */ }
}

export function snooze(versionCode: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ versionCode, until: Date.now() + SNOOZE_MS }))
  } catch { /* ignore */ }
}

export function isSnoozed(versionCode: number): boolean {
  try {
    const s = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null') as { versionCode: number; until: number } | null
    return !!s && s.versionCode === versionCode && Date.now() < s.until
  } catch { return false }
}
