import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      // #26: the optional backend (server/) has no CORS headers at all
      // (server/src/main.ts) — same-origin only, by design (see its own
      // docs). Proxying `/api` -> the backend during `npm run dev` keeps the
      // browser's view of things same-origin so cookies flow, without
      // needing the server to grow CORS just for local dev. Production
      // deploys are expected to serve this app and the backend from the same
      // origin (see docs/ARCHITECTURE.md) so this proxy has no prod
      // equivalent to configure — src/lib/sync/config.ts's `/api` default
      // matches this rewrite either way. A missing/unreachable backend here
      // is harmless: every sync/*Api call degrades gracefully on failure
      // (see CLAUDE.md's Browser AI/offline-capture rules), so `npm run dev`
      // with no server running keeps working exactly as before #26.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // Auto-update: this is a personal logbook with no server contract to
      // coordinate, so silently taking the newest build is safe and avoids
      // nagging the user with a refresh prompt.
      registerType: 'autoUpdate',
      // Serve the service worker from the dev server too, so offline
      // behaviour can be exercised with `npm run dev`, not just a prod build.
      devOptions: { enabled: true },
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Logbook',
        short_name: 'Logbook',
        description:
          'An offline-first adventure logbook for mountaineers and skydivers, powered by on-device AI.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Mirrors --lb-page-bg / --lb-accent in src/index.css.
        background_color: '#ECDFD0',
        theme_color: '#C1552C',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            // Full-bleed variant: launchers crop this to their own shape.
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precaching the whole app shell is what makes a cold start work with
        // no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
