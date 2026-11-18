// Export/Import del backup JSON. Export: Blob + download. Import: conferma utente,
// lettura file e validazione tramite storage.importDataJson (migrazione + normalize).

import { exportDataJson, importDataJson } from '../lib/storage';
import { showToast } from './toast';

/** Limite massimo file import (50MB) per evitare freeze UI su JSON.parse. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function handleExport(): void {
  const data = exportDataJson();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // filename con time per evitare collisioni same-day
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  a.download = `nutritrack-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke più lungo (10s) per permettere download completi su device lenti
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  showToast('Backup esportato', 'success');
}

export function handleImport(file: File): void {
  // size guard per evitare freeze UI
  if (file.size > MAX_IMPORT_BYTES) {
    showToast(
      `File troppo grande (${Math.round(file.size / 1024 / 1024)}MB). Massimo ${MAX_IMPORT_BYTES / 1024 / 1024}MB.`,
      'error',
      6000,
    );
    return;
  }

  // chiedi conferma prima di sovrascrivere dati esistenti
  // (importDataJson fa replace completo dello state + localStorage)
  if (
    !confirm(
      "L'importazione sostituirà tutti i dati attuali (alimenti, ricette, diario, impostazioni). Vuoi continuare?",
    )
  ) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = importDataJson(String(reader.result || ''));
    if (result.ok) {
      // messaggio distinto per count=0 (es. file con solo settings)
      if (result.count === 0) {
        showToast(
          'Import completato, ma nessun alimento/ricetta/entry trovato nel file (solo impostazioni?)',
          'info',
          4000,
        );
      } else {
        let msg = `Backup importato (${result.count} elementi)`;
        // mostra scarti se reconcileAll ha filtrato entità malformate
        if (result.skipped && result.skipped > 0) {
          msg += ` · ${result.skipped} elementi scartati (dati malformati)`;
        }
        showToast(msg, 'success', 3500);
      }
      // reload ritardato a 1500ms per lasciare leggere il toast
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(`File non valido: ${result.error}`, 'error', 5000);
    }
  };
  reader.onerror = () => showToast('Errore lettura file', 'error');
  reader.readAsText(file);
}
