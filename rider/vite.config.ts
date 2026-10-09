import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  base: './',
  define: {
    // Shown on the Profile page; the APK's versionName comes from the same field.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5200,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Dev-server-only: rewrite origin so server CORS accepts it.
            if (process.env.NODE_ENV === 'development') {
              proxyReq.setHeader('Origin', 'http://localhost:5200')
            }
          })
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx instead, and only in the browser: inside the
      // Android APK the assets are already on-device, and a service worker
      // would keep serving the previous version's bundle after an in-app update.
      injectRegister: null,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'ParcelMoover Rider',
        short_name: 'PM Rider',
        description: 'ParcelMoover rider app for parcel pickup and delivery',
        theme_color: '#C2410C',
        background_color: '#F6F6F5',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/rider/',
        start_url: '/rider/',
        // These PNGs aren't padded with a maskable safe zone, so they only
        // declare "any" — claiming "maskable" on an unpadded icon lets
        // Android crop into the artwork on adaptive-icon home screens.
        // If adaptive-icon support is wanted, add a separate icon asset
        // with ~40% safe-zone padding and give it its own "maskable" entry.
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // https and http (e.g. plain-HTTP LAN/self-hosted deployments
            // without TLS) both resolve /api requests to the current origin.
            urlPattern: /^https?:\/\/.*\/api\//,
            // Explicit on purpose: NetworkFirst must never intercept mutating
            // requests (POST/PATCH/PUT/DELETE) - a stale cached response
            // being served for e.g. a status update would tell the rider it
            // succeeded when it never reached the server. Workbox defaults
            // this to GET when unset, but that's an implicit default one
            // config edit away from silently changing.
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
})
