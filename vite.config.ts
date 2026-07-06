import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path auto-rilevato per GitHub Pages.
// In CI viene passato via VITE_BASE_PATH; in dev è '/'.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'NutriTrack - Calorie & Macro',
        short_name: 'NutriTrack',
        description: 'Tracker calorie e macro personalizzato con ricette custom e database Open Food Facts',
        start_url: `${base}`,
        scope: `${base}`,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0a0a0a',
        theme_color: '#10b981',
        lang: 'it',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: `${base}icons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          api: ['./src/lib/api.ts']
        }
      }
    }
  }
});
