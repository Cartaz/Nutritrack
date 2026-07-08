// Azioni dominio: foods.
// Le azioni sono orchestrazioni store + side-effect (toast, modal) mantenute semplici.

import type { FoodItem, NutritionPer100, CustomPortion } from '../types';
import {
  addFood,
  updateFood,
  deleteFood,
  toggleFavorite,
  getState,
  openDeleteFoodConfirm,
  closeDeleteFoodConfirm,
} from './store';
import { showToast } from '../components/toast';
import { safeId } from './utils';

export interface CreateFoodInput {
  name: string;
  brand?: string;
  servingSize: number;
  servingLabel?: string;
  nutrition: NutritionPer100;
  image?: string;
}

/** Crea un alimento custom.
 *  Fix BUG #7 (T3): warning se esiste già un food con stesso name+brand (case-insensitive). */
export function createCustomFood(input: CreateFoodInput): FoodItem {
  const trimmedName = input.name.trim();
  const trimmedBrand = input.brand?.trim();
  // Check duplicati (case-insensitive su name+brand)
  const existing = getState().foods.find((f) => {
    const fname = f.name.toLowerCase();
    const fbrand = (f.brand ?? '').toLowerCase();
    const inName = trimmedName.toLowerCase();
    const inBrand = (trimmedBrand ?? '').toLowerCase();
    return fname === inName && fbrand === inBrand;
  });
  if (existing) {
    showToast(`Esiste già un alimento con nome "${trimmedName}" e marca "${trimmedBrand ?? '—'}"`, 'warning', 4000);
  }
  const food = addFood({
    name: trimmedName,
    brand: trimmedBrand || undefined,
    source: 'custom',
    servingSize: input.servingSize,
    servingLabel: input.servingLabel,
    nutrition: input.nutrition,
    image: input.image,
  });
  return food;
}

/** Aggiorna un alimento esistente */
export function editFood(id: string, patch: Partial<FoodItem>): void {
  updateFood(id, patch);
}

/** Elimina alimento (con conferma utente) */
export function requestDeleteFood(id: string): void {
  openDeleteFoodConfirm(id);
}

export function confirmDeleteFood(): void {
  const id = getState()._confirmDeleteFoodId;
  if (!id) return;
  deleteFood(id);
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

/** Crea una nuova porzione personalizzata per un alimento salvato.
 *  Ritorna la porzione creata (con id generato), oppure null se l'alimento non esiste o input invalido.
 *  Fix BUG #3 (T3): validazione esplicita di grams (no clamp silente di 0/NaN/negativi).
 *  Fix BUG #3 (T3): dedup label case-insensitive (avvisa se esiste già). */
export function addCustomPortionToFood(foodId: string, label: string, grams: number): CustomPortion | null {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food) return null;
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return null;
  // Fix BUG #3: validazione esplicita (no clamp silente)
  if (!Number.isFinite(grams) || grams <= 0) {
    showToast('I grammi della porzione devono essere un numero positivo', 'error');
    return null;
  }
  // Fix BUG #3: dedup label case-insensitive
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
  updateFood(foodId, { customPortions: [...existing, portion] });
  return portion;
}

/** Rimuove una porzione personalizzata da un alimento salvato. */
export function removeCustomPortionFromFood(foodId: string, portionId: string): void {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food || !food.customPortions) return;
  updateFood(foodId, {
    customPortions: food.customPortions.filter((p) => p.id !== portionId),
  });
}
