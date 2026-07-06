# NutriTrack PWA

Tracker di calorie e macro personalizzato — **PWA vanilla TypeScript installabile su iOS** (Add to Home Screen) e su Android/desktop. Costruito seguendo lo **Standard di Creazione PWA**: Vite 5 + TypeScript strict + vite-plugin-pwa (injectManifest) + localStorage, niente framework UI.

## Stack

- **Vite 5** — bundler e dev server
- **TypeScript 5** strict (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `forceConsistentCasingInFileNames`)
- **Vanilla TS** — no React/Vue/Svelte, `innerHTML` strutturato + event delegation
- **vite-plugin-pwa** con strategia `injectManifest` (custom SW in `src/sw.ts` con Workbox)
- **Web Worker** per statistiche settimanali con fallback main-thread
- **localStorage** con backup, quota handling, multi-tab sync
- **Open Food Facts** API (multi-istanza con fallback it/world/fr/es/de)
- **GitHub Actions** per CI (typecheck + build) e deploy su GitHub Pages (base path auto-rilevato)

## Funzionalità

- **Dashboard**: diario giornaliero con macro ring calorie + bar proteine/carbo/grassi, navigazione date, statistiche ultima settimana (via worker)
- **4 pasti**: colazione, pranzo, cena, spuntino
- **Alimenti**: CRUD completo, preferiti, ricerca testuale, creazione custom con valori per 100g (con calcolo automatico kcal da macro)
- **Ricerca OFF**: ricerca su Open Food Facts con debounce + AbortController + fallback multi-istanza
- **Ricette**: CRUD completo, editor con ingredienti (ricerca OFF/salvati/custom), calcolo automatico per porzione, aggiunta al diario (ingredienti scalati)
- **Impostazioni**: obiettivo calorie (input + slider), split macro personalizzato con preset (Bilanciato/Alto proteico/Low carb/Keto/Mediterranea), calcolatore TDEE Mifflin-St Jeor, tema (system/light/dark), export/import JSON, reset
- **PWA**: installabile, offline-ready, maskable icons, safe-area iOS, dark by default

## Struttura cartelle

```
nutritrack-pwa/
├── .editorconfig
├── .github/workflows/
│   ├── ci.yml                  # typecheck + build su PR/push main
│   └── deploy.yml              # build + GitHub Pages, base path auto
├── .gitignore
├── README.md
├── index.html                  # meta iOS, preconnect OFF, manifest link
├── package.json
├── tsconfig.json               # strict config
├── vite.config.ts              # Vite + VitePWA injectManifest + manualChunks
├── scripts/
│   └── gen-icons.py            # genera icone mancanti (maskable, apple-touch, favicon)
├── public/
│   ├── robots.txt
│   └── icons/
│       ├── icon.svg
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── icon-maskable-512.png
│       ├── apple-touch-icon.png
│       ├── favicon.ico
│       └── favicon-{16,32,48}.png
└── src/
    ├── main.ts                 # entry: init store, load, render, registerSW (prod only)
    ├── types.ts                # tipi dominio + tipi OFF + WorkerRequest/Response + AppState
    ├── vite-env.d.ts
    ├── sw.ts                   # Service Worker (Workbox injectManifest)
    ├── styles/
    │   └── main.css            # CSS variables, safe-area, dark by default, layout, componenti
    ├── lib/
    │   ├── constants.ts        # STORAGE_KEY, BACKUP_KEY, timeout, OFF_INSTANCES
    │   ├── utils.ts            # safeId, safeNum, escapeHtml, parseISODateLocal, debounce
    │   ├── store.ts            # state observer + RAF + mutators
    │   ├── storage.ts          # localStorage + backup + quota + multi-tab sync
    │   ├── api.ts              # apiGetJson + ApiError + searchOff + getOffByBarcode
    │   ├── normalize.ts        # normalizeXxx + buildFoodFromOff + reconcileAll
    │   ├── nutrition.ts        # calcMacroGrams, scaleNutrition, sumNutrition, calcBMR, calcTDEE
    │   ├── foods.ts            # azioni dominio: createCustomFood, requestDeleteFood, ...
    │   ├── diary.ts            # azioni dominio: addFoodToDiary, addRecipeToDiary, ...
    │   └── recipes.ts          # azioni dominio: createRecipe, requestDeleteRecipe, ...
    ├── worker/
    │   ├── stats.worker.ts     # computeStats + computeDayTotals (self.onmessage)
    │   └── client.ts           # wrapper con fallback + timeout 500ms
    ├── components/
    │   ├── toast.ts            # showToast(msg, type)
    │   ├── modal.ts            # showModal + initModal (event delegation)
    │   ├── img.ts              # imgTag(src, alt, cls, fallback) con data-fallback
    │   ├── imageFallback.ts    # initImageFallback() capture-phase globale
    │   ├── header.ts           # renderHeader + renderBottomNav
    │   ├── search.ts           # search dialog OFF con tabs preferiti/salvati/cerca
    │   ├── exportImport.ts     # export JSON Blob + import validato
    │   └── renderer.ts         # render() RAF + code-splitting viste + event delegation globale
    └── views/
        ├── dashboard.ts        # diario giornaliero + macro ring + bar + week stats
        ├── foods.ts            # elenco alimenti salvati + search + preferiti
        ├── recipes.ts          # elenco ricette + search + add-to-diary
        ├── settings.ts         # calorie/macro/TDEE/tema/export/import/reset
        ├── food-editor.ts      # modal crea/modifica alimento custom
        ├── recipe-editor.ts    # modal crea/modifica ricetta con ingredienti
        └── recipe-viewer.ts    # modal vista ricetta read-only
```

