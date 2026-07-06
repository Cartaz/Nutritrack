// Entry point: init store, load data, bind events, register SW (prod only), first render.

import './styles/main.css';
import { subscribe, getState } from './lib/store';
import { loadData, enableAutoSave, initMultiTabSync, isStorageAvailable, shouldWarnQuota } from './lib/storage';
import { setStorageDisabled } from './lib/store';
import { render, bindGlobalEvents, applyInitialTheme } from './components/renderer';
import { showToast } from './components/toast';
import { showModal } from './components/modal';
import { terminateWorker } from './worker/client';

function init(): void {
  // 1. Storage detection + load
  if (!isStorageAvailable()) {
    setStorageDisabled(true);
    showModal({
      modalId: 'storage-disabled',
      title: 'Modalità privata',
      bodyHtml: '<p>Il salvataggio non è disponibile in questa sessione (modalità privata o storage disabilitato). I dati non verranno persistiti tra le sessioni.</p>',
      actions: [{ label: 'OK', action: 'close', variant: 'primary' }],
      sticky: true,
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
