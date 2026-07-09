// Gamification locale: streak giornaliero + badge sbloccabili.
// P3 #1 Step 02 "Qualità della vita quotidiana".
//
// Niente social, niente condivisione, niente backend. Solo motivazione personale.
// Tutto derivato dallo state esistente (diary + recipes + biometrics), nessuna
// persistenza aggiuntiva.

import type { AppState, DayDiary } from '../types';
import { toDateKey, isValidDateKey, parseISODateLocal } from './utils';

// ============ Streak ============

export interface StreakInfo {
  current: number; // giorni consecutivi con almeno 1 entry, terminanti oggi (o ieri se oggi vuoto)
  longest: number; // streak più lunga mai registrata
  lastTrackedDate: string | null; // ultima data con almeno 1 entry (YYYY-MM-DD)
}

/** Calcola lo streak corrente e quello più lungo dalla mappa diario.
 *  - "Giorno tracciato" = giorno con almeno 1 entry nel diario.
 *  - Streak corrente: conta all'indietro da oggi (o dall'ultimo giorno tracciato
 *    se oggi è vuoto) finché trova giorni consecutivi tracciati.
 *    Se oggi è vuoto ma ieri sì, lo streak è ancora "vivo" (= quello di ieri)
 *    per dare all'utente fino a mezzanotte per rinnovarlo.
 *  - Streak più lungo: scansione completa di tutte le date tracciate. */
export function computeStreak(diary: DayDiary): StreakInfo {
  // Set di date tracciate (con almeno 1 entry)
  const trackedDates = new Set<string>();
  for (const [date, entries] of Object.entries(diary)) {
    if (entries.length > 0 && isValidDateKey(date)) trackedDates.add(date);
  }
  if (trackedDates.size === 0) {
    return { current: 0, longest: 0, lastTrackedDate: null };
  }

  // Streak più lungo: ordina le date, conta run di giorni consecutivi
  const sortedDates = Array.from(trackedDates).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = parseISODateLocal(sortedDates[i - 1]);
    const curr = parseISODateLocal(sortedDates[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Streak corrente: conta all'indietro da today
  const today = toDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);

  let cursor: string;
  if (trackedDates.has(today)) {
    cursor = today;
  } else if (trackedDates.has(yesterdayKey)) {
    // tolleranza: streak vivo se ieri tracciato ma oggi no
    cursor = yesterdayKey;
  } else {
    // streak rotto
    return { current: 0, longest, lastTrackedDate: sortedDates[sortedDates.length - 1] };
  }

  let current = 0;
  const cursorDate = parseISODateLocal(cursor);
  while (true) {
    const key = toDateKey(cursorDate);
    if (!trackedDates.has(key)) break;
    current += 1;
    cursorDate.setDate(cursorDate.getDate() - 1);
  }

  return {
    current,
    longest,
    lastTrackedDate: sortedDates[sortedDates.length - 1],
  };
}

// ============ Badge ============

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Ritorna true se il badge è sbloccato dato lo stato. */
  isUnlocked: (state: AppState) => boolean;
}

/** Tutti i badge definibili. L'ordine dell'array determina l'ordine di display. */
export const BADGES: readonly BadgeDef[] = [
  {
    id: 'first_entry',
    name: 'Primo passo',
    description: 'Registra la tua prima voce nel diario',
    icon: '🌱',
    isUnlocked: (s) => totalDiaryEntries(s.diary) >= 1,
  },
  {
    id: 'first_week',
    name: 'Prima settimana',
    description: 'Traccia per 7 giorni consecutivi',
    icon: '🔥',
    isUnlocked: (s) => computeStreak(s.diary).longest >= 7,
  },
  {
    id: '100_days',
    name: 'Centurione',
    description: 'Traccia per 100 giorni (non necessariamente consecutivi)',
    icon: '💯',
    isUnlocked: (s) => countTrackedDays(s.diary) >= 100,
  },
  {
    id: 'first_recipe',
    name: 'Chef alle prime armi',
    description: 'Crea la tua prima ricetta',
    icon: '🍳',
    isUnlocked: (s) => s.recipes.length >= 1,
  },
  {
    id: '10_recipes',
    name: 'Cuoco provetto',
    description: 'Crea 10 ricette',
    icon: '👨‍🍳',
    isUnlocked: (s) => s.recipes.length >= 10,
  },
  {
    id: 'biometric',
    name: 'Biometrico',
    description: 'Registra acqua, sonno o peso per la prima volta',
    icon: '💧',
    isUnlocked: (s) => Object.keys(s.biometrics).length >= 1,
  },
  {
    id: 'water_goal',
    name: 'Idratato',
    description: 'Raggiungi 2 L di acqua in un giorno',
    icon: '🚰',
    isUnlocked: (s) => Object.values(s.biometrics).some((b) => (b.waterMl ?? 0) >= 2000),
  },
] as const;

export interface UnlockedBadge extends BadgeDef {
  unlocked: boolean;
}

/** Ritorna tutti i badge con flag unlocked. */
export function getBadgeStatuses(state: AppState): UnlockedBadge[] {
  return BADGES.map((b) => ({ ...b, unlocked: b.isUnlocked(state) }));
}

/** Conta quanti badge sono sbloccati. */
export function countUnlockedBadges(state: AppState): number {
  return BADGES.reduce((acc, b) => acc + (b.isUnlocked(state) ? 1 : 0), 0);
}

// ============ Helpers ============

function totalDiaryEntries(diary: DayDiary): number {
  let count = 0;
  for (const entries of Object.values(diary)) {
    count += entries.length;
  }
  return count;
}

function countTrackedDays(diary: DayDiary): number {
  let count = 0;
  for (const entries of Object.values(diary)) {
    if (entries.length > 0) count += 1;
  }
  return count;
}
