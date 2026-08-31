// Entry point: init store, load data, bind events, register SW (prod only), first render.

import './styles/main.css';
import { getState, setCurrentDate, setStorageDisabled, subscribe } from './lib/store';
import { enableAutoSave, initMultiTabSync, isStorageAvailable, loadData, shouldWarnQuota } from './lib/storage';
import { applyInitialTheme, bindGlobalEvents, render } from './components/renderer';
import { showToast } from './components/toast';
import { showModal } from './components/modal';
import { terminateWorker } from './worker/client';
import { toDateKey } from './lib/utils';
import { initKeyboardShortcuts } from './lib/keyboardShortcuts';

function init(): void {
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

  applyInitialTheme();
  bindGlobalEvents();
  initKeyboardShortcuts();
  subscribe(render);
  render();

  if (import.meta.env.PROD) void registerSW();

  window.addEventListener('beforeunload', () => {
    terminateWorker();
  });

  // Auto-advance solo se l'utente era rimasto sulla data che era "oggi".
  // Una data storica scelta intenzionalmente non viene più persa su focus/visibilitychange.
  let lastKnownToday = toDateKey(new Date());
  const checkMidnightRollover = (): void => {
    const today = toDateKey(new Date());
    if (today === lastKnownToday) return;
    const selectedDate = getState().currentDate;
    const wasFollowingToday = selectedDate === lastKnownToday;
    lastKnownToday = today;
    if (wasFollowingToday) setCurrentDate(today);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkMidnightRollover();
  });
  window.addEventListener('focus', checkMidnightRollover);

  const scheduleMidnightCheck = (): void => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    setTimeout(() => {
      checkMidnightRollover();
      scheduleMidnightCheck();
    }, midnight.getTime() - now.getTime() + 1000);
  };
  scheduleMidnightCheck();
}

async function registerSW(): Promise<void> {
  try {
    const { registerSW: registerVitePWA } = await import('virtual:pwa-register');
    registerVitePWA({
      immediate: true,
      onRegistered(registration) {
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

init();

if (import.meta.env.DEV) {
  (window as unknown as { __nutritrack?: unknown }).__nutritrack = { getState };
}
