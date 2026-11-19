import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { buildInfoDefines } from './build-info';

// Base path auto-rilevato per GitHub Pages.
// In CI viene passato via VITE_BASE_PATH; in dev è '/'.
const base = process.env.VITE_BASE_PATH ?? '/';

// Le sorgenti ws:// servono solo all'HMR del dev server: la build di produzione non
// deve permettere connessioni a localhost.
function stripDevOnlyCsp(): Plugin {
  return {
    name: 'nutritrack-strip-dev-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/ ws:\/\/localhost:\* ws:\/\/127\.0\.0\.1:\*/, '');
    },
  };
}

export default defineConfig({
  base,
  define: buildInfoDefines(),
  plugins: [
    stripDevOnlyCsp(),
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
          { src: `${base}icons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    // Vite 8 usa Oxc per la minificazione e Rolldown per il bundle.
    // Manteniamo il chunk API esistente tramite l'API nativa codeSplitting.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'api', test: /[\\/]src[\\/]lib[\\/]api\.ts$/ }],
        },
      },
    },
  },
});
