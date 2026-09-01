// Azioni dominio: ricette.

import { deleteRecipe, getActiveDialog, openDeleteRecipeConfirm, closeDeleteRecipeConfirm } from './store';
import { showToast } from '../components/toast';

export function requestDeleteRecipe(id: string): void {
  openDeleteRecipeConfirm(id);
}

export function confirmDeleteRecipe(): void {
  const dialog = getActiveDialog();
  if (dialog?.type !== 'confirm-delete-recipe') return;
  deleteRecipe(dialog.recipeId);
  closeDeleteRecipeConfirm();
  showToast('Ricetta eliminata', 'success');
}

export function cancelDeleteRecipe(): void {
  closeDeleteRecipeConfirm();
}
