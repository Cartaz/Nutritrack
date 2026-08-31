// Azioni dominio: foods.
// Le azioni sono orchestrazioni store + side-effect (toast, modal) mantenute semplici.

import type { FoodItem, CustomPortion } from '../types';
import {
  addFood,
  setFoodCustomPortions,
  deleteFood,
  toggleFavorite,
  getState,
  getActiveDialog,
  openDeleteFoodConfirm,
  closeDeleteFoodConfirm,
} from './store';
import { showToast } from '../components/toast';
import { safeId } from './utils';

/**
 * Salva un food proveniente da Open Food Facts nella libreria dell'utente e possiede
 * la deduplicazione dei prodotti remoti. Il risultato restituisce sempre l'identità
 * persistita da usare anche nei riferimenti del diario.
 *
 * Priorità di deduplicazione:
 * 1. stesso barcode, quando presente;
 * 2. stesso nome+brand case-insensitive quando il barcode è assente;
 * 3. altrimenti nuova identità persistita `food_*`.
 */
export function saveOffFood(offFood: FoodItem): FoodItem {
  if (offFood.source !== 'openfoodfacts') {
    return offFood;
  }
  const foods = getState().foods;
  if (offFood.barcode) {
    const existing = foods.find((f) => f.barcode === offFood.barcode);
    if (existing) return existing;
  } else {
    const lowerName = offFood.name.toLowerCase();
    const lowerBrand = (offFood.brand ?? '').toLowerCase();
    const existing = foods.find(
      (f) => f.name.toLowerCase() === lowerName && (f.brand ?? '').toLowerCase() === lowerBrand,
    );
    if (existing) return existing;
  }
  return addFood({ ...offFood, id: safeId('food_') });
}

/** Elimina alimento (con conferma utente). */
export function requestDeleteFood(id: string): void {
  openDeleteFoodConfirm(id);
}

export function confirmDeleteFood(): void {
  const dialog = getActiveDialog();
  if (dialog?.type !== 'confirm-delete-food') return;
  deleteFood(dialog.foodId);
  closeDeleteFoodConfirm();
  showToast('Alimento eliminato', 'success');
}

export function cancelDeleteFood(): void {
  closeDeleteFoodConfirm();
}

export function toggleFoodFavorite(id: string): void {
  toggleFavorite(id);
}

// ============ Custom portions ============

/**
 * Crea una porzione personalizzata per un alimento salvato.
 * Input non valido o label duplicata non mutano il food.
 */
export function addCustomPortionToFood(foodId: string, label: string, grams: number): CustomPortion | null {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food) return null;
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return null;
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('I grammi della porzione devono essere un numero positivo', 'error');
    return null;
  }
  const existing = food.customPortions || [];
  const dupLabel = existing.find((p) => p.label.toLowerCase() === trimmedLabel.toLowerCase());
  if (dupLabel) {
    showToast(`Porzione "${trimmedLabel}" già esistente (${dupLabel.grams}g)`, 'warning', 4000);
    return null;
  }
  const safeGrams = Math.max(0.1, Math.round(grams * 10) / 10);
  const portion: CustomPortion = {
    id: safeId('port_'),
    label: trimmedLabel,
    grams: safeGrams,
  };
  setFoodCustomPortions(foodId, [...existing, portion]);
  return portion;
}

/** Rimuove una porzione personalizzata da un alimento salvato. */
export function removeCustomPortionFromFood(foodId: string, portionId: string): void {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food || !food.customPortions) return;
  setFoodCustomPortions(
    foodId,
    food.customPortions.filter((p) => p.id !== portionId),
  );
}