## Sviluppo

```bash
# Installa dipendenze
npm install

# Dev server (http://localhost:5173)
npm run dev

# Typecheck strict (tsc --noEmit)
npm run typecheck

# Build produzione (tsc + vite build)
npm run build

# Preview build locale
npm run preview
```

## Deploy

### GitHub Pages (automatico)

1. Crea un repo su GitHub e pusha il codice su `main`
2. Abilita **Settings → Pages → Source: GitHub Actions**
3. Il workflow `.github/workflows/deploy.yml` builda automaticamente ad ogni push su `main` con `VITE_BASE_PATH` auto-rilevato da `GITHUB_REPOSITORY`
4. L'app sarà disponibile su `https://<user>.github.io/<repo>/`

### Deploy manuale (altro hosting statico)

```bash
npm run build
# Copia dist/ sul tuo hosting (Netlify, Vercel, Cloudflare Pages, Caddy, Nginx...)
# Importante: il SW richiede HTTPS (o localhost) per funzionare
```

Se deployi su sottopercorso, imposta `VITE_BASE_PATH=/tuo-percorso/` prima del build.

## Installazione come app (PWA)

### iOS (Safari)
1. Apri l'URL dell'app in Safari
2. Tocca **Condividi → Aggiungi a Home Screen**
3. L'app appare con icona e si apre in modalità standalone (senza barre browser)

### Android (Chrome)
1. Apri l'URL
2. Tocca **⋮ → Installa app** o rispondi "Sì" al banner di installazione

### Desktop (Chrome/Edge)
1. Apri l'URL
2. Clicca l'icona **Installa** nella barra degli indirizzi

## Persistenza dati

- **localStorage** con chiave `nutritrack_data_v1`
- **Backup** automatico su chiave `nutritrack_data_backup` (snapshot precedente, recovery su parse error)
- **Quota handling**: su `QuotaExceededError` strip automatico delle immagini e retry; avviso a 4.5MB
- **Modalità privata**: detection IIFE all'avvio, modal informativo, graceful degradation a modalità in-memory
- **Multi-tab sync**: via `storage` event, skip se modal aperto per non sovrascrivere form
- **Export/Import**: backup JSON completo con validazione `normalizeXxx` su ogni entità importata

## Privacy

Tutti i dati restano sul dispositivo (localStorage). Nessun invio a server di terzi se non le ricerche su Open Food Facts (database collaborativo gratuito, no chiave API).

## Target browser

- **iOS Safari 16+** (target primario — PWA installabile, safe-area, dvh)
- Chrome/Edge/Safari desktop moderni
- No supporto IE, no polyfill per features disponibili in iOS Safari 16+

## Licenza

Codice sotto licenza MIT. Dati nutrizionali forniti da [Open Food Facts](https://world.openfoodfacts.org) (database collaborativo, licenza ODbL).
