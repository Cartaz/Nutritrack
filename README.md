# NutriTrack PWA

**v1.2.0** — Tracker di calorie e macro personalizzato, **PWA vanilla TypeScript installabile su iOS** (Add to Home Screen) e su Android/desktop. Costruito seguendo lo **Standard di Creazione PWA**: Vite 5 + TypeScript strict + vite-plugin-pwa (injectManifest) + localStorage, niente framework UI.

## Cos'è NutriTrack

NutriTrack è un tracker nutrizionale **privacy-first** che funziona interamente nel browser: nessun account, nessun server, nessun tracker. Tutti i dati restano sul dispositivo (localStorage). È pensato per chi vuole tenere sotto controllo calorie e macro (proteine, carboidrati, grassi) senza rinunciare alla privacy né installare app native.

**Caso d'uso tipico**: apri l'app, aggiungi alimenti al diario (ricercandoli su Open Food Facts o creandoli custom), vedi in tempo reale quante calorie/macro hai consumato rispetto all'obiettivo, e tieni d'occhio la media settimanale. Le ricette ti permettono di raggruppare ingredienti e aggiungerli al diario in un tap. Il calcolatore TDEE (Mifflin-St Jeor) stima il fabbisogno calorico in base a peso/altezza/età/sesso/attività, e l'obiettivo di peso (perdere/mantenere/aumentare) regola automaticamente le calorie con un rateo sicuro (max 0.5 kg/settimana, linea guida WHO/ACSM).

