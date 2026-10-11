/** rider/package.json "version", injected by vite.config.ts. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Override the update.json URL (e.g. a local server while testing the updater). */
  readonly VITE_RIDER_UPDATE_MANIFEST_URL?: string
}
