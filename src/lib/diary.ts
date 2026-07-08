// Azioni dominio: diario.

import type { FoodItem, MealType } from '../types';
import { addDiaryEntry, deleteDiaryEntry, updateDiaryEntry, getState, closeFoodSearch } from './store';
import { addFood } from './store';
import { showToast } from '../components/toast';
import { MEAL_LABELS } from '../types';
import { toDateKey } from './utils';

export interface AddDiaryInput {
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  gramsOverride?: number;
}

/** Aggiunge una entry al diario.
 *  Se il food proviene da OFF e non è salvato, lo persiste nei foods. */
export function addFoodToDiary(input: AddDiaryInput): void {
  const { date, meal, food, quantity, gramsOverride } = input;
  let foodRef = food;
  // Salva sempre il cibo se proviene da OFF e non è già nei salvati
  if (food.source === 'openfoodfacts' && !getState().foods.find((f) => f.id === food.id)) {
    foodRef = addFood(food);
  }
  const entry = addDiaryEntry({
    date,
    meal,
    foodId: foodRef.id,
    foodSnapshot: foodRef,
    quantity,
    gramsOverride,
  });
  if (entry) {
    showToast(`${foodRef.name} aggiunto a ${MEAL_LABELS[meal]}`, 'success');
  } else {
    showToast('Impossibile aggiungere (limite giornaliero raggiunto)', 'error');
  }
  closeFoodSearch();
}

export function removeDiaryEntry(id: string): void {
  deleteDiaryEntry(id);
}

export function changeEntryQuantity(id: string, delta: number, currentQty: number): void {
  const newQty = Math.max(0.5, Number((currentQty + delta).toFixed(1)));
  updateDiaryEntry(id, { quantity: newQty, gramsOverride: undefined });
}

/** Aggiunge tutti gli ingredienti di una ricetta al diario (scalati per porzione) */
export function addRecipeToDiary(meal: MealType, recipeId: string, servings: number): void {
  const recipe = getState().recipes.find((r) => r.id === recipeId);
  if (!recipe || recipe.servings <= 0) return;
  const factor = servings / recipe.servings;
  for (const ing of recipe.ingredients) {
    addDiaryEntry({
      date: toDateKey(new Date()),
      meal,
      foodId: ing.foodId,
      foodSnapshot: ing.foodSnapshot,
      quantity: 1,
      gramsOverride: Math.round(ing.grams * factor),
    });
  }
  showToast(`${recipe.name} aggiunto a ${MEAL_LABELS[meal]}`, 'success');
}
