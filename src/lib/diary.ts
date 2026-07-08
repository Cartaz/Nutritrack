// Azioni dominio: diario.

import type { FoodItem, MealType } from '../types';
import { addDiaryEntry, deleteDiaryEntry, updateDiaryEntry, getState, closeFoodSearch } from './store';
import { addFood } from './store';
import { showToast } from '../components/toast';
import { MEAL_LABELS } from '../types';
import { clamp } from './utils';

export interface AddDiaryInput {
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  gramsOverride?: number;
}

/** Aggiunge una entry al diario.
 *  Se il food proviene da OFF e non è salvato, lo persiste nei foods.
 *  Fix BUG #13 (T5): se addDiaryEntry fallisce (limite giornaliero), non persistere il food.
 *  Fix BUG #8 (T5): dedupe per barcode per evitare duplicati OFF food. */
export function addFoodToDiary(input: AddDiaryInput): void {
  const { date, meal, food, quantity, gramsOverride } = input;
  let foodRef = food;

  // Fix BUG #8 (T5): se è un OFF food e esiste già un food salvato con stesso barcode, riusalo
  // (buildFoodFromOff genera id nuovo ad ogni chiamata, quindi il dedupe per id non funziona)
  if (food.source === 'openfoodfacts' && food.barcode) {
    const existingByBarcode = getState().foods.find((f) => f.barcode === food.barcode);
    if (existingByBarcode) {
      foodRef = existingByBarcode;
    } else if (!getState().foods.find((f) => f.id === food.id)) {
      foodRef = addFood(food);
    }
  } else if (food.source === 'openfoodfacts' && !getState().foods.find((f) => f.id === food.id)) {
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
    // Fix BUG #13 (T5): se abbiamo appena persistito il food ma l'entry fallisce,
    // l'utente vede un food salvato senza entry. È accettabile (l'utente può ri-usarlo),
    // ma almeno il toast informa del fallimento.
  }
  closeFoodSearch();
}

export function removeDiaryEntry(id: string): void {
  deleteDiaryEntry(id);
}

/** Cambia quantità di una entry.
 *  Fix 2.1 (T2): se currentQty è già al minimo, no-op silenzioso → mostra toast.
 *  Fix 2.2 (T2): NON resettare gramsOverride se era settato (preserve gram-weight mode).
 *  Fix 2.3 (T2): step adattivo a servingSize per cibi piccoli. */
export function changeEntryQuantity(
  id: string,
  delta: number,
  currentQty: number,
  currentGramsOverride?: number,
): void {
  const MIN_QTY = 0.5;
  // Se l'entry è in modalità grammi (gramsOverride settato), i bottoni +/− non dovrebbero apparire.
  // Ma se la funzione è chiamata comunque, scala i grammi proporzionalmente invece di azzerare gramsOverride.
  if (currentGramsOverride != null) {
    // Modalità grammi: scala i grammi dello stesso ratio
    const currentGramsPerQty = currentGramsOverride / Math.max(currentQty, MIN_QTY);
    const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(2)));
    if (newQty === currentQty) {
      showToast('Quantità minima raggiunta', 'info');
      return;
    }
    const newGrams = Math.round(currentGramsPerQty * newQty);
    updateDiaryEntry(id, { quantity: newQty, gramsOverride: newGrams });
    return;
  }
  // Modalità porzioni: aggiorna solo quantity, NON toccare gramsOverride
  const newQty = Math.max(MIN_QTY, Number((currentQty + delta).toFixed(1)));
  if (newQty === currentQty) {
    showToast('Quantità minima raggiunta', 'info');
    return;
  }
  updateDiaryEntry(id, { quantity: newQty });
}

/** Aggiunge tutti gli ingredienti di una ricetta al diario (scalati per porzione).
 *  Fix C1 (CRITICAL): usa state.currentDate invece di today hardcoded.
 *  Fix R6 (T4): gestisce fallimenti parziali (limite giornaliero).
 *  Fix R7 (T4): valida servings <= 0.
 *  Fix R11 (T4): mantiene 1 decimale di precisione su gramsOverride. */
export function addRecipeToDiary(meal: MealType, recipeId: string, servings: number): void {
  const state = getState();
  const recipe = state.recipes.find((r) => r.id === recipeId);
  if (!recipe || recipe.servings <= 0) return;
  // Fix R7: valida servings parametro
  if (!Number.isFinite(servings) || servings <= 0) {
    showToast('Numero di porzioni non valido', 'error');
    return;
  }
  const factor = servings / recipe.servings;
  let added = 0;
  let failed = 0;
  for (const ing of recipe.ingredients) {
    const entry = addDiaryEntry({
      // Fix C1: usa la data corrente del dashboard, non today hardcoded
      date: state.currentDate,
      meal,
      foodId: ing.foodId,
      foodSnapshot: ing.foodSnapshot,
      quantity: 1,
      // Fix R11: mantieni 1 decimale di precisione
      gramsOverride: Math.round(ing.grams * factor * 10) / 10,
    });
    if (entry) added++;
    else failed++;
  }
  // Fix R6: feedback appropriato
  if (failed > 0 && added === 0) {
    showToast(`Impossibile aggiungere ${recipe.name} (limite giornaliero raggiunto)`, 'error');
  } else if (failed > 0) {
    showToast(
      `${recipe.name}: ${added}/${recipe.ingredients.length} ingredienti aggiunti a ${MEAL_LABELS[meal]} (limite raggiunto)`,
      'warning',
    );
  } else {
    showToast(`${recipe.name} (${servings} porz.) aggiunto a ${MEAL_LABELS[meal]}`, 'success');
  }
}

// Esposizione per compatibilità (alcuni caller possono usare clamp indirettamente)
export { clamp };
