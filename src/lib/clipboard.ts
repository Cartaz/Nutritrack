// Copy-to-clipboard helpers: esportazione di diario e ricette in formato
// markdown human-readable, copiabile su WhatsApp/Telegram/email per
// condividere il piano alimentare con medico o amici.
// P2 #1 Step 02 "Qualità della vita quotidiana".
//
// Niente dipendenze esterne: usa navigator.clipboard.writeText con
// fallback a document.execCommand('copy') per browser/Safari vecchi.

import { getState } from './store';
import { scaleNutrition, sumNutrition, calcMacroGrams } from './nutrition';
import { formatDateIT } from './utils';
import { MEAL_LABELS, MEAL_ORDER, MEAL_ICONS } from '../types';
import type { Recipe } from '../types';

/** Copia testo negli appunti con fallback legacy. Ritorna true se ha avuto successo. */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Path moderno: Clipboard API (HTTPS o localhost, permesso granted dal gesture utente)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through al path legacy (Safari vecchi, HTTP, permesso negato)
  }
  // Path legacy: textarea temporanea + execCommand('copy')
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Genera il markdown del diario di una data (tutti i pasti + totali).
 *  Formato human-readable, adatto per WhatsApp/Telegram/email. */
export function formatDiaryAsMarkdown(date: string): string {
  const state = getState();
  const entries = state.diary[date] || [];
  const dateLabel = formatDateIT(date);
  if (entries.length === 0) {
    return `# NutriTrack — ${dateLabel}\n\n*Nessuna voce registrata per questa data.*\n`;
  }

  const macroGrams = calcMacroGrams(state.settings.calorieGoal, state.settings.macroSplit);
  const allNutritions = entries.map((e) => {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    return scaleNutrition(e.foodSnapshot.nutrition, grams);
  });
  const totals = sumNutrition(allNutritions);

  const lines: string[] = [];
  lines.push(`# NutriTrack — ${dateLabel}`);
  lines.push('');
  lines.push(
    `**Totale giornata:** ${Math.round(totals.calories)} kcal · P ${Math.round(totals.protein)}g · C ${Math.round(totals.carbs)}g · G ${Math.round(totals.fat)}g`,
  );
  lines.push(
    `*Obiettivo: ${state.settings.calorieGoal} kcal (P ${macroGrams.protein}g · C ${macroGrams.carbs}g · G ${macroGrams.fat}g)*`,
  );
  lines.push('');

  for (const meal of MEAL_ORDER) {
    const mealEntries = entries.filter((e) => e.meal === meal);
    if (mealEntries.length === 0) continue;
    lines.push(`## ${MEAL_ICONS[meal]} ${MEAL_LABELS[meal]}`);
    for (const e of mealEntries) {
      const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
      const n = scaleNutrition(e.foodSnapshot.nutrition, grams);
      const qtyLabel = e.gramsOverride ? `${e.gramsOverride}g` : `${e.quantity}× ${e.foodSnapshot.servingSize}g`;
      const brand = e.foodSnapshot.brand ? ` (${e.foodSnapshot.brand})` : '';
      lines.push(`- **${e.foodSnapshot.name}**${brand} — ${qtyLabel} · ${Math.round(n.calories)} kcal`);
    }
    const mealNutritions = mealEntries.map((e) => {
      const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
      return scaleNutrition(e.foodSnapshot.nutrition, grams);
    });
    const mealTotals = sumNutrition(mealNutritions);
    lines.push(
      `  *Subtotale: ${Math.round(mealTotals.calories)} kcal · P ${Math.round(mealTotals.protein)}g · C ${Math.round(mealTotals.carbs)}g · G ${Math.round(mealTotals.fat)}g*`,
    );
    lines.push('');
  }

  // Biometria del giorno (se presente)
  const bio = state.biometrics[date] ?? {};
  const bioLines: string[] = [];
  if (bio.waterMl != null) bioLines.push(`💧 Acqua: ${Math.round(bio.waterMl)} ml`);
  if (bio.sleepHours != null) bioLines.push(`😴 Sonno: ${bio.sleepHours} h`);
  if (bio.weightKg != null) bioLines.push(`⚖️ Peso: ${bio.weightKg} kg`);
  if (bioLines.length > 0) {
    lines.push(`## Biometria`);
    lines.push(bioLines.join(' · '));
    lines.push('');
  }

  lines.push(`---`);
  lines.push(
    `*Generato da NutriTrack — ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}*`,
  );
  return lines.join('\n');
}

/** Genera il markdown di una ricetta (ingredienti + istruzioni porzioni + totali).
 *  Formato human-readable, adatto per condividere la ricetta con amici. */
export function formatRecipeAsMarkdown(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push(`# ${recipe.name}`);
  if (recipe.description) {
    lines.push('');
    lines.push(`> ${recipe.description}`);
  }
  lines.push('');
  lines.push(`**Porzioni:** ${recipe.servings}`);
  lines.push('');

  // Totali ricetta
  const nutritions = recipe.ingredients.map((ing) => scaleNutrition(ing.foodSnapshot.nutrition, ing.grams));
  const totals = sumNutrition(nutritions);
  const perServing = {
    calories: recipe.servings > 0 ? totals.calories / recipe.servings : 0,
    protein: recipe.servings > 0 ? totals.protein / recipe.servings : 0,
    carbs: recipe.servings > 0 ? totals.carbs / recipe.servings : 0,
    fat: recipe.servings > 0 ? totals.fat / recipe.servings : 0,
  };
  lines.push(
    `**Totale:** ${Math.round(totals.calories)} kcal · P ${Math.round(totals.protein)}g · C ${Math.round(totals.carbs)}g · G ${Math.round(totals.fat)}g`,
  );
  lines.push(
    `**Per porzione:** ${Math.round(perServing.calories)} kcal · P ${Math.round(perServing.protein)}g · C ${Math.round(perServing.carbs)}g · G ${Math.round(perServing.fat)}g`,
  );
  lines.push('');

  lines.push(`## Ingredienti`);
  for (const ing of recipe.ingredients) {
    const scaled = scaleNutrition(ing.foodSnapshot.nutrition, ing.grams);
    const brand = ing.foodSnapshot.brand ? ` (${ing.foodSnapshot.brand})` : '';
    lines.push(`- ${ing.grams}g **${ing.foodSnapshot.name}**${brand} — ${Math.round(scaled.calories)} kcal`);
  }
  lines.push('');
  lines.push(`---`);
  lines.push(
    `*Generato da NutriTrack — ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}*`,
  );
  return lines.join('\n');
}

/** Helper: copia il diario di una data negli appunti e mostra toast. */
export async function copyDiaryToClipboard(date: string): Promise<void> {
  const md = formatDiaryAsMarkdown(date);
  const ok = await copyToClipboard(md);
  if (ok) {
    (await import('../components/toast')).showToast('Diario copiato negli appunti', 'success', 2500);
  } else {
    (await import('../components/toast')).showToast('Impossibile copiare: permessi appunti negati', 'error', 4000);
  }
}

/** Helper: copia una ricetta negli appunti e mostra toast. */
export async function copyRecipeToClipboard(recipe: Recipe): Promise<void> {
  const md = formatRecipeAsMarkdown(recipe);
  const ok = await copyToClipboard(md);
  if (ok) {
    (await import('../components/toast')).showToast(`Ricetta "${recipe.name}" copiata`, 'success', 2500);
  } else {
    (await import('../components/toast')).showToast('Impossibile copiare: permessi appunti negati', 'error', 4000);
  }
}
