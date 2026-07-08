// Export/Import JSON backup.
// Export: crea Blob e trigger download. Import: file input + validazione via normalize.
//
// Fix B6.9 (T6): count=0 mostra messaggio info diverso da success.
// Fix B6.10 (T6): revokeObjectURL con timeout più lungo (10s) e listener su click.
// Fix B6.11 (T6): import chiede conferma prima di sovrascrivere dati esistenti.
// Fix B6.13 (T6): filename include time (no collisioni same-day).
// Fix B6.14 (T6): reload ritardato a 1500ms per lasciare leggere il toast.
// Fix B6.15 (T6): size guard su file > 50MB.

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
  // Fix B6.13: filename con time per evitare collisioni same-day
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  a.download = `nutritrack-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Fix B6.10: revoke più lungo (10s) per permettere download completi su device lenti
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  showToast('Backup esportato', 'success');
}

export function handleImport(file: File): void {
  // Fix B6.15: size guard per evitare freeze UI
  if (file.size > MAX_IMPORT_BYTES) {
    showToast(
      `File troppo grande (${Math.round(file.size / 1024 / 1024)}MB). Massimo ${MAX_IMPORT_BYTES / 1024 / 1024}MB.`,
      'error',
      6000,
    );
    return;
  }

  // Fix B6.11: chiedi conferma prima di sovrascrivere dati esistenti
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
      // Fix B6.9: messaggio distinto per count=0 (es. file con solo settings)
      if (result.count === 0) {
        showToast(
          'Import completato, ma nessun alimento/ricetta/entry trovato nel file (solo impostazioni?)',
          'info',
          4000,
        );
      } else {
        let msg = `Backup importato (${result.count} elementi)`;
        // Fix 7.8: mostra scarti se reconcileAll ha filtrato entità malformate
        if (result.skipped && result.skipped > 0) {
          msg += ` · ${result.skipped} elementi scartati (dati malformati)`;
        }
        showToast(msg, 'success', 3500);
      }
      // Fix B6.14: reload ritardato a 1500ms per lasciare leggere il toast
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(`File non valido: ${result.error}`, 'error', 5000);
    }
  };
  reader.onerror = () => showToast('Errore lettura file', 'error');
  reader.readAsText(file);
}
