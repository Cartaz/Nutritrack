# NutriTrack PWA

**v1.0.0** — Tracker di calorie e macro personalizzato, **PWA vanilla TypeScript installabile su iOS** (Add to Home Screen) e su Android/desktop. Costruito seguendo lo **Standard di Creazione PWA**: Vite 5 + TypeScript strict + vite-plugin-pwa (injectManifest) + localStorage, niente framework UI.

## Cos'è NutriTrack

NutriTrack è un tracker nutrizionale **privacy-first** che funziona interamente nel browser: nessun account, nessun server, nessun tracker. Tutti i dati restano sul dispositivo (localStorage). È pensato per chi vuole tenere sotto controllo calorie e macro (proteine, carboidrati, grassi) senza rinunciare alla privacy né installare app native.

**Caso d'uso tipico**: apri l'app, aggiungi alimenti al diario (ricercandoli su Open Food Facts o creandoli custom), vedi in tempo reale quante calorie/macro hai consumato rispetto all'obiettivo, e tieni d'occhio la media settimanale. Le ricette ti permettono di raggruppare ingredienti e aggiungerli al diario in un tap. Il calcolatore TDEE (Mifflin-St Jeor) stima il fabbisogno calorico in base a peso/altezza/età/sesso/attività, e l'obiettivo di peso (perdere/mantenere/aumentare) regola automaticamente le calorie con un rateo sicuro (max 0.5 kg/settimana, linea guida WHO/ACSM).

