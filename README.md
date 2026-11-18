# NutriTrack PWA

Tracker di calorie e macro **privacy-first** che funziona interamente nel browser: nessun account, nessun server, nessun tracker. Si installa come app su iOS (Aggiungi a Home), Android e desktop e funziona offline.

Le novità di ogni versione sono in [CHANGELOG.md](CHANGELOG.md).

## Funzionalità

- **Diario giornaliero** su 4 pasti (colazione, pranzo, cena, spuntino), con anello calorie, barre dei macro e navigazione tra i giorni.
- **Alimenti**: ricerca su [Open Food Facts](https://world.openfoodfacts.org) (OFF), alimenti custom con valori per 100 g (le kcal si possono calcolare dai macro), preferiti, porzioni personalizzate.
- **Barcode scanner** con la fotocamera: `BarcodeDetector` nativo dove esiste, `@zxing/library` su Safari iOS (caricata solo quando serve). Ordine di ricerca: prima i tuoi alimenti salvati, poi OFF.
- **Ricette** con ingredienti, calcolo per porzione e aggiunta al diario in un colpo solo.
- **Statistiche** su settimana, mese e anno (heatmap annuale) e trend del peso.
- **Biometria giornaliera**: acqua, sonno, peso.
- **Aggiunta rapida** degli alimenti usati di recente, **copia** del diario o di una ricetta come testo, **scorciatoie da tastiera** su desktop (`/`, `d`, `f`, `r`, `s`, `?`), **streak e badge**.
- **Impostazioni**: obiettivo calorico, ripartizione dei macro con preset, calcolatore TDEE (Mifflin-St Jeor), obiettivo di peso (stima lineare, massimo 0,5 kg/settimana: non è una valutazione clinica, vedi la [policy](docs/sources/goal-calorie-policy.md)), tema, export/import JSON, reset.

### Ricerca su Open Food Facts

- La ricerca testuale parte solo quando premi **Cerca** o Invio, sia nel dialog "Aggiungi al diario" sia nella ricerca ingredienti delle ricette: una azione corrisponde a una richiesta, filtrata sui prodotti venduti in Italia. OFF limita le ricerche a 10 al minuto per IP; l'app si ferma a 9 e, se le superi, te lo dice.
- La ricerca testuale non ha retry automatici. Il lookup per barcode prova più istanze OFF, con un retry per istanza sugli errori temporanei.

## Stack

Vite 8 · TypeScript 6 strict · nessun framework UI (template HTML + event delegation) · vite-plugin-pwa (`injectManifest`, service worker Workbox in `src/sw.ts`) · Vitest + jsdom · GitHub Actions + GitHub Pages.

## Requisiti

Node **22.22+, 24.15+ o 26+** (richiesto da ESLint 10 e jsdom 31; testato in CI su 22, 24 e 26). Il file `.nvmrc` indica la versione usata per la build.

## Sviluppo

```bash
npm ci                 # installa le dipendenze
npm run dev            # dev server su http://localhost:5173
npm test               # test (Vitest)
npm run test:coverage  # test + coverage con soglie
npm run lint           # ESLint
npm run format         # Prettier (format:check per la sola verifica)
npm run build          # typecheck + build di produzione in dist/
npm run preview        # serve la build locale
npm run ci             # pipeline completa: typecheck, lint, format, coverage, build
```

Il service worker è attivo solo nella build di produzione (`npm run build && npm run preview`).

## Struttura

```
src/
├── main.ts            # avvio: caricamento dati, autosave, sync tra tab, render, service worker
├── sw.ts              # service worker: precache dell'app + cache runtime per OFF e immagini
├── types.ts           # tipi di dominio, tipi OFF, stato dell'app
├── lib/               # logica senza DOM (o quasi): store, persistenza, API, calcoli
│   ├── store.ts       #   stato in memoria + mutazioni + emissione cambi (batch su RAF)
│   ├── storage.ts     #   persistenza, backup, quota, sync tra tab, export/import
│   ├── migrations.ts  #   migrazioni dello schema dati persistito
│   ├── normalize.ts   #   validazione di ogni dato esterno (storage, import, OFF)
│   ├── api.ts         #   client Open Food Facts
│   ├── food-search.ts #   ricerca alimenti e lookup barcode a livello di dominio
│   ├── nutrition.ts   #   calcoli nutrizionali, TDEE, obiettivi
│   ├── statistics.ts  #   aggregazioni per le statistiche
│   └── ...            #   diario, alimenti, ricette, biometria, gamification, clipboard, ...
├── components/        # renderer, modali, sessione di ricerca condivisa, scanner, toast, export/import
├── views/             # viste (dashboard, alimenti, ricette, impostazioni) ed editor
└── styles/main.css
test/                  # test Vitest (jsdom)
docs/                  # semantica della sync tra tab, policy degli obiettivi, roadmap
```

## Persistenza dei dati

- Tutti i dati stanno nel `localStorage` del browser, sotto la chiave `nutritrack_data`, con una copia di backup dello snapshot precedente in `nutritrack_data_backup`. I dati di versioni vecchie (`nutritrack_data_v1`) vengono migrati al primo avvio.
- Lo schema è versionato dentro il documento (`version`, oggi 2): i documenti vecchi vengono migrati da `migrations.ts` e poi validati da `normalize.ts`.
- Lo spazio disponibile è di circa 5 milioni di caratteri per origine; un anno di uso intenso (12 voci al giorno) occupa circa 1,6 milioni. L'avviso scatta all'80% dell'uso reale (primario + backup).
- Se lo spazio finisce, l'app sacrifica prima il backup automatico, poi le immagini; se non basta, disattiva il salvataggio e ti chiede di esportare un backup.
- In modalità privata o con lo storage disabilitato l'app funziona solo in memoria e lo segnala.
- Più tab aperte restano sincronizzate tramite revisioni: vedi [docs/multitab-sync.md](docs/multitab-sync.md).
- **Esporta regolarmente un backup** da Impostazioni: è l'unica copia fuori dal browser.

## Deploy

Ogni push su `main` esegue la CI (`.github/workflows/ci.yml`): typecheck, lint, format, test con coverage, build e verifica degli asset PWA. Solo se tutto passa, la stessa build viene pubblicata su GitHub Pages, con il base path ricavato dal nome del repository. Su GitHub serve **Settings → Pages → Source: GitHub Actions**.

Per un altro hosting statico: `VITE_BASE_PATH=/percorso/ npm run build` e pubblica `dist/`. Il service worker richiede HTTPS (o localhost).

## Installazione come app

- **iOS (Safari)**: Condividi → Aggiungi alla schermata Home.
- **Android (Chrome)**: menu ⋮ → Installa app.
- **Desktop (Chrome/Edge)**: icona Installa nella barra degli indirizzi.

Quando esce una nuova versione l'app la scarica in background e ti chiede se aggiornare (la pagina viene ricaricata).

## Privacy

I dati non lasciano il dispositivo. Le uniche richieste di rete sono quelle verso Open Food Facts (ricerche, barcode, immagini dei prodotti): anche le immagini sono accettate solo da lì. Niente cookie, niente analytics, niente account. Lo scanner elabora i frame video localmente e non salva immagini. L'informativa completa è in [`public/privacy.html`](public/privacy.html), raggiungibile anche da Impostazioni.

## Licenza

Codice sotto licenza [MIT](LICENSE). Dati nutrizionali di [Open Food Facts](https://world.openfoodfacts.org) (licenza ODbL).
