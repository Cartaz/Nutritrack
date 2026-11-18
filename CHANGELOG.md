# Changelog

Le note delle versioni fino alla 1.2.0 sono riportate così come furono scritte all'epoca (in parte in inglese). Dove una funzione è stata poi rimossa o corretta, c'è una nota.

## Non rilasciato

Pulizia guidata da [ANALISI.md](ANALISI.md).

- Test e toolchain verdi su Node 22, 24 e 26 (`engines`, `.nvmrc`, matrice CI).
- Rimossi il database italiano di override (dati non reali), il codice morto e i commenti storici.
- README riscritto e allineato al codice; changelog separato.
- Ricerca: superare il limite di ricerche al minuto mostra il messaggio giusto invece di "Open Food Facts non disponibile"; la classificazione degli errori non dipende più dal testo dei messaggi.
- Barcode: tolto il secondo livello di retry (con OFF giù si arrivava a 20 richieste per una scansione).
- Aggiornamenti: quando è pronta una nuova versione l'app chiede se aggiornare, invece di restare sulla vecchia finché tutte le istanze non vengono chiuse.
- Le porzioni create su un risultato OFF non vanno più perse se il prodotto era già salvato.
- Editor ricette: un prodotto OFF entra in libreria solo quando salvi la ricetta; corretta una ricerca ingredienti che poteva smettere di aprirsi.
- Privacy: immagini accettate solo da Open Food Facts (https), CSP più stretta, niente `ws://localhost` nella build di produzione.
- Accessibilità: lo zoom manuale non è più bloccato (senza zoom automatico sui campi su iOS).
- Coverage misurata su tutto `src/`, con soglie separate per dominio e UI.

## v1.2.0

This release delivers the **three P1 items of Step 02 — "Everyday quality of life"** of the hobbyist roadmap. All local-only, no architectural impact, no new dependencies. The daily-use experience gets a meaningful upgrade on three fronts: more useful statistics, a richer Italian product database, and biometric tracking.

### P1 #1: Monthly and yearly statistics

The old "Last 7 days" section has grown into a full **Statistics card with three tabs**:

- **Week** (7 days): the original vertical bars, unchanged behavior.
- **Month** (30 days): 30 compact bars scaled to the observed maximum, with average kcal/day and the count of tracked days.
- **Year** (365 days): a **GitHub-style contribution heatmap** (53 columns × 7 rows). Color intensity maps to the calorie ratio against the goal — 5 green levels for under-goal days, red for over-goal. Every cell is clickable and navigates to that day. Scrollable horizontally on mobile.

Below the tabs, a **weight trend SVG line chart** (only rendered when ≥ 2 weight entries exist) shows raw data points, the 7-day moving average, axis labels (min/max weight, first/last date), and the total delta with color coding (red for gain, green for loss).

The stats worker is reused as-is — it was already generic over arbitrary date arrays — so the month/year computations run on the same Web Worker with the existing 500ms timeout + main-thread fallback.

### P1 #2: Curated Italian product database (local barcode override)

> **Nota successiva:** funzione rimossa. 23 dei 25 codici EAN-13 avevano la cifra di controllo errata (non erano codici reali e gli scanner non li avrebbero mai letti), pur essendo marcati `verified`.

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

## v1.2.0 — Phase 2 complete (P2 + P3)

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

## v1.1.1

This patch release focuses on **stabilizing and improving the Open Food Facts ingredient search** — the area that generated the most user feedback after v1.1.0. Two fixes:

### OFF search: automatic retry with backoff

> **Nota successiva:** l'auto-retry silenzioso della ricerca testuale è stato rimosso per rispettare il rate limit di Open Food Facts; il retry resta solo per il lookup barcode.

Before this release, the ingredient search frequently reported "You are offline" or "Check your connection" even when the user was online and OFF was just having a transient blip. Retrying a second later worked. Now:

- **Linear backoff retry** (500ms × attempt) on the same OFF instance for transient errors: `NetworkError`, `TimeoutError`, HTTP 5xx, 429. Max 1 retry per instance before falling through to the next one.
- **Silent UI-level auto-retry**: if the first search fails with a transient error, the app retries once automatically after 800ms without showing any error toast. The typical "retry a second later and it works" case is now handled invisibly.
- **Accurate error messages**: previously `NetworkError` (online but OFF unreachable) was reported as "You are offline" — misleading. Now `OfflineError` (genuinely offline, `navigator.onLine === false`) is distinct from `NetworkError` (online but OFF is down) and `TimeoutError` (OFF is slow).
- **Service Worker race condition fixed**: `apiGetJson` was aborting at 8s while the SW `NetworkFirst` strategy waited 10s, preventing cache fallback. The timeout is now aligned at 10s and the global deadline at 20s.
- Applied to text search, barcode scanner, and the recipe ingredient sub-search.

### OFF search: suffix expansion for partial word matches

> **Nota successiva:** funzione rimossa (moltiplicava le richieste verso OFF oltre il rate limit).

OFF with `search_simple=1` does not support partial matching or wildcards (`melanzan*` returns 0 results). So searching "melanzan" (incomplete) returned 0 products even though "melanzane" has 417. Now:

- When the original query returns 0 results **and** does not already end with an Italian suffix, the app tries in parallel the query + each suffix in `PARTIAL_MATCH_SUFFIXES` (`'e'`, `'i'`, `'a'`, `'o'` — ordered by frequency in Italian food product names).
- Returns the result with the most products. If all fail, returns the original empty result.
- **Resilient**: if one suffix fails with a network error, the others still complete (one failure does not block the rest).
- **Pagination-safe**: the effective query is stored in `effectiveQuery` and reused for subsequent pages, so "Load more results" does not break.

Examples: `pasta` → no expansion (already has results). `melanzan` → `melanzane` (417 products). `biscott` → `biscotti` (picks the suffix with the most results).

### Test & quality

229 unit tests pass (+30 new for the retry logic and suffix expansion) — typecheck, lint, format, build all green. The CI GitHub Actions pipeline runs the full suite (typecheck → lint → test → build) on every PR and push.

---

## v1.1.0

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

## v1.0.0

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