**Funziona offline**, è installabile come app su iOS/Android/desktop, e il barcode scanner usa la fotocamera per cercare prodotti su Open Food Facts. Il codice è open source (MIT), i dati nutrizionali provengono da [Open Food Facts](https://world.openfoodfacts.org) (database collaborativo, licenza ODbL).

---

## 🎉 What's new in v1.0.0

Questa è la **prima release stabile**. Prima del tag v1.0.0 l'app è stata sottoposta a uno **stress test intensivo** con 10 subagent paralleli che hanno analizzato edge cases su tutte le aree (storage, normalize, nutrition calc, diary, foods/recipes CRUD, dashboard, settings, editors, API/barcode/worker, E2E browser). Sono stati identificati e corretti **~95 bug** (0 CRITICAL, 7 HIGH, 25 MEDIUM, 13 LOW), di cui i più rilevanti:

### Bug fix più significativi

- **Privacy**: `resetAll()` ora cancella anche `BACKUP_KEY` da localStorage — prima i dati "cancellati" potevano resuscitare via fallback
- **Correttezza dati**: `addRecipeToDiary` valida `state.currentDate` prima di scrivere (evita silent data loss con date invalide)
- **Dedupe barcode**: nuova `saveOffFood()` centralizzata con dedupe per barcode + fallback name+brand, usata in search dialog e recipe editor (prima ogni pick OFF generava un nuovo id → duplicati)
- **Modal double-click**: i callback vengono rimossi PRIMA del fade-out 200ms → previene food/recipe duplicati su double-click "Salva"
- **Memory leak**: `escHandler` nel barcode scanner ora rimosso in `cleanup()` (prima si accumulava ad ogni apertura)
- **Settings**: eliminata duplicazione campo "peso attuale" che poteva divergere tra sezione TDEE e sezione obiettivo
- **Nutrition calc**: `calcBMR` ritorna 0 se sex è undefined (backup legacy), `normalizeMacroSplit` garantisce sum=100 esatto, `calcGoalAdjustedCalories` rispetta il clamp min 500 kcal
- **Normalize**: alimenti fiber/sugar/salt-only (psyllium husk, sale) non vengono più scartati; `buildFoodFromOff` gestisce `energy-kcal_100g` come stringa vuota
- **A11y**: `:focus-visible` globale su tutti gli elementi interattivi (WCAG 2.4.7), padding-bottom aumentato per FAB non oscurato da bottom-nav
- **API**: rimosso header `User-Agent` (forbidden dai browser, dead code), `getOffByBarcode` distingue 404 da 5xx/network, paginazione OFF con bottone "Carica altri risultati"
- **Editor**: campo barcode nei food custom, kcal calcolate da macro (Atwater) se kcal=0, dirty check su close, toast informativo su updateFood (stale diary snapshots)

### Test
199 test unitari (+6 nuovi per le fix) — typecheck, lint, build tutti verdi. Copertura: storage, normalize, nutrition, utils. La CI GitHub Actions esegue l'intera pipeline su ogni PR/push.

---

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
- **Scanner barcode**: scansione codice a barre via fotocamera (BarcodeDetector API nativa su Chrome/Android, fallback `@zxing/library` su Safari iOS) — riutilizza `getOffByBarcode()` per recuperare il prodotto
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
├── LICENSE                     # MIT (P0 #1)
├── README.md
├── index.html                  # meta iOS, preconnect OFF, manifest link
├── package.json
├── tsconfig.json               # strict config
├── vite.config.ts              # Vite + VitePWA injectManifest + manualChunks
├── scripts/
│   └── gen-icons.py            # genera icone mancanti (maskable, apple-touch, favicon)
├── public/
│   ├── robots.txt
│   ├── privacy.html            # informativa privacy statica GDPR (P0 #3)
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
    ├── vite-env.d.ts           # tipi BarcodeDetector API + requestVideoFrameCallback
    ├── sw.ts                   # Service Worker (Workbox injectManifest)
    ├── styles/
    │   └── main.css            # CSS variables, safe-area, dark by default, layout, componenti
    ├── lib/
    │   ├── constants.ts        # STORAGE_KEY, BACKUP_KEY, timeout, OFF_INSTANCES
    │   ├── utils.ts            # safeId, safeNum, escapeHtml, parseISODateLocal, debounce
    │   ├── store.ts            # state observer + RAF + mutators
    │   ├── storage.ts          # localStorage + backup + quota + multi-tab sync
    │   ├── api.ts              # apiGetJson + ApiError + searchOff + getOffByBarcode
    │   ├── barcode.ts          # BarcodeDetector nativo + fallback @zxing/library (P0 #2)
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
    │   ├── search.ts           # search dialog OFF con tabs preferiti/salvati/cerca + scan barcode
    │   ├── barcode-scanner.ts  # modal scanner camera con BarcodeDetector/ZXing (P0 #2)
    │   ├── exportImport.ts     # export JSON Blob + import validato
    │   └── renderer.ts         # render() RAF + code-splitting viste + event delegation globale
    └── views/
        ├── dashboard.ts        # diario giornaliero + macro ring + bar + week stats
        ├── foods.ts            # elenco alimenti salvati + search + preferiti
        ├── recipes.ts          # elenco ricette + search + add-to-diary
        ├── settings.ts         # calorie/macro/TDEE/tema/export/import/reset + link privacy
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

# Test unitari (Vitest, jsdom)
npm test                # one-shot
npm run test:watch      # watch mode
npm run test:coverage   # con coverage report (v8)

# Lint (ESLint 9 flat config + typescript-eslint)
npm run lint
npm run lint:fix

# Formattazione (Prettier 3)
npm run format          # scrivi
npm run format:check    # verifica solo (usato in CI)

# Pipeline completa CI locale (typecheck + lint + format + test + build)
npm run ci
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

## Qualità del codice

- **TypeScript 5 strict** con `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `forceConsistentCasingInFileNames`
- **ESLint 9** (flat config) con `typescript-eslint` 8 — regole semantiche (eqeqeq, no-var, no-unused-vars), regole di formato delegate a Prettier
- **Prettier 3** — singleQuote, trailingComma all, printWidth 120, semicolon, lf
- **Vitest 2.1** con environment jsdom e coverage v8 — 193 test su `lib/nutrition.ts`, `lib/normalize.ts`, `lib/storage.ts`, `lib/utils.ts`. Soglie minime di coverage (60% statements, 50% branches)
- **CI GitHub Actions** — pipeline: typecheck → lint → format:check → test → build → verifica PWA assets

## Privacy

Tutti i dati restano sul dispositivo (localStorage). Nessun invio a server di terzi se non le ricerche su Open Food Facts (database collaborativo gratuito, no chiave API).

L'informativa privacy completa è disponibile in [`/privacy.html`](./public/privacy.html) (visibile anche dall'app: Impostazioni → Informazioni → Informativa privacy).

L'app **non utilizza cookie**, non installa tracker, non richiede account. Il barcode scanner elabora i frame video localmente nel browser e non trasmette né salva immagini.

## Target browser

- **iOS Safari 16+** (target primario — PWA installabile, safe-area, dvh)
- Chrome/Edge/Safari desktop moderni
- No supporto IE, no polyfill per features disponibili in iOS Safari 16+

## Licenza

Codice sotto licenza [MIT](./LICENSE). Dati nutrizionali forniti da [Open Food Facts](https://world.openfoodfacts.org) (database collaborativo, licenza ODbL).
