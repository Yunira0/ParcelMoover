import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
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
            // Rewrite origin so server CORS accepts it regardless of ngrok URL.
            // Dev-server-only: never spoof the Origin header outside local development.
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
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'ParcelMoover Rider',
        short_name: 'PM Rider',
        description: 'ParcelMoover rider app for parcel pickup and delivery',
        theme_color: '#f97316',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
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
