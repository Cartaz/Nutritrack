// Database IT curato: layer di override locale per barcode di prodotti italiani.
// P1 #2 Step 02 "Qualità della vita quotidiana".
//
// Quando l'utente scansiona un barcode presente in src/data/it-foods-override.json,
// viene usato il nostro record curato invece di interrogare Open Food Facts.
// Priorità: foods salvati dell'utente > override IT > Open Food Facts.
//
// Il file JSON è versionato in repo e arricchito via PR (roadmap hobbistica).
// Nessun backend, nessuna dipendenza esterna: il JSON viene bundlato nell'app.

import overrideData from '../data/it-foods-override.json';
import type { FoodItem, NutritionPer100 } from '../types';
import { safeId } from './utils';

// ============ Tipi del JSON (struttura del file di override) ============

interface ItOverrideNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  salt?: number;
}

interface ItOverrideProduct {
  barcode: string;
  name: string;
  brand?: string;
  servingSize: number;
  servingLabel?: string;
  nutrition: ItOverrideNutrition;
  verified?: boolean;
}

interface ItOverrideFile {
  version: number;
  updatedAt: string;
  description?: string;
  products: ItOverrideProduct[];
}

// ============ Build della mappa barcode -> FoodItem (una volta, lazy) ============

let _overrideMap: Map<string, FoodItem> | null = null;
let _overrideCount = 0;
let _verifiedCount = 0;

/** Valida un prodotto grezzo dal JSON. Ritorna null se barcode/nome/nutrizione mancanti.
 *  Defense in depth: il JSON è versionato in repo, ma validiamo comunque. */
function validateProduct(p: ItOverrideProduct): FoodItem | null {
  if (!p || typeof p !== 'object') return null;
  const barcode = typeof p.barcode === 'string' ? p.barcode.trim() : '';
  if (!barcode) return null;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) return null;
  const n = p.nutrition;
  if (!n || typeof n !== 'object') return null;
  const nutrition: NutritionPer100 = {
    calories: Number(n.calories) || 0,
    protein: Number(n.protein) || 0,
    carbs: Number(n.carbs) || 0,
    fat: Number(n.fat) || 0,
  };
  if (n.fiber != null) nutrition.fiber = Number(n.fiber) || undefined;
  if (n.sugar != null) nutrition.sugar = Number(n.sugar) || undefined;
  if (n.salt != null) nutrition.salt = Number(n.salt) || undefined;
  // Scarta se tutto zero (alimenti senza nutrienti non hanno senso nel DB curato,
  //  l'acqua è l'unica eccezione legittima ma la gestiamo comunque: ha carbs/fat=0
  //  ma è utile per il tracking dell'idratazione — la accettiamo).
  const servingSize = Number(p.servingSize);
  return {
    id: safeId('it_'),
    name,
    brand: typeof p.brand === 'string' && p.brand.trim() ? p.brand.trim() : undefined,
    barcode,
    source: 'openfoodfacts', // integra con il dedupe esistente (saveOffFood per barcode)
    servingSize: Number.isFinite(servingSize) && servingSize > 0 ? Math.round(servingSize) : 100,
    servingLabel: typeof p.servingLabel === 'string' && p.servingLabel.trim() ? p.servingLabel.trim() : undefined,
    nutrition,
    createdAt: Date.now(),
  };
}

function buildMap(): Map<string, FoodItem> {
  const map = new Map<string, FoodItem>();
  const data = overrideData as ItOverrideFile;
  if (!data || !Array.isArray(data.products)) return map;
  for (const p of data.products) {
    const food = validateProduct(p);
    if (!food) continue;
    // Se ci sono duplicati di barcode nel JSON, vince il primo (deterministico).
    if (!map.has(food.barcode!)) {
      map.set(food.barcode!, food);
      _overrideCount++;
      if (p.verified === true) _verifiedCount++;
    }
  }
  return map;
}

function getMap(): Map<string, FoodItem> {
  if (!_overrideMap) {
    _overrideMap = buildMap();
  }
  return _overrideMap;
}

// ============ Public API ============

/** Cerca un alimento nel database IT curato per barcode.
 *  Ritorna un FoodItem pronto all'uso, o null se il barcode non è nel DB.
 *  L'id è fresco (safeId) ad ogni chiamata, coerente con buildFoodFromOff:
 *  questo permette al downstream saveOffFood di fare dedupe per barcode
 *  invece di collidere con un eventuale food salvato con stesso barcode. */
export function getItOverrideByBarcode(barcode: string): FoodItem | null {
  if (typeof barcode !== 'string') return null;
  const normalized = barcode.trim();
  if (!normalized) return null;
  const map = getMap();
  const food = map.get(normalized);
  if (!food) return null;
  // Ritorna una copia con id fresco (come buildFoodFromOff) per non condividere
  // reference mutabile tra chiamate successive.
  return { ...food, id: safeId('it_'), createdAt: Date.now() };
}

/** Numero totale di prodotti nel database IT curato. */
export function getItOverrideCount(): number {
  // Forza la build della mappa se non ancora fatto (popola i contatori).
  getMap();
  return _overrideCount;
}

/** Numero di prodotti verificati (verified: true nel JSON). */
export function getItOverrideVerifiedCount(): number {
  getMap();
  return _verifiedCount;
}

/** Versione del file di override (dal JSON). */
export function getItOverrideVersion(): number {
  return (overrideData as ItOverrideFile).version ?? 1;
}

/** Data di ultimo aggiornamento del file (dal JSON). */
export function getItOverrideUpdatedAt(): string {
  return (overrideData as ItOverrideFile).updatedAt ?? '';
}

/** Reset interno per test (rigenera la mappa al prossimo accesso). */
export function __resetItOverrideForTesting(): void {
  _overrideMap = null;
  _overrideCount = 0;
  _verifiedCount = 0;
}
