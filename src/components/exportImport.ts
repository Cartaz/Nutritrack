// Export/Import JSON backup.
// Export: crea Blob e trigger download. Import: file input + validazione via normalize.

import { exportDataJson, importDataJson } from '../lib/storage';
import { showToast } from './toast';

export function handleExport(): void {
  const data = exportDataJson();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nutritrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup esportato', 'success');
}

export function handleImport(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const result = importDataJson(String(reader.result || ''));
    if (result.ok) {
      showToast(`Backup importato (${result.count} elementi)`, 'success');
      setTimeout(() => window.location.reload(), 800);
    } else {
      showToast(`File non valido: ${result.error}`, 'error');
    }
  };
  reader.onerror = () => showToast('Errore lettura file', 'error');
  reader.readAsText(file);
}
