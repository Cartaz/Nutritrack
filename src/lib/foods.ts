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
  const existing = findSavedOffFood(offFood);
  if (existing) return mergeNewPortions(existing, offFood.customPortions);
  return addFood({ ...offFood, id: safeId('food_') });
}

function findSavedOffFood(offFood: FoodItem): FoodItem | undefined {
  const foods = getState().foods;
  if (offFood.barcode) return foods.find((f) => f.barcode === offFood.barcode);
  const lowerName = offFood.name.toLowerCase();
  const lowerBrand = (offFood.brand ?? '').toLowerCase();
  return foods.find((f) => f.name.toLowerCase() === lowerName && (f.brand ?? '').toLowerCase() === lowerBrand);
}

/** Le porzioni create sul risultato remoto non vanno perse se il prodotto era già salvato. */
function mergeNewPortions(existing: FoodItem, incoming: CustomPortion[] | undefined): FoodItem {
  const current = existing.customPortions ?? [];
  const labels = new Set(current.map((p) => p.label.toLowerCase()));
  const added = (incoming ?? []).filter((p) => !labels.has(p.label.toLowerCase()));
  if (added.length === 0) return existing;
  setFoodCustomPortions(existing.id, [...current, ...added]);
  return getState().foods.find((f) => f.id === existing.id) ?? existing;
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

export function toggleFoodFavorite(id: string): void {
  toggleFavorite(id);
}

// ============ Custom portions ============

export type PortionDraftResult = { ok: true; portion: CustomPortion } | { ok: false; message: string };

/**
 * Valida e normalizza una porzione (nome non vuoto, grammi > 0 arrotondati a 0,1).
 * Unica regola usata sia per gli alimenti salvati sia per quelli non ancora in libreria.
 */
export function buildCustomPortion(
  label: string,
  grams: number,
  existing: readonly CustomPortion[] = [],
): PortionDraftResult {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return { ok: false, message: 'Inserisci un nome per la porzione' };
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, message: 'I grammi della porzione devono essere un numero positivo' };
  }
  const dup = existing.find((p) => p.label.toLowerCase() === trimmedLabel.toLowerCase());
  if (dup) return { ok: false, message: `Porzione "${trimmedLabel}" già esistente (${dup.grams}g)` };
  return {
    ok: true,
    portion: { id: safeId('port_'), label: trimmedLabel, grams: Math.max(0.1, Math.round(grams * 10) / 10) },
  };
}

/**
 * Crea una porzione personalizzata per un alimento salvato.
 * Input non valido o label duplicata non mutano il food (e mostrano un toast).
 */
export function addCustomPortionToFood(foodId: string, label: string, grams: number): CustomPortion | null {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food) return null;
  const existing = food.customPortions || [];
  const result = buildCustomPortion(label, grams, existing);
  if (!result.ok) {
    showToast(result.message, 'warning', 4000);
    return null;
  }
  setFoodCustomPortions(foodId, [...existing, result.portion]);
  return result.portion;
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
