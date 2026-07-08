// Azioni dominio: ricette.

import type { Recipe, RecipeIngredient } from '../types';
import {
  addRecipe,
  updateRecipe,
  deleteRecipe,
  getState,
  openDeleteRecipeConfirm,
  closeDeleteRecipeConfirm,
} from './store';
import { showToast } from '../components/toast';

export interface CreateRecipeInput {
  name: string;
  description?: string;
  servings: number;
  ingredients: RecipeIngredient[];
}

export function createRecipe(input: CreateRecipeInput): Recipe {
  const recipe = addRecipe(input);
  showToast('Ricetta creata', 'success');
  return recipe;
}

export function editRecipe(id: string, patch: Partial<Recipe>): void {
  updateRecipe(id, patch);
  showToast('Ricetta aggiornata', 'success');
}

export function requestDeleteRecipe(id: string): void {
  openDeleteRecipeConfirm(id);
}

export function confirmDeleteRecipe(): void {
  const id = getState()._confirmDeleteRecipeId;
  if (!id) return;
  deleteRecipe(id);
  closeDeleteRecipeConfirm();
  showToast('Ricetta eliminata', 'success');
}

export function cancelDeleteRecipe(): void {
  closeDeleteRecipeConfirm();
}
