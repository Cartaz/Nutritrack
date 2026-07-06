// Azioni dominio: foods.
// Le azioni sono orchestrazioni store + side-effect (toast, modal) mantenute semplici.

import type { FoodItem, NutritionPer100 } from '../types';
import { addFood, updateFood, deleteFood, toggleFavorite, getState, openConfirmDeleteFood, closeConfirmDeleteFood } from './store';
import { showToast } from '../components/toast';

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
