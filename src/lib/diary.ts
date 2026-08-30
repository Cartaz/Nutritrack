// Azioni dominio: diario.

import type { FoodItem, MealType } from '../types';
import {
  addDiaryEntry,
  addDiaryEntries,
  deleteDiaryEntry,
  setDiaryEntryAmount,
  getState,
  closeFoodSearch,
} from './store';
import { showToast } from '../components/toast';
import { MEAL_LABELS } from '../types';
import { clamp, isValidDateKey } from './utils';
import { saveOffFood } from './foods';

// Re-export per backward compat (vecchi callers possono usare addFood direttamente)
export { addFood } from './store';

export interface AddDiaryInput {
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  gramsOverride?: number;
}

/** Aggiunge una entry al diario.
 *  Se il food proviene da OFF e non è salvato, lo persiste nei foods.
 *  Il limite giornaliero è applicato dallo store; in caso di fallimento il search resta aperto. */
export function addFoodToDiary(input: AddDiaryInput): void {
  const { date, meal, food, quantity, gramsOverride } = input;
  let foodRef = food;

  if (!isValidDateKey(date)) {
    showToast('Data non valida, impossibile aggiungere al diario', 'error');
    return;
  }

  if (food.source === 'openfoodfacts') {
    foodRef = saveOffFood(food);
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
    closeFoodSearch();
  } else {
    showToast('Impossibile aggiungere (limite giornaliero raggiunto)', 'error');
  }
}

export function removeDiaryEntry(id: string): void {
  deleteDiaryEntry(id);
}

/** Cambia quantità di una entry mantenendo coerente la modalità porzioni/grammi. */
export function changeEntryQuantity(
  id: string,
  delta: number,
  currentQty: number,
  currentGramsOverride?: number,
): void {
  const MIN_QTY = 0.5;

  if (currentGramsOverride != null) {
    const safeGrams = currentGramsOverride > 0 ? currentGramsOverride : 1;
    const currentGramsPerQty = safeGrams / Math.max(currentQty, MIN_QTY);
    const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(2)));
    if (newQty === currentQty) {
      showToast('Quantità minima raggiunta', 'info');
      return;
    }
    const newGrams = Math.round(currentGramsPerQty * newQty);
    setDiaryEntryAmount(id, newQty, newGrams);
    return;
  }

  const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(1)));
  if (newQty === currentQty) {
    showToast('Quantità minima raggiunta', 'info');
    return;
  }
  setDiaryEntryAmount(id, newQty);
}

/**
 * Aggiunge una ricetta come singola operazione atomica.
 * Tutte le entry vengono preparate prima e lo store verifica la capacità della giornata
 * prima di mutare il diario: una ricetta non può quindi essere inserita solo in parte.
 */
export function addRecipeToDiary(meal: MealType, recipeId: string, servings: number): void {
  const state = getState();
  const recipe = state.recipes.find((r) => r.id === recipeId);
  if (!recipe || recipe.servings <= 0) return;
  if (!Number.isFinite(servings) || servings <= 0) {
    showToast('Numero di porzioni non valido', 'error');
    return;
  }
  if (!isValidDateKey(state.currentDate)) {
    showToast('Data corrente non valida, impossibile aggiungere al diario', 'error');
    return;
  }

  const factor = servings / recipe.servings;
  const result = addDiaryEntries(
    recipe.ingredients.map((ing) => ({
      date: state.currentDate,
      meal,
      foodId: ing.foodId,
      foodSnapshot: ing.foodSnapshot,
      quantity: 1,
      gramsOverride: Math.round(ing.grams * factor * 10) / 10,
    })),
  );

  if (!result.ok) {
    showToast(`Impossibile aggiungere ${recipe.name} (limite giornaliero raggiunto)`, 'error');
    return;
  }

  showToast(`${recipe.name} (${servings} porz.) aggiunto a ${MEAL_LABELS[meal]}`, 'success');
}

// Esposizione per compatibilità (alcuni caller possono usare clamp indirettamente)
export { clamp };
