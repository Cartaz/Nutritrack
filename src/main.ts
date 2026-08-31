// Entry point: init store, load data, bind events, register SW (prod only), first render.

import './styles/main.css';
import { subscribe, getState, setCurrentDate } from './lib/store';
import { loadData, enableAutoSave, initMultiTabSync, isStorageAvailable, shouldWarnQuota } from './lib/storage';
import { setStorageDisabled } from './lib/store';
import { render, bindGlobalEvents, applyInitialTheme } from './components/renderer';
import { showToast } from './components/toast';
import { showModal } from './components/modal';
import { terminateWorker } from './worker/client';
import { shouldAutoAdvanceDate, toDateKey } from './lib/utils';
import { initKeyboardShortcuts } from './lib/keyboardShortcuts';

function init(): void {
  // 1. Storage detection + load
  if (!isStorageAvailable()) {
    setStorageDisabled(true);
    showModal({
      modalId: 'storage-disabled',
      title: 'Modalità privata',
      bodyHtml:
        '<p>Il salvataggio non è disponibile in questa sessione (modalità privata o storage disabilitato). I dati non verranno persistiti tra le sessioni.</p>',
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
  // P2 #3: keyboard shortcuts desktop (idempotente)
  initKeyboardShortcuts();

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

  // Avanza automaticamente al nuovo giorno solo se l'app attraversa davvero la mezzanotte
  // mentre il dashboard era ancora sul giorno precedente. Se l'utente sta consultando
  // intenzionalmente una data storica, focus/visibility non devono riportarlo a oggi.
  let lastObservedToday = toDateKey(new Date());
  const checkMidnightRollover = (): void => {
    const today = toDateKey(new Date());
    if (shouldAutoAdvanceDate(getState().currentDate, lastObservedToday, today)) {
      setCurrentDate(today);
    }
    lastObservedToday = today;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkMidnightRollover();
  });
  window.addEventListener('focus', checkMidnightRollover);
  const scheduleMidnightCheck = (): void => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();
    setTimeout(() => {
      checkMidnightRollover();
      scheduleMidnightCheck();
    }, msUntilMidnight + 1000);
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
            60 * 60 * 1000,
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
