// Proposta di aggiornamento quando un nuovo service worker è in attesa.
// Senza questa scelta esplicita il nuovo SW resterebbe in attesa finché tutte le
// istanze dell'app non vengono chiuse (su iOS la PWA può restare in memoria a lungo).

import { showModal } from './modal';

/** Applica il SW in attesa e ricarica la pagina (firma di `updateSW` di vite-plugin-pwa). */
export type ApplyUpdate = (reloadPage?: boolean) => Promise<void>;

export function promptForUpdate(applyUpdate: ApplyUpdate): void {
  showModal({
    modalId: 'app-update',
    title: 'Nuova versione disponibile',
    bodyText:
      'È pronta una nuova versione di NutriTrack. Aggiornando, la pagina viene ricaricata: i dati salvati restano, ma un modulo aperto e non salvato andrebbe perso.',
    actions: [
      { label: 'Più tardi', action: 'close', variant: 'outline' },
      { label: 'Aggiorna', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      void applyUpdate(true);
    },
  });
}
