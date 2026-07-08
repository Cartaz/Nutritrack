// Entry point: init store, load data, bind events, register SW (prod only), first render.

import './styles/main.css';
import { subscribe, getState, setCurrentDate } from './lib/store';
import { loadData, enableAutoSave, initMultiTabSync, isStorageAvailable, shouldWarnQuota } from './lib/storage';
import { setStorageDisabled } from './lib/store';
import { render, bindGlobalEvents, applyInitialTheme } from './components/renderer';
import { showToast } from './components/toast';
import { showModal } from './components/modal';
import { terminateWorker } from './worker/client';
import { toDateKey } from './lib/utils';

function init(): void {
  // 1. Storage detection + load
  if (!isStorageAvailable()) {
    setStorageDisabled(true);
    showModal({
      modalId: 'storage-disabled',
      title: 'Modalità privata',
      bodyHtml: '<p>Il salvataggio non è disponibile in questa sessione (modalità privata o storage disabilitato). I dati non verranno persistiti tra le sessioni.</p>',
      actions: [{ label: 'OK', action: 'close', variant: 'primary' }],
    });
  } else {
    loadData();
    enableAutoSave();
    initMultiTabSync();
    if (shouldWarnQuota()) {
      showToast('Spazio di archiviazione quasi esaurito. Esporta un backup.', 'warning', 6000);
    }
  }

  // 2. Tema
  applyInitialTheme();

  // 3. Bind events globali
  bindGlobalEvents();

  // 4. Subscribe per re-render su ogni change
  subscribe(render);

  // 5. First render
  render();

  // 6. Service Worker (solo in produzione)
  if (import.meta.env.PROD) {
    void registerSW();
  }

  // 7. Cleanup su unload
  window.addEventListener('beforeunload', () => {
    terminateWorker();
  });

  // Fix 2.12 (T2): auto-advance della data a mezzanotte + su visibilitychange/focus.
  // Se l'app resta aperta overnight, state.currentDate resta su ieri → badge "Oggi" sbagliato,
  // nuove entry vanno alla data sbagliata, week stats non includono il nuovo giorno.
  const checkMidnightRollover = (): void => {
    const today = toDateKey(new Date());
    if (getState().currentDate !== today) {
      setCurrentDate(today);
    }
  };
  // Check su visibilitychange (tab torna attivo)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkMidnightRollover();
  });
  // Check su focus (window torna in primo piano)
  window.addEventListener('focus', checkMidnightRollover);
  // Timer che scatta a mezzanotte (setTimeout calcolato al primo caricamento)
  const scheduleMidnightCheck = (): void => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // prossima mezzanotte
    const msUntilMidnight = midnight.getTime() - now.getTime();
    setTimeout(() => {
      checkMidnightRollover();
      scheduleMidnightCheck(); // rischedule per il giorno dopo
    }, msUntilMidnight + 1000); // +1s per sicurezza
  };
  scheduleMidnightCheck();
}

async function registerSW(): Promise<void> {
  try {
    const { registerSW: registerVitePWA } = await import('virtual:pwa-register');
    registerVitePWA({
      immediate: true,
      onRegistered(registration) {
        // Check aggiornamenti ogni ora
        if (registration) {
          setInterval(
            () => {
              void registration.update();
            },
            60 * 60 * 1000
          );
        }
      },
      onRegisterError(error) {
        console.warn('[pwa] SW registration failed', error);
      },
    });
  } catch (e) {
    console.warn('[pwa] SW module non disponibile', e);
  }
}

// Boot
init();

// Esponi stato per debug in dev
if (import.meta.env.DEV) {
  (window as unknown as { __nutritrack?: unknown }).__nutritrack = { getState };
}
