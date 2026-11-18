# Analisi NutriTrack — 18 novembre 2026

Legenda verifica: **[ESEGUITO]** = riprodotto lanciando codice/comandi · **[LETTO]** = verificato leggendo il codice · **[SOSPETTO]** = ipotesi plausibile, non dimostrata.

## Riassunto (5 righe)

1. PWA vanilla TypeScript (Vite 8, localStorage, Open Food Facts) **funzionante**: installazione, typecheck, lint, format, build e PWA contract passano; i test passano tutti su Node 22 (455/455) ma **5 falliscono su Node 26**.
2. Il core `src/lib` è solido e ben testato (circa 79% di coverage). I problemi seri sono pochi e concentrati in tre punti: **capacità dello storage** (si riempie in circa 1–1,5 anni d'uso), **dati falsi** nel "DB italiano verificato" e una **chiave di storage che perde i dati al primo cambio di schema**.
3. Il layer UI (5.800 righe, escluse dalla coverage) ha molta duplicazione: tre sistemi di modali, due UI di ricerca divergenti, la stessa formula ripetuta 8 volte, retry annidati, un worker che non serve.
4. README e commenti descrivono funzioni rimosse (espansione suffissi, auto-retry, debounce, `deploy.yml`): oggi confondono più di quanto aiutino.
5. **Verdetto: tenerlo e sistemarlo, non riscriverlo.** Le fasi 0–3 sono sicure e veloci (circa una giornata). La fase 4 (storage) è l'unica davvero importante per il futuro. Fasi 5–6 opzionali.

---

## 1. Cos'è e come si avvia

- **Scopo**: tracker di calorie e macro privacy-first, tutto nel browser. Diario per pasti, alimenti custom e da Open Food Facts (OFF), ricette, barcode scanner, TDEE, biometria (acqua, sonno, peso), statistiche settimana/mese/anno, gamification, export/import JSON.
- **Stack**: Vite 8.2 (Rolldown), TypeScript 5.9 strict, nessun framework UI (template string + `innerHTML` + event delegation), vite-plugin-pwa (`injectManifest`, SW custom Workbox in `src/sw.ts`), Web Worker per le statistiche, `@zxing/library` per il barcode su iOS, Vitest 4 + jsdom.
- **Struttura**: `src/lib` (dominio, storage, API: 4.486 righe), `src/views` + `src/components` (UI: 5.808 righe), `src/worker`, `src/sw.ts`, `test/` (34 file, 455 test), CI e deploy GitHub Pages in un unico `.github/workflows/ci.yml`.
- **Avvio**: `npm ci` → `npm run dev` (porta 5173) · `npm run build` · `npm run ci` (pipeline completa).

### Cosa ho eseguito e con quale esito

| Passo                                                            | Ambiente                                              | Esito                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm ci`                                                         | Node 26.13.1 / npm 12.2.3                             | OK, 531 pacchetti, 3 avvisi deprecazione, **17 vulnerabilità (1 low, 14 moderate, 2 high)** |
| `npm run typecheck`                                              | Node 26                                               | OK                                                                                          |
| `npm run lint`                                                   | Node 26                                               | OK, 0 errori e 0 warning                                                                    |
| `npm run format:check`                                           | Node 26                                               | OK                                                                                          |
| `npm run test:coverage`                                          | **Node 26**                                           | **FALLISCE: 5 test falliti / 450 passati** (vedi A4)                                        |
| `npm run test:coverage`                                          | Node 22.23.5 (scaricato nello scratchpad, come la CI) | OK, 455/455, coverage `src/lib` 78,9% statements / 74,9% branches                           |
| `npm run build`                                                  | Node 26                                               | OK. Un warning di vite-plugin-pwa: `inlineDynamicImports option is deprecated`              |
| Build con `VITE_BASE_PATH=/Nutritrack/` + controlli PWA della CI | Node 26                                               | OK: manifest iniettato, cache runtime presenti, base path corretto su manifest/icone/asset  |
| `vite` dev server / `vite preview`                               | Node 26                                               | Rispondono 200 su `/`, `/privacy.html`, `/sw.js`                                            |

**Non verificato**: comportamento in un browser reale (nessun test E2E, niente fotocamera) e il comportamento su iOS. Le misure di prestazioni sotto sono fatte in jsdom su desktop: servono a dare l'ordine di grandezza, non sono il tempo reale su un telefono.

---

## 2. Problemi trovati

### Gravità ALTA

#### A1 — Lo storage si riempie dopo circa 1–1,5 anni d'uso, e l'avviso di quota arriva solo dopo il fallimento · [ESEGUITO] + [LETTO]

- **Dove**: `src/lib/storage.ts:248-256` (`writeBackupIfValid` salva una **copia completa** del payload precedente), `src/lib/storage.ts:470-477` e `src/lib/normalize.ts:482-494` (la stima della quota conta **solo** il primario), `src/types.ts` (ogni `DiaryEntry` contiene un `foodSnapshot` completo con URL immagine, porzioni custom, ecc.).
- **Misura**: con un anno di diario, 12 voci al giorno e 300 alimenti, il primario occupa **1.972.864 caratteri**. Il backup ne aggiunge altrettanti, quindi circa 3,9 milioni su una quota tipica di circa 5 milioni per origine (il limite esatto dipende dal browser).
- **Effetto**: al superamento della quota il codice toglie le immagini e riprova; poi va in `fatal` e **disattiva il salvataggio** (`storage.ts:321-330`). L'avviso a 4,5 MB (`STORAGE_WARN_BYTES`) misura solo metà dell'uso reale, quindi in pratica non scatta prima del problema.
- **Correzione**: (1) snapshot ridotto nelle voci del diario (nome, brand, nutrizione, servingSize; via immagine e porzioni) con una migrazione schema v2, che sarebbe il primo uso reale del framework di migrazione; (2) backup non come seconda copia completa in localStorage, ma ruotato in IndexedDB o eliminato a favore dell'export; (3) quota misurata sull'uso reale (somma delle chiavi oppure `navigator.storage.estimate()`).

#### A2 — Un cambio di `SCHEMA_VERSION` fa "sparire" tutti i dati · [LETTO]

- **Dove**: `src/lib/constants.ts:9` → `STORAGE_KEY = nutritrack_data_v${SCHEMA_VERSION}`; `src/lib/storage.ts:436` legge solo quella chiave.
- **Effetto**: passando a `SCHEMA_VERSION = 2` l'app legge `nutritrack_data_v2` (vuota), parte da zero e non esegue mai `migrations.ts`. I dati restano in `_v1`, orfani. È un problema latente, ma la correzione di A1 richiede proprio un cambio di schema.
- **Correzione**: chiave fissa (`nutritrack_data`) e, al boot, lettura una tantum di `nutritrack_data_v1` se la nuova chiave manca. Serve un test dedicato.

#### A3 — Il "database italiano curato e verificato" contiene dati inventati · [ESEGUITO]

- **Dove**: `src/data/it-foods-override.json` (25 prodotti), `src/lib/itOverride.ts`, `src/components/search.ts:506-515`, README §P1 #2.
- **Fatti**: **23 codici EAN-13 su 25 hanno la cifra di controllo errata**, quindi non sono codici reali. 21 sono marcati `"verified": true`. Ci sono incongruenze evidenti: De Cecco, Parmalat e Lavazza con il prefisso aziendale Barilla (`8076809`), "Vodka Russa / brand _Esegui_", "Pasta di Mais Doritos / _Lay's_", Coca-Cola con un prefisso non Coca-Cola.
- **Effetto**: sia BarcodeDetector sia ZXing scartano gli EAN con checksum errato, quindi **la funzione in pratica non scatta mai** (codice morto). In più presenta come "verificati" valori nutrizionali non verificati. `test/itOverride.test.ts` consolida questi dati falsi.
- **Correzione**: eliminare JSON, modulo, ramo in `search.ts`, test e sezione del README. In alternativa, ripopolarlo solo con prodotti realmente controllati e aggiungere un test che validi la checksum EAN.

#### A4 — La suite di test fallisce su Node ≥ 25, mentre il README dice "Node 22.12 o successivo" · [ESEGUITO]

- **Dove**: `test/setup.ts:38-41`; i test falliti sono in `test/storage.test.ts:161,186`, `test/audit-consolidation.test.ts:31`, `test/audit-integrity.test.ts`, `test/multitab-sync.test.ts`.
- **Causa verificata**: su Node 26 il global `localStorage` nativo di Node (indefinito senza `--localstorage-file`) copre quello di jsdom. Il setup installa quindi `LocalStorageMock`, che **non eredita da `Storage`**, e i test che fanno `vi.spyOn(Storage.prototype, 'setItem')` non intercettano niente. Con una sonda ho verificato che il costruttore effettivo è `LocalStorageMock` e che `instanceof Storage` vale `false`. Su Node 22 tutto passa.
- **Effetto**: `npm run ci` fallisce sulla tua macchina; manca un `engines` o `.nvmrc` che lo segnali.
- **Correzione**: nei test spiare l'istanza (`vi.spyOn(localStorage, 'setItem')`) o il prototipo reale (`Object.getPrototypeOf(localStorage)`); aggiungere `"engines"` e `.nvmrc`; aggiungere alla CI una matrice Node 22/24 (o la LTS corrente).

### Gravità MEDIA

#### M1 — Ogni `emitChange` (anche un tasto premuto nella ricerca) rilegge e rivalida tutto lo storage e ricostruisce l'intera dashboard · [ESEGUITO] + [LETTO]

- **Dove**: `src/lib/storage.ts:483-493` (l'autosave è iscritto a _ogni_ emit); `src/lib/storage.ts:378-417` (`getItem` + `JSON.parse` + migrazione + `reconcileAll` del documento precedente **prima** del controllo `_lastSyncedStateSignature === signature`); `src/components/renderer.ts:107-112` e `src/views/dashboard.ts:92` (`main.innerHTML` completo, più streak, badge e "recenti" ricalcolati su tutto il diario a ogni render); `src/components/search.ts:401-417` (emit a ogni tasto).
- **Misura** (un anno di dati, jsdom): salvataggio che non cambia niente **circa 23 ms**, render della dashboard **circa 13 ms**, quindi circa 36 ms per evento, oltre il budget di un frame. Il costo cresce linearmente con lo storico; su un telefono **[SOSPETTO]** sarà 2–4 volte tanto.
- **Correzione**: uscita anticipata in `saveData` quando la firma è invariata (senza leggere lo storage); persistere solo alle mutazioni di dominio, non per lo stato UI; non ricostruire la vista sotto un modale quando cambia solo il modale.

#### M2 — Il limite di ricerche lato client viene mostrato come "OFF non disponibile" · [ESEGUITO]

- **Dove**: `src/lib/api.ts:271-279` lancia `RateLimitError` con status 429; `src/lib/food-search.ts:47` lo classifica come `unavailable`; `src/components/search.ts:106-114` mostra "Database Open Food Facts temporaneamente non disponibile…".
- **Riprodotto**: alla 10ª ricerca in un minuto l'errore risulta `kind=unavailable`, e il messaggio corretto ("Troppe ricerche ravvicinate…") va perso.
- **Correzione**: aggiungere un tipo `rate_limited` con il suo messaggio; togliere la classificazione per sottostringhe del messaggio (`food-search.ts:49-52`), che è fragile.

#### M3 — Retry annidati sul barcode: fino a 20 richieste per una singola scansione · [ESEGUITO]

- **Dove**: `src/lib/api.ts:112-245` (5 istanze × 2 tentativi) avvolto da `withSingleRetry` in `src/lib/food-search.ts:83-99,163`.
- **Riprodotto**: con OFF che risponde 503 si ottengono **20 fetch e 5,8 s** prima dell'errore. Se le richieste vanno in timeout invece di fallire subito, l'attesa arriva a circa 40 s (due deadline globali da 20 s).
- **Correzione**: un solo livello di retry. Togliere `withSingleRetry` per il barcode, oppure ridurre le istanze.

#### M4 — Due UI di ricerca alimenti con comportamenti diversi · [LETTO]

- **Dove**: `src/components/search.ts:125-163` (ricerca esplicita con pulsante "Cerca", `italianOnly: true`) contro `src/views/recipe-editor.ts:443-549` (ricerca automatica a ogni tasto con debounce di 500 ms, **senza** filtro Italia, messaggi d'errore duplicati).
- **Effetto**: la ricerca degli ingredienti consuma il limite di 9 ricerche al minuto mentre si digita (e quindi scatena M2) e restituisce risultati diversi per la stessa query. In più tab, lista, risultati e gestione errori sono implementati due volte.
- **Correzione**: un unico componente o controller di ricerca riusato da entrambi, con una sola politica (esplicita).

#### M5 — Gli aggiornamenti del Service Worker non si applicano finché tutte le istanze dell'app non vengono chiuse · [LETTO] + [SOSPETTO] sull'effetto iOS

- **Dove**: `src/sw.ts:105-109` ascolta `SKIP_WAITING`, ma nessuno lo invia; `src/main.ts:99-118` non gestisce `onNeedRefresh`.
- **Effetto**: il nuovo SW resta in attesa. Su una PWA iOS che resta in memoria, l'utente può restare a lungo su una versione vecchia.
- **Correzione**: `registerType: 'autoUpdate'`, oppure un toast "Nuova versione disponibile" che chiama `updateSW(true)`.

#### M6 — Il Web Worker delle statistiche aggiunge complessità senza beneficio misurabile · [LETTO] + [SOSPETTO] sul beneficio

- **Dove**: `src/worker/client.ts`, `src/worker/stats.worker.ts`, `src/views/dashboard-state.ts:49`, `src/types.ts:281-284`.
- **Fatti**: per la vista "anno" si clonano verso il worker fino a 365 giorni di voci complete di snapshot; se la risposta supera i 500 ms si ricalcola comunque sul main thread. Il ramo `dayTotals` non viene mai chiamato (codice morto). Il calcolo in sé è una somma su qualche migliaio di elementi.
- **Correzione**: chiamare `computeStats` in modo sincrono (con memoizzazione, che esiste già in `dashboard-state.ts`) ed eliminare worker, client, tipi e test relativi. Va misurato prima.

#### M7 — Quattro meccanismi diversi per i dialoghi · [LETTO]

- **Dove**: dialoghi guidati dallo store e ricostruiti dal renderer (`renderer.ts:143-330`); `showModal` imperativo con callback (`modal.ts`); shell custom della ricerca (`search.ts:644`); overlay custom dell'help tastiera (`keyboardShortcuts.ts:97-149`); `confirm()` nativo in 4 punti (`exportImport.ts:48`, `search.ts:226,239,310`, `settings.ts:514`).
- **Effetto**: focus, ESC e chiusura sono gestiti in modo diverso caso per caso, ed è la fonte storica di molti dei bug "fix B-x" nei commenti.
- **Correzione**: convergere su un solo meccanismo (stato dialog nello store + `showModal`) e sostituire `confirm()` con il modale di conferma che esiste già.

#### M8 — Logica duplicata (stesso problema risolto in modi diversi) · [LETTO]

- Grammi di una voce `gramsOverride ?? servingSize * quantity`: 8 copie in `clipboard.ts:56,77,84`, `statistics.ts:17`, `entry-editor.ts:48`, `dashboard.ts:46,59,606`. Serve un helper `entryGrams()` / `entryNutrition()` in `nutrition.ts`.
- Creazione ed eliminazione delle porzioni custom: 3 implementazioni (`lib/foods.ts:158-191`, `search.ts:601-640`, `entry-editor.ts:315-367`).
- Due funzioni `normalizeMacroSplit` con lo stesso nome e firme diverse (`normalize.ts:124`, `nutrition.ts:256`, con alias all'import).
- Totali della ricetta calcolati due volte in `recipe-editor.ts:383-413` e `416-441`; `renderConfirmDeleteFood` e `renderConfirmDeleteRecipe` quasi identici (`renderer.ts:185-272`).
- Due fetch wrapper con classificazione degli errori duplicata (`api.ts:85-254` e `281-324`) e due `sleep` abortibili (`api.ts:46`, `food-search.ts:60`).

#### M9 — README e documentazione non allineati al codice · [LETTO]

- Cita `.github/workflows/deploy.yml`, che non esiste più (il deploy è in `ci.yml`).
- v1.1.1 descrive l'**espansione per suffissi** e l'**auto-retry silenzioso** della ricerca testuale: entrambi rimossi (`api.ts:376` lo dice esplicitamente; `food-search.ts:116`: "Text search is never retried automatically"). `PARTIAL_MATCH_SUFFIXES` è morto.
- "Timeout allineato a 10 s", ma `API_TIMEOUT_MS` vale 11 s. "Ricerca OFF con debounce", ma la ricerca principale è esplicita. "Multi-tab sync: skip se modal aperto": non è più così.
- L'albero delle cartelle manca di `entry-editor.ts`, `dashboard-state.ts`, `food-search.ts`, `migrations.ts`, `localData.ts`, `itOverride.ts` e altri, e cita funzioni inesistenti (`createCustomFood`, `createRecipe`).
- Conteggi dei test vecchi (199/287/340 contro 455). Metà README è changelog, in un misto di italiano e inglese. Il requisito "Node 22.12 o successivo" è falso (A4).
- **Correzione**: README corto e aggiornato, `CHANGELOG.md` separato.

#### M10 — La coverage dà un'immagine falsata · [ESEGUITO]

- `vitest.config.ts:15` include solo `src/lib/**`. Le 5.808 righe di views e components (dove stanno M4, M7, M8 e B1) sono escluse. Anche dentro `lib`: `barcode.ts` 27%, `recipes.ts` 0%.
- **Correzione**: includere tutto `src/` nel report, con soglie separate per lib e UI, così il dato è onesto.

#### M11 — Dipendenze · [ESEGUITO]

- `npm audit`: 17 vulnerabilità, **tutte nella toolchain di sviluppo e build** (vite 8.2.2 high: dev server e launch-editor; vitest/@vitest/mocker; source-map-js high; glob/minimatch via workbox-build; serialize-javascript). Nessuna finisce nel bundle runtime. `npm audit fix` (senza `--force`) ne risolve la maggior parte (vite → 8.3.8, vitest → 4.1.12, source-map-js, fast-uri, serialize-javascript). glob/minimatch dipendono da workbox-build e da vite-plugin-pwa 2.x (major).
- `vite-plugin-pwa` e `workbox-*` sono in `dependencies`, ma servono solo in fase di build (i moduli workbox vengono inclusi nel bundle del SW). `workbox-build` non è importato direttamente.
- Versioni major disponibili, da valutare senza fretta: TypeScript 7, ESLint 10, Vitest 5, jsdom 31, vite-plugin-pwa 2.

### Gravità BASSA

- **B1 — Codice morto** [LETTO, con grep sui riferimenti]: `clearAllStoredData` (`storage.ts:650`), `getFood`, `getDiaryForDate`, `getRecipe`, `getBiometric`, `setAllBiometrics` (`store.ts:193,314,364,371,407`), alias `getStoreState` (`store.ts:45`), `searchOffWithPartialMatch` e `SearchOffResult` (`api.ts:377-388`, usati solo dai test), export `isTransientError` (`api.ts:420`, solo test), `PARTIAL_MATCH_SUFFIXES` e `MAX_FOODS_BEFORE_PRUNE` (`constants.ts:40,64`), `getLatestWeight` (`biometrics.ts:181`, solo test), `closeBarcodeScanner` (solo test), getter `getItOverride*` (solo test), ramo `dayTotals` del worker. `lib/recipes.ts` e i wrapper `toggleFoodFavorite` e `removeDiaryEntry` sono passacarte di una riga.
- **B2 — Commenti storici e contraddittori**: in decine di punti compaiono "Fix B-8-x (T8)" e "Fix Bug #15 (T1)". `api.ts:3,8` dice che invia `User-Agent` e che il timeout è di 10 s, mentre righe sotto dice di averlo rimosso e la costante vale 11 s. `search.ts:1,197` parla di un debounce che non esiste. Fanno rumore e ingannano chi legge.
- **B3 — File e branch orfani**: `nutritrack-roadmap-hobby.html` (55 KB nella root, non referenziato), `STRATEGIC_AUDIT_ROADMAP.md` e `docs/audit-2026-09-30.md` (documenti di processo dei passaggi AI precedenti), 10 branch remoti stantii (`audit/*`, `bughunt/*`, `strategic-audit-remediation`, ecc.). In `.prettierignore` il commento su `vite-env.d.ts` "auto-generato" è falso: il file è scritto a mano.
- **B4 — Porzioni create durante la ricerca perse in silenzio** [LETTO]: `search.ts:584-597` le allega a un alimento OFF non salvato, ma `saveOffFood` (`foods.ts:117-119`) restituisce l'alimento già esistente con lo stesso barcode e scarta le porzioni.
- **B5 — Effetti collaterali nell'editor ricette** [LETTO]: `recipe-editor.ts:579` salva l'alimento OFF in libreria già quando lo scegli, anche se poi annulli la ricetta.
- **B6 — Limite di import incoerente** [LETTO]: `exportImport.ts:15` accetta file fino a 50 MB, ma con lo storage attuale (A1) un import oltre circa 2,5 MB fallisce comunque.
- **B7 — CSP e viewport** [LETTO]: `index.html:7` include `ws://localhost:*` anche in produzione; `user-scalable=no, maximum-scale=1` (riga 5) impedisce lo zoom (accessibilità).
- **B8 — Id instabili per voci legacy senza id** [LETTO]: `normalize.ts:222` genera un nuovo `safeId` a ogni riconciliazione, quindi la firma cambia e partono scritture inutili. Riguarda solo dati vecchi.

### Sicurezza

- **Segreti** [ESEGUITO]: ho cercato nella cronologia completa (166 commit, tutti i branch) API key, token, chiavi private, pattern `ghp_`, `sk-`, `AKIA`, `AIza` e file `.env` o credenziali. **Non ho trovato niente.** L'app non usa chiavi (OFF è pubblico).
- **XSS** [LETTO]: tutte le interpolazioni di stringhe utente nei template passano da `escapeHtml` o `escapeAttr`; le URL delle immagini sono filtrate da `safeImageUrl` (solo http/https). L'import JSON passa sempre da `normalize`. Unica nota (bassa): un backup importato può contenere URL di immagini verso qualunque host https, mentre la privacy policy dice che le uniche chiamate esterne sono verso OFF.
- **Input**: le quantità sono validate nello store (`store.ts:218-225`); i numeri importati sono limitati da `safeNum`. Non ho trovato input non validati con impatto reale.

### Test

- Sono test veri (asserzioni significative, nessun `expect(true)`), con buona copertura del dominio, dello storage e del multi-tab. I punti deboli sono: A4 (dipendenza dalla versione di Node), M10 (UI esclusa dalla coverage), `itOverride.test.ts` che consolida dati falsi (A3), file organizzati per "audit" storico (`audit-consolidation`, `audit-integrity`) invece che per modulo, e un solo smoke test di flusso UI (`app-smoke.test.ts`).

---

## 3. Piano di pulizia (dal più sicuro al più invasivo)

| Fase                                          | Contenuto                                                                                                                                                                                                                                                              | Rischio                                                             | Stima        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| **0 — Toolchain verde ovunque**               | A4 (correggere setup e spy, aggiungere `engines` e `.nvmrc`, matrice Node in CI); `npm audit fix` senza `--force`; spostare `vite-plugin-pwa` e `workbox-*` in devDependencies                                                                                         | Molto basso                                                         | 30–60 min    |
| **1 — Rimuovere ciò che non serve o inganna** | A3 (eliminare il DB IT falso, o rifarlo con validazione della checksum); B1 codice morto; B2 commenti storici; B3 file orfani (+ elenco dei branch remoti da cancellare, **su tua conferma**)                                                                          | Basso (i test coprono)                                              | 1–2 h        |
| **2 — Documentazione**                        | M9: README corto e vero, `CHANGELOG.md` separato, sezione su requisiti e limiti di storage                                                                                                                                                                             | Nullo                                                               | 1 h          |
| **3 — Bug piccoli e mirati**                  | M2 (messaggio sul rate limit), M3 (un solo livello di retry), M5 (aggiornamento del SW), B4, B5, B6, B7; M10 (coverage su tutto `src`). Ognuno con il suo test                                                                                                         | Basso                                                               | 2–4 h        |
| **4 — Storage (la fase che conta)**           | A2 (chiave fissa + migrazione dalla legacy `_v1`), M1 (uscita anticipata in `saveData`, persistere solo le mutazioni di dominio), A1 (schema v2 con snapshot ridotto, backup non duplicato, quota misurata sull'uso reale). Test di migrazione su dati reali esportati | Medio (tocca i dati utente: prima serve un export di backup)        | 0,5–1 giorno |
| **5 — Semplificazione UI**                    | M4 (un solo componente di ricerca), M8 (helper `entryGrams`, porzioni, conferme), M7 (un solo sistema di dialog, via `confirm()`), M6 (togliere il worker dopo averlo misurato), render mirato della dashboard                                                         | Medio (UI senza coverage: va aggiunto qualche test di flusso prima) | 1–2 giorni   |
| **6 — Opzionale**                             | Passare lo storage a IndexedDB (elimina il tetto dei circa 5 MB); aggiornamenti major (TS 7, ESLint 10, Vitest 5, vite-plugin-pwa 2)                                                                                                                                   | Alto                                                                | 2–4 giorni   |

Consiglio di eseguire **0 → 1 → 2 → 3** come blocco unico, perché sono sicure e indipendenti tra loro. Poi la **4**, che è l'unica con impatto reale sul futuro dell'app. La 5 si fa solo se pensi di continuare a sviluppare la UI.

---

_Nota sull'analisi: nel repository non ho modificato nessun file tracciato. Sono stati creati solo `node_modules/`, `dist/` e `coverage/`, già in `.gitignore`. Le sonde di verifica (test temporanei e Node 22) stanno nello scratchpad della sessione, fuori dal progetto._
