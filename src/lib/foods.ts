// Azioni dominio: foods.
// Le azioni sono orchestrazioni store + side-effect (toast, modal) mantenute semplici.

import type { FoodItem, NutritionPer100, CustomPortion } from '../types';
import { addFood, updateFood, deleteFood, toggleFavorite, getState, openConfirmDeleteFood, closeConfirmDeleteFood } from './store';
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

/** Crea un alimento custom */
export function createCustomFood(input: CreateFoodInput): FoodItem {
  const food = addFood({
    name: input.name,
    brand: input.brand,
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
  openConfirmDeleteFood(id);
}

export function confirmDeleteFood(): void {
  const id = getState()._confirmDeleteFoodId;
  if (!id) return;
  deleteFood(id);
  closeConfirmDeleteFood();
  showToast('Alimento eliminato', 'success');
}

export function cancelDeleteFood(): void {
  closeConfirmDeleteFood();
}

export function toggleFoodFavorite(id: string): void {
  toggleFavorite(id);
}

// ============ Custom portions ============

/** Crea una nuova porzione personalizzata per un alimento salvato.
 *  Ritorna la porzione creata (con id generato), oppure null se l'alimento non esiste. */
export function addCustomPortionToFood(foodId: string, label: string, grams: number): CustomPortion | null {
  const food = getState().foods.find((f) => f.id === foodId);
  if (!food) return null;
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return null;
  const safeGrams = Math.max(0.1, Math.round(grams * 10) / 10);
  const portion: CustomPortion = {
    id: safeId('port_'),
    label: trimmedLabel,
    grams: safeGrams,
  };
  const existing = food.customPortions || [];
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