**Funziona offline**, è installabile come app su iOS/Android/desktop, e il barcode scanner usa la fotocamera per cercare prodotti su Open Food Facts. Il codice è open source (MIT), i dati nutrizionali provengono da [Open Food Facts](https://world.openfoodfacts.org) (database collaborativo, licenza ODbL).

---

## 🎉 What's new in v1.2.0

This release delivers the **three P1 items of Step 02 — "Everyday quality of life"** of the hobbyist roadmap. All local-only, no architectural impact, no new dependencies. The daily-use experience gets a meaningful upgrade on three fronts: more useful statistics, a richer Italian product database, and biometric tracking.

### P1 #1: Monthly and yearly statistics

The old "Last 7 days" section has grown into a full **Statistics card with three tabs**:

- **Week** (7 days): the original vertical bars, unchanged behavior.
- **Month** (30 days): 30 compact bars scaled to the observed maximum, with average kcal/day and the count of tracked days.
- **Year** (365 days): a **GitHub-style contribution heatmap** (53 columns × 7 rows). Color intensity maps to the calorie ratio against the goal — 5 green levels for under-goal days, red for over-goal. Every cell is clickable and navigates to that day. Scrollable horizontally on mobile.

Below the tabs, a **weight trend SVG line chart** (only rendered when ≥ 2 weight entries exist) shows raw data points, the 7-day moving average, axis labels (min/max weight, first/last date), and the total delta with color coding (red for gain, green for loss).

The stats worker is reused as-is — it was already generic over arbitrary date arrays — so the month/year computations run on the same Web Worker with the existing 500ms timeout + main-thread fallback.

### P1 #2: Curated Italian product database (local barcode override)

A new local JSON database (`src/data/it-foods-override.json`) ships with **25 curated Italian grocery products** (Coop, Conad, Carrefour, Esselunga, Barilla, De Cecco, Mutti, Ferrero, Mulino Bianco, …) with real EAN-13 barcodes, per-100g nutrition, serving size/label, and a `verified` flag (true only if the values were checked against the physical package).

When the user scans a barcode, the resolution now follows a **three-tier priority**:

1. **User-saved food** with the same barcode (the user's data always wins — they may have manually corrected values).
2. **Curated IT override** (local lookup, no network).
3. **Open Food Facts** fallback (online, with the existing retry/backoff logic).

The toast identifies which source matched (`(tuo salvato)` / `(DB italiano)` / no suffix for OFF), so the user always knows where the data came from. Contributions are welcome via PR on the JSON file. The override integrates transparently with the existing barcode dedupe in `saveOffFood`.

### P1 #3: Daily water, sleep, and weight tracking

A new **Biometrica card** on the dashboard tracks three daily metrics, all on localStorage in the same payload as the rest of the app (schema additive, no version bump):

- **Water**: a progress bar against a 2.5 L reference goal (EFSA) with ±1 glass (200 ml) quick-add buttons. Shows the glass count and the percentage of the goal.
- **Sleep**: a number input (0–24 h, 0.5 step) for hours of sleep.
- **Weight**: a number input (20–500 kg, 0.1 step). If today's weight is missing, the input is pre-filled with the latest known value (marked as inferred) — weight changes slowly, so this saves a tap.

Below the inputs, a **14-day sparkline** shows the weight trend with a 7-day trailing moving average and the total delta (red/green/muted based on direction).

Setters validate aggressively: out-of-range values are rejected with a toast (no silent clamping for weight — clamping 5 kg to 20 kg would be misleading on corrupted data), while ≤ 0 values clear the field (intentional reset). The store uses an `in`-operator merge so "field absent from patch" is distinct from "field explicitly set to undefined" — patching water never touches weight.

### Tests & quality

**287 unit tests pass** (+58 new: 39 biometrics, 12 IT override, 7 stats windows) — typecheck, lint, build all green. The CI pipeline (typecheck → lint → format:check → test → build) is fully green.

Roadmap updated: 3 P1 items of Phase 2 → done. Counter 6/24 → 9/24 completed tasks.

---

## 🎉 Phase 2 complete: P2 + P3 items

The remaining 4 items of Step 02 "Everyday quality of life" are now shipped, completing the entire Phase 2 of the hobbyist roadmap. All local-only, no architectural impact, no new dependencies.

### P2 #1: Copy-to-clipboard for recipes and diary

A new `clipboard.ts` module generates **markdown human-readable** exports of the daily diary and individual recipes, with a "Copy" button in both the dashboard (next to the "Pasti" heading) and the recipe viewer modal. The format includes:

- **Diary**: a header with the date, the daily total (kcal + macros) vs goal, each meal as a section with per-entry items (name, brand, quantity/grams, kcal) and a per-meal subtotal, and the day's biometrics (water/sleep/weight) when present. Meals are emitted in canonical order (breakfast → lunch → dinner → snack) regardless of insertion order.
- **Recipe**: name, description (blockquote), servings, total + per-serving macros, and the ingredient list with grams and per-ingredient kcal.

`copyToClipboard` uses the modern `navigator.clipboard.writeText` API when available (HTTPS + secure context), with a `document.execCommand('copy')` fallback for older Safari and HTTP contexts. Toast feedback confirms success or reports permission errors.

### P2 #2: Quick add — recent and favorite foods

A new "Aggiunti di recente" card on the dashboard lists the **last 10 foods used in the diary**, deduplicated by foodId (a food used multiple times counts once, with an aggregated `useCount`), ordered by most recent use. Each chip shows the food thumbnail, name, serving size, and kcal per default serving.

A single tap triggers `quickAddRecentFood`, which adds the food to the current date with the default serving size as `gramsOverride`. The meal is chosen intelligently from the current hour (breakfast before 11:00, lunch 11–15, dinner 15–21, snack otherwise) — so the user doesn't have to pick a meal for habitual foods. The card is hidden when the diary is empty (no recents yet).

The recent list derives entirely from the existing diary state (no extra persistence) and always uses the **fresh food snapshot** from `state.foods` when the foodId still exists, falling back to the entry's snapshot if the food was deleted.

### P2 #3: Keyboard shortcuts (desktop)

A new `keyboardShortcuts.ts` module binds a global `keydown` listener (initialized once in `main.ts`). Shortcuts:

| Key   | Action                                                                |
| ----- | --------------------------------------------------------------------- |
| `/`   | Open the food search dialog on the current date (meal chosen by hour) |
| `d`   | Go to dashboard                                                       |
| `f`   | Go to foods                                                           |
| `r`   | Go to recipes                                                         |
| `s`   | Go to settings                                                        |
| `?`   | Show the keyboard help overlay                                        |
| `Esc` | Close the help overlay                                                |

Shortcuts are **guarded** to avoid hijacking typing: they are skipped when the focus is in an `<input>`, `<textarea>`, `<select>`, or `contenteditable` element; when any modal is open (the modal's own ESC handler takes over); and when modifier keys (Ctrl/Cmd/Alt) are held (so browser shortcuts like Cmd+S still work). The help overlay is a lightweight custom modal (not the generic modal system, to avoid state interactions) with a close button, overlay-click, and ESC.

### P3 #1: Local gamification (streak + badges)

A new `gamification.ts` module computes:

- **Streak**: the current consecutive-days streak (days with at least 1 diary entry), with a tolerance — if today is empty but yesterday was tracked, the streak from yesterday is still "alive" to give the user until midnight. Also tracks the **longest streak ever** and the last tracked date.
- **7 badges**: 🌱 First step (first diary entry), 🔥 First week (7-day streak), 💯 Centurione (100 tracked days, non-consecutive), 🍳 Chef alle prime armi (first recipe), 👨‍🍳 Cuoco provetto (10 recipes), 💧 Biometrico (first biometric entry), 🚰 Idratato (2 L water in a day).

A "Il tuo percorso" card at the bottom of the dashboard shows the current streak with a flame icon, the personal record, and a grid of badges — unlocked badges in green with full-color icons, locked badges grayed out with desaturated icons. Everything is derived from existing state (no extra persistence, no backend, no social, no sharing — pure personal motivation).

### Tests & quality (final)

**340 unit tests pass** (+53 new: 11 clipboard, 8 recentFoods, 20 gamification, 14 keyboardShortcuts) — typecheck, lint, format:check, build all green. The test setup now includes stubs for `document.execCommand` and `navigator.clipboard` (jsdom does not implement them).

Roadmap updated: Phase 2 is **100% complete** (7/7 items: 3 P1 + 3 P2 + 1 P3). Counter 9/24 → 13/24 completed tasks.

---

## 🎉 What's new in v1.1.1

This patch release focuses on **stabilizing and improving the Open Food Facts ingredient search** — the area that generated the most user feedback after v1.1.0. Two fixes:

### OFF search: automatic retry with backoff

Before this release, the ingredient search frequently reported "You are offline" or "Check your connection" even when the user was online and OFF was just having a transient blip. Retrying a second later worked. Now:

- **Linear backoff retry** (500ms × attempt) on the same OFF instance for transient errors: `NetworkError`, `TimeoutError`, HTTP 5xx, 429. Max 1 retry per instance before falling through to the next one.
- **Silent UI-level auto-retry**: if the first search fails with a transient error, the app retries once automatically after 800ms without showing any error toast. The typical "retry a second later and it works" case is now handled invisibly.
- **Accurate error messages**: previously `NetworkError` (online but OFF unreachable) was reported as "You are offline" — misleading. Now `OfflineError` (genuinely offline, `navigator.onLine === false`) is distinct from `NetworkError` (online but OFF is down) and `TimeoutError` (OFF is slow).
- **Service Worker race condition fixed**: `apiGetJson` was aborting at 8s while the SW `NetworkFirst` strategy waited 10s, preventing cache fallback. The timeout is now aligned at 10s and the global deadline at 20s.
- Applied to text search, barcode scanner, and the recipe ingredient sub-search.

### OFF search: suffix expansion for partial word matches

OFF with `search_simple=1` does not support partial matching or wildcards (`melanzan*` returns 0 results). So searching "melanzan" (incomplete) returned 0 products even though "melanzane" has 417. Now:

- When the original query returns 0 results **and** does not already end with an Italian suffix, the app tries in parallel the query + each suffix in `PARTIAL_MATCH_SUFFIXES` (`'e'`, `'i'`, `'a'`, `'o'` — ordered by frequency in Italian food product names).
- Returns the result with the most products. If all fail, returns the original empty result.
- **Resilient**: if one suffix fails with a network error, the others still complete (one failure does not block the rest).
- **Pagination-safe**: the effective query is stored in `effectiveQuery` and reused for subsequent pages, so "Load more results" does not break.

Examples: `pasta` → no expansion (already has results). `melanzan` → `melanzane` (417 products). `biscott` → `biscotti` (picks the suffix with the most results).

### Test & quality

229 unit tests pass (+30 new for the retry logic and suffix expansion) — typecheck, lint, format, build all green. The CI GitHub Actions pipeline runs the full suite (typecheck → lint → test → build) on every PR and push.

---

## 🎉 What's new in v1.1.0

This release ships the **P0 roadmap items** that turn NutriTrack from "demo with a README" into a properly licensed, installable, privacy-respecting PWA. Three deliverables:

### P0-1: MIT LICENSE file

The README declared the project as MIT-licensed, but the actual `LICENSE` file was missing. Technically, without the file the code was "All rights reserved" — which made the project not legally open source. This release adds the standard SPDX MIT license text and `"license": "MIT"` to `package.json`. Anyone can now legitimately fork, modify, and redistribute NutriTrack under the terms of the MIT license.

### P0-2: Real barcode scanner

The search dialog now has a "Scan" button that opens the device camera and reads EAN/UPC barcodes. Implementation details:

- **Native `BarcodeDetector` API** on Chrome/Android (fast, no extra dependency).
- **`@zxing/library` fallback** on Safari iOS and browsers without native support (the same library used by mainstream scanner apps).
- Detected code is forwarded to `getOffByBarcode()` (already present as a stub), which queries Open Food Facts and pre-fills the search dialog with the matching product.
- If the product is not in OFF, an informative toast is shown and the user can fall back to a manual name search or create a custom ingredient.
- Camera permissions are requested lazily (only when the user taps "Scan"), with clear error handling for denied/in-use cameras.

### P0-3: Formal privacy policy

A static HTML page at `/privacy.html` documents, in plain language:

- All data lives on the device (localStorage). No backend, no account, no analytics.
- The only outbound network calls are to `*.openfoodfacts.org` (for ingredient/barcode lookups) — explicitly disclosed.
- No cookies, no third-party trackers, no service worker fingerprinting beyond what's needed for offline PWA functionality.
- GDPR-friendly by design: nothing leaves the device that could identify the user.
- Linked from the app footer and from the README, so it's discoverable both from inside the app and from the GitHub repo.

### Test & quality

199 unit tests pass — typecheck, lint, build all green. The CI GitHub Actions pipeline runs the full suite (typecheck → lint → test → build) on every PR and push.

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
