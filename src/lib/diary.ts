// Azioni dominio: diario.

import type { DiaryEntry, FoodItem, MealType } from '../types';
import { addDiaryEntries, addDiaryEntry, closeFoodSearch, deleteDiaryEntry, getState, updateDiaryEntry } from './store';
import { showToast } from '../components/toast';
import { MEAL_LABELS } from '../types';
import { clamp, isValidDateKey } from './utils';
import { saveOffFood } from './foods';

export { addFood } from './store';

export interface AddDiaryInput {
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  gramsOverride?: number;
}

export function addFoodToDiary(input: AddDiaryInput): void {
  const { date, meal, food, quantity, gramsOverride } = input;
  let foodRef = food;

  if (!isValidDateKey(date)) {
    showToast('Data non valida, impossibile aggiungere al diario', 'error');
    return;
  }

  if (food.source === 'openfoodfacts') foodRef = saveOffFood(food);

  const entry = addDiaryEntry({
    date,
    meal,
    foodId: foodRef.id,
    foodSnapshot: foodRef,
    quantity,
    gramsOverride,
  });
  if (!entry) {
    showToast('Impossibile aggiungere (dati non validi o limite giornaliero raggiunto)', 'error');
    return;
  }

  showToast(`${foodRef.name} aggiunto a ${MEAL_LABELS[meal]}`, 'success');
  closeFoodSearch();
}

export function removeDiaryEntry(id: string): void {
  deleteDiaryEntry(id);
}

function findDiaryEntry(id: string): DiaryEntry | undefined {
  for (const entries of Object.values(getState().diary)) {
    const entry = entries.find((item) => item.id === id);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Cambia quantità tramite una API semantica: il caller fornisce solo id + delta.
 * Gli argomenti extra sono accettati temporaneamente per compatibilità con vecchi caller,
 * ma non sono più una fonte di verità.
 */
export function changeEntryQuantity(id: string, delta: number, ..._legacyArgs: unknown[]): void {
  void _legacyArgs;
  if (!Number.isFinite(delta) || delta === 0) return;
  const entry = findDiaryEntry(id);
  if (!entry) return;

  const MIN_QTY = 0.5;
  const currentQty = entry.quantity;
  const currentGramsOverride = entry.gramsOverride;

  if (currentGramsOverride != null) {
    const safeGrams = currentGramsOverride > 0 ? currentGramsOverride : 1;
    const currentGramsPerQty = safeGrams / Math.max(currentQty, MIN_QTY);
    const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(2)));
    if (newQty === currentQty) {
      showToast('Quantità minima raggiunta', 'info');
      return;
    }
    const newGrams = Math.max(0.1, Math.round(currentGramsPerQty * newQty * 10) / 10);
    updateDiaryEntry(id, { quantity: newQty, gramsOverride: newGrams });
    return;
  }

  const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(1)));
  if (newQty === currentQty) {
    showToast('Quantità minima raggiunta', 'info');
    return;
  }
  updateDiaryEntry(id, { quantity: newQty });
}

/**
 * Aggiunge una ricetta come singola operazione logica. Tutti gli ingredienti
 * vengono validati e inseriti in batch; se il limite giornaliero non consente
 * l'intera ricetta, non viene scritto nessun ingrediente.
 */
export function addRecipeToDiary(meal: MealType, recipeId: string, servings: number): void {
  const state = getState();
  const recipe = state.recipes.find((item) => item.id === recipeId);
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
  const inputs = recipe.ingredients.map((ingredient) => ({
    date: state.currentDate,
    meal,
    foodId: ingredient.foodId,
    foodSnapshot: ingredient.foodSnapshot,
    quantity: 1,
    gramsOverride: Math.round(ingredient.grams * factor * 10) / 10,
  }));

  const entries = addDiaryEntries(inputs);
  if (!entries) {
    showToast(`Impossibile aggiungere ${recipe.name}: il diario non ha spazio per l'intera ricetta`, 'error');
    return;
  }
  showToast(`${recipe.name} (${servings} porz.) aggiunto a ${MEAL_LABELS[meal]}`, 'success');
}

export { clamp };
