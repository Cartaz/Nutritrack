// Modal: viewer ricetta (read-only) con ingredienti + totali per porzione + add-to-diary.

import { getState, closeRecipeViewer, openRecipeMealPicker } from '../lib/store';
import { showModal } from '../components/modal';
import { escapeHtml, escapeAttr, round } from '../lib/utils';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';
import { imgTag } from '../components/img';
import type { Recipe } from '../types';

export function renderRecipeViewerModal(recipeId: string): void {
  const recipe = getState().recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    closeRecipeViewer();
    return;
  }
  const per = calcPerServing(recipe);

  const ingredientsHtml = recipe.ingredients.map((ing) => {
    const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
    return `
      <div class="ing-row">
        ${imgTag(ing.foodSnapshot.image, ing.foodSnapshot.name, 'thumb', ing.foodSnapshot.source === 'custom' ? '✏️' : '🥫')}
        <div class="ing-info">
          <p class="ing-name">${escapeHtml(ing.foodSnapshot.name)}</p>
          <p class="ing-meta">${ing.grams}g · ${Math.round(scaled.calories)} kcal</p>
        </div>
      </div>
    `;
  }).join('');

  const bodyHtml = `
    <div class="recipe-viewer">
      <div class="recipe-viewer-stats">
        <p class="recipe-viewer-label">Per porzione (${recipe.servings} totali)</p>
        <div class="stat-row">
          ${statBox('kcal', String(Math.round(per.calories)), true)}
          ${statBox('P', `${per.protein}g`, true)}
          ${statBox('C', `${per.carbs}g`, true)}
          ${statBox('G', `${per.fat}g`, true)}
        </div>
      </div>
      <h4 class="recipe-viewer-sub">Ingredienti</h4>
      <div class="ing-list">${ingredientsHtml}</div>
    </div>
  `;

  showModal({
    modalId: 'recipe-viewer',
    title: recipe.name,
    bodyHtml,
    actions: [
      { label: 'Chiudi', action: 'close', variant: 'outline' },
      { label: 'Aggiungi al diario', action: 'confirm', variant: 'primary' },
    ],
    onConfirm: () => {
      closeRecipeViewer();
      openRecipeMealPicker(recipe.id);
    },
    sticky: false,
  });
}

function statBox(label: string, value: string, highlight = false): string {
  return `<div class="stat-box${highlight ? ' highlight' : ''}"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function calcPerServing(r: Recipe): { calories: number; protein: number; carbs: number; fat: number } {
  const nutritions = r.ingredients.map((ing) => scaleNutrition(ing.foodSnapshot.nutrition, ing.grams));
  const t = sumNutrition(nutritions);
  return {
    calories: r.servings > 0 ? round(t.calories / r.servings, 1) : 0,
    protein:  r.servings > 0 ? round(t.protein  / r.servings, 1) : 0,
    carbs:    r.servings > 0 ? round(t.carbs    / r.servings, 1) : 0,
    fat:      r.servings > 0 ? round(t.fat      / r.servings, 1) : 0,
  };
}

void escapeAttr;
