import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Service worker updates itself in the background and takes over on
      // next load — no "new version available" prompt needed for this phase.
      registerType: 'autoUpdate',
      // Auto-injects the SW registration script into index.html and, in dev,
      // registers a real service worker under `npm run dev` too (via
      // devOptions below) so Phase 1 can be tested without a full build.
      injectRegister: 'auto',
      includeAssets: ['favicon-32.png', 'favicon-64.png'],
      manifest: {
        name: 'IQRA — Empowering Balochistan Through Education',
        short_name: 'IQRA',
        description:
          'Affordable, quality exam prep for Class 9-12 and MDCAT students across Balochistan.',
        theme_color: '#00453a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          // Placeholder using the existing favicon — NOT sufficient on its
          // own for full "Add to Home Screen" installability (browsers
          // want at least one 192x192 and one 512x512 icon). Doesn't block
          // offline mode or Capacitor packaging (Phase 2 uses its own
          // native icon), but add real 192x192/512x512 PNGs here later if
          // you want the web version to be properly installable too.
          { src: '/favicon-64.png', sizes: '64x64', type: 'image/png' },
        ],
      },
      workbox: {
        // Precache the built JS/CSS/HTML/fonts/icons — Section 4's
        // requirement so the app shell itself can boot with zero connection.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // SPA fallback: any offline navigation (e.g. refreshing on
        // /chapter/123) is served index.html instead of a network 404,
        // and BrowserRouter takes it from there client-side.
        navigateFallback: '/index.html',
        // Take over from any previous SW version immediately instead of
        // waiting for all tabs to close.
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
