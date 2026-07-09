// Recent foods: lista degli ultimi alimenti usati nel diario, per quick-add.
// P2 #2 Step 02 "Qualità della vita quotidiana".
//
// "Recente" = ordinato per data di ultimo utilizzo nel diario (desc).
// Deduplicato per foodId (un alimento usato più volte conta una volta sola).
// Limitato a 10 elementi.
// Niente persistenza aggiuntiva: derivato dallo state.diary esistente.

import type { FoodItem } from '../types';
import { getState } from './store';

export interface RecentFood {
  food: FoodItem;
  lastUsedDate: string; // YYYY-MM-DD
  lastUsedAt: number; // timestamp createdAt dell'entry più recente
  useCount: number; // quante volte è stato usato in tutto il diario
}

/** Ritorna gli ultimi 10 alimenti usati nel diario, ordinati per ultimo utilizzo.
 *  Deduplicati per foodId (un alimento usato più volte conta una volta sola,
 *  ma useCount riflette il numero totale di utilizzi).
 *  Gli alimenti referenziati via foodId vengono recuperati da state.foods
 *  (snapshot fresco, non quello stale della entry). Se il foodId non corrisponde
 *  a nessun food salvato (es. food eliminato), usa lo snapshot della entry. */
export function getRecentFoods(limit = 10): RecentFood[] {
  const state = getState();
  const foodMap = new Map(state.foods.map((f) => [f.id, f]));
  // Mappa foodId/snapshotKey -> info aggregata
  const byKey = new Map<string, RecentFood>();

  for (const [date, entries] of Object.entries(state.diary)) {
    for (const e of entries) {
      // Chiave: preferisci foodId se presente, altrimenti nome+barcode come fallback
      // (snapshot di food non salvati non hanno foodId, ma hanno stesso nome)
      const key = e.foodId ?? `snap:${e.foodSnapshot.name}:${e.foodSnapshot.barcode ?? ''}`;
      const existing = byKey.get(key);
      // Recupera il food fresco da state.foods, fallback allo snapshot della entry
      const food = e.foodId ? (foodMap.get(e.foodId) ?? e.foodSnapshot) : e.foodSnapshot;
      if (existing) {
        existing.useCount += 1;
        if (e.createdAt > existing.lastUsedAt) {
          existing.lastUsedAt = e.createdAt;
          existing.lastUsedDate = date;
          existing.food = food; // aggiorna con snapshot più fresco
        }
      } else {
        byKey.set(key, {
          food,
          lastUsedDate: date,
          lastUsedAt: e.createdAt,
          useCount: 1,
        });
      }
    }
  }

  // Ordina per lastUsedAt desc, prendi i primi `limit`
  return Array.from(byKey.values())
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit);
}

/** Aggiunge rapidamente un alimento al diario con la porzione di default.
 *  Usato dal bottone "1-click add" della lista recenti.
 *  Usa il pasto corrente intelligente: colazione se <11:00, pranzo se 11-15,
 *  cena se 15-21, snack altrimenti. */
export function quickAddRecentFood(food: FoodItem, date: string): void {
  const hour = new Date().getHours();
  let meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  if (hour < 11) meal = 'breakfast';
  else if (hour < 15) meal = 'lunch';
  else if (hour < 21) meal = 'dinner';
  else meal = 'snack';

  // addFoodToDiary gestisce già il dedupe OFF food + persistenza + toast + close search
  addFoodToDiary({
    date,
    meal,
    food,
    quantity: 1,
    // gramsOverride = servingSize per avere "1 porzione di default"
    gramsOverride: food.servingSize,
  });
}

// import locale per evitare circular import con diary.ts
import { addFoodToDiary } from './diary';
