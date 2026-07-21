import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      // Uploaded files (KYC docs, vendor notice images) are served by the
      // backend, not Vite - without this, dev-server requests for them fall
      // through to the SPA's own history fallback and silently return the
      // app shell instead of the file (e.g. a broken <img>).
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
