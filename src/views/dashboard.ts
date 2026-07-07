// Vista Dashboard: diario giornaliero con macro ring + bar + meal cards + riepilogo settimana via worker.

import { getState, openFoodSearch, setCurrentDate, emitChange, openEntryEditor } from '../lib/store';
import { removeDiaryEntry, changeEntryQuantity } from '../lib/diary';
import { calcMacroGrams, scaleNutrition, sumNutrition } from '../lib/nutrition';
import { escapeHtml, escapeAttr, formatDateIT, isToday, toDateKey, parseISODateLocal } from '../lib/utils';
import { imgTag } from '../components/img';
import { MEAL_LABELS, MEAL_ICONS, MEAL_ORDER } from '../types';
import type { DiaryEntry, MealType, DayTotals } from '../types';
import { computeStatsAsync } from '../worker/client';

let _dashBound = false;
let _weekStats: { days: DayTotals[]; avgCalories: number } | null = null;
let _weekStatsToken = 0;
// Signature cache: previene loop infinito worker -> emitChange -> render -> worker
let _weekStatsInputSig = '';
// Signature cache vista: previene re-render inutili di main.innerHTML
let _dashRenderSig = '';

/** Reset signature cache (chiamato dal renderer al cambio vista) */
export function resetDashboardSignature(): void {
  _dashRenderSig = '';
}

export function renderDashboard(main: HTMLElement): void {
  const state = getState();
  const diary = state.diary[state.currentDate] || [];
  const macroGrams = calcMacroGrams(state.settings.calorieGoal, state.settings.macroSplit);

  // Signature cache: se nessun dato rilevante è cambiato, skip del re-render completo.
  // Previene flickering quando emitChange viene chiamato per altri motivi (es. chiusura modal).
  const renderSig = JSON.stringify({
    date: state.currentDate,
    cal: state.settings.calorieGoal,
    split: state.settings.macroSplit,
    favCount: state.favoriteFoodIds.length,
    diarySig: diary.map((e) => `${e.id}:${e.quantity}:${e.gramsOverride ?? ''}`).join('|'),
    weekSig: _weekStats ? `${_weekStats.avgCalories}:${_weekStats.days.length}` : 'null',
  });
  if (renderSig === _dashRenderSig) {
    // Stato invariato: non distruggere il DOM. Aggiorna comunque week stats se serve.
    maybeLaunchWeekStatsWorker(state);
    return;
  }
  _dashRenderSig = renderSig;

  // Totale giornata
  const nutritions = diary.map((e) => {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    return scaleNutrition(e.foodSnapshot.nutrition, grams);
  });
  const totals = sumNutrition(nutritions);

  // Totali per meal
  const byMeal: Record<MealType, { calories: number; protein: number; carbs: number; fat: number; count: number }> = {
    breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    lunch:     { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    dinner:    { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    snack:     { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  };
  for (const e of diary) {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    const n = scaleNutrition(e.foodSnapshot.nutrition, grams);
    byMeal[e.meal].calories += n.calories;
    byMeal[e.meal].protein  += n.protein;
    byMeal[e.meal].carbs    += n.carbs;
    byMeal[e.meal].fat      += n.fat;
    byMeal[e.meal].count    += 1;
  }

  const mealCards = MEAL_ORDER.map((meal) => {
    const entries = diary.filter((e) => e.meal === meal);
    const t = byMeal[meal];
    const header = `
      <div class="meal-head">
        <div class="meal-info">
          <span class="meal-icon" aria-hidden="true">${MEAL_ICONS[meal]}</span>
          <div>
            <h3 class="meal-title">${escapeHtml(MEAL_LABELS[meal])}</h3>
            <p class="meal-meta">${Math.round(t.calories)} kcal${t.count > 0 ? ` · P${Math.round(t.protein)} C${Math.round(t.carbs)} G${Math.round(t.fat)}` : ''}</p>
          </div>
        </div>
        <button type="button" class="icon-btn" data-action="addMeal" data-meal="${meal}" aria-label="Aggiungi a ${escapeAttr(MEAL_LABELS[meal])}">＋</button>
      </div>
    `;
    const body = entries.length > 0
      ? `<div class="meal-entries">${entries.map((e) => entryRow(e)).join('')}</div>`
      : `<button type="button" class="add-food-btn" data-action="addMeal" data-meal="${meal}"><span aria-hidden="true">🍪</span> Aggiungi alimento</button>`;
    return `<section class="card meal-card">${header}${body}</section>`;
  }).join('');

  const weekSummary = _weekStats
    ? `
      <section class="card week-summary">
        <h3 class="section-title">Ultimi 7 giorni</h3>
        <div class="week-bars">
          ${_weekStats.days.map((d) => {
            const ratio = state.settings.calorieGoal > 0 ? Math.min(d.calories / state.settings.calorieGoal, 1.2) : 0;
            const over = d.calories > state.settings.calorieGoal && state.settings.calorieGoal > 0;
            const height = Math.max(2, ratio * 60);
            const dateLabel = parseISODateLocal(d.date).toLocaleDateString('it-IT', { weekday: 'short' });
            const isCurrent = d.date === state.currentDate;
            return `
              <div class="week-bar${isCurrent ? ' current' : ''}${over ? ' over' : ''}" title="${escapeAttr(d.date)}: ${Math.round(d.calories)} kcal">
                <div class="week-bar-fill" style="height:${height}px"></div>
                <span class="week-bar-label">${escapeHtml(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1, 3))}</span>
              </div>
            `;
          }).join('')}
        </div>
        <p class="week-avg">Media: <strong>${_weekStats.avgCalories} kcal/giorno</strong></p>
      </section>
    `
    : `
      <section class="card week-summary">
        <h3 class="section-title">Ultimi 7 giorni</h3>
        <div class="week-loading"><div class="spinner" aria-hidden="true"></div> Calcolo statistiche…</div>
      </section>
    `;

  main.innerHTML = `
    <div class="dashboard">
      <div class="date-nav">
        <button type="button" class="icon-btn" data-action="shiftDate" data-delta="-1" aria-label="Giorno precedente">‹</button>
        <div class="date-display">
          <span class="date-label">${escapeHtml(formatDateIT(state.currentDate))}</span>
          ${isToday(state.currentDate) ? '<span class="badge badge-secondary">Oggi</span>' : ''}
        </div>
        <button type="button" class="icon-btn" data-action="shiftDate" data-delta="1" aria-label="Giorno successivo">›</button>
      </div>

      <section class="card overview-card">
        <div class="overview-grid">
          <div class="macro-ring-container">
            ${macroRing(totals.calories, state.settings.calorieGoal, 180)}
          </div>
          <div class="macro-bars">
            ${macroBar('Proteine',    totals.protein, macroGrams.protein, 'var(--color-protein)')}
            ${macroBar('Carboidrati', totals.carbs,   macroGrams.carbs,   'var(--color-carbs)')}
            ${macroBar('Grassi',      totals.fat,     macroGrams.fat,     'var(--color-fat)')}
            <div class="macro-split-info">
              <span>Obiettivo macro:</span>
              <span>P${state.settings.macroSplit.proteinPct}% · C${state.settings.macroSplit.carbsPct}% · G${state.settings.macroSplit.fatPct}%</span>
            </div>
          </div>
        </div>
      </section>

      ${weekSummary}

      <div class="meals">${mealCards}</div>
    </div>
  `;

  bindDashboardEvents(main);

  // Avvia calcolo settimana in worker (con signature cache per evitare loop)
  maybeLaunchWeekStatsWorker(state);
}

/** Lancia il worker solo se l'input è cambiato (previene loop worker -> emitChange -> render -> worker). */
function maybeLaunchWeekStatsWorker(state: ReturnType<typeof getState>): void {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(toDateKey(d));
  }
  const allEntries: DiaryEntry[] = [];
  for (const d of dates) {
    const list = state.diary[d];
    if (list) allEntries.push(...list);
  }
  // Signature: dates + entries identity + qty + gramsOverride
  const sig = dates.join(',') + '|' + allEntries.map((e) => `${e.id}:${e.quantity}:${e.gramsOverride ?? ''}`).join('|');
  if (sig === _weekStatsInputSig) return; // già calcolato per questo input
  _weekStatsInputSig = sig;

  const token = ++_weekStatsToken;
  void computeStatsAsync(allEntries, dates).then((res) => {
    if (token !== _weekStatsToken) return; // obsolete
    _weekStats = { days: res.days, avgCalories: res.avgCalories };
    emitChange();
  });
}

function entryRow(e: DiaryEntry): string {
  const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
  const n = scaleNutrition(e.foodSnapshot.nutrition, grams);
  const qtyControl = !e.gramsOverride
    ? `
      <div class="qty-control">
        <button type="button" class="qty-btn" data-action="qtyDec" data-entry-id="${escapeAttr(e.id)}" aria-label="Diminuisci">−</button>
        <span class="qty-value">${e.quantity}×</span>
        <button type="button" class="qty-btn" data-action="qtyInc" data-entry-id="${escapeAttr(e.id)}" aria-label="Aumenta">＋</button>
      </div>
    `
    : '';
  return `
    <div class="entry-row" data-action="editEntry" data-entry-id="${escapeAttr(e.id)}" role="button" tabindex="0" aria-label="Modifica quantità di ${escapeAttr(e.foodSnapshot.name)}">
      ${imgTag(e.foodSnapshot.image, e.foodSnapshot.name, 'thumb', e.foodSnapshot.source === 'custom' ? '✏️' : '🥫')}
      <div class="entry-info">
        <p class="entry-name">${escapeHtml(e.foodSnapshot.name)}</p>
        <p class="entry-meta">
          ${e.gramsOverride ? `${e.gramsOverride}g` : `${e.quantity}× ${e.foodSnapshot.servingSize}g`}
          · <strong>${Math.round(n.calories)} kcal</strong>
          · P${Math.round(n.protein)} C${Math.round(n.carbs)} G${Math.round(n.fat)}
        </p>
      </div>
      ${qtyControl}
      <button type="button" class="icon-btn danger" data-action="deleteEntry" data-entry-id="${escapeAttr(e.id)}" aria-label="Elimina">🗑</button>
    </div>
  `;
}

function macroRing(value: number, goal: number, size: number): string {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
  const offset = circumference * (1 - ratio);
  const remaining = Math.max(goal - value, 0);
  const over = value > goal;
  return `
    <div class="macro-ring" style="width:${size}px;height:${size}px">
      <svg class="macro-ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--bg-muted)" stroke-width="${stroke}" />
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${over ? 'var(--color-danger)' : 'var(--color-primary)'}" stroke-width="${stroke}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition:stroke-dashoffset 0.6s ease, stroke 0.3s ease" />
      </svg>
      <div class="macro-ring-inner">
        <span class="macro-ring-value">${Math.round(value)}</span>
        <span class="macro-ring-goal">/ ${goal} kcal</span>
        <span class="macro-ring-remain ${over ? 'over' : ''}">${over ? `+${Math.round(value - goal)} kcal` : `${Math.round(remaining)} rimaste`}</span>
      </div>
    </div>
  `;
}

function macroBar(label: string, value: number, goal: number, color: string): string {
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
  const pct = Math.round(ratio * 100);
  const over = value > goal;
  return `
    <div class="macro-bar">
      <div class="macro-bar-head">
        <span class="macro-bar-label">${escapeHtml(label)}</span>
        <span class="macro-bar-values">
          <strong class="${over ? 'over' : ''}">${Math.round(value)}</strong> / ${Math.round(goal)}<span class="unit">g</span>
        </span>
      </div>
      <div class="macro-bar-track">
        <div class="macro-bar-fill${over ? ' over' : ''}" style="width:${pct}%;background-color:${over ? 'var(--color-danger)' : color}"></div>
      </div>
    </div>
  `;
}

// ============ Event bindings (delegated sul main) ============

function bindDashboardEvents(main: HTMLElement): void {
  if (_dashBound) return;
  _dashBound = true;
  main.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    const state = getState();

    if (action === 'addMeal') {
      const meal = target.dataset.meal as MealType;
      if (meal) openFoodSearch(meal, state.currentDate);
      return;
    }
    if (action === 'shiftDate') {
      const delta = Number(target.dataset.delta || '0');
      const d = parseISODateLocal(state.currentDate);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + delta);
        setCurrentDate(toDateKey(d));
      }
      return;
    }
    if (action === 'deleteEntry') {
      // stopPropagation non necessario: closest già trova il bottone delete (più vicino)
      const id = target.dataset.entryId || '';
      if (id) removeDiaryEntry(id);
      return;
    }
    if (action === 'qtyInc' || action === 'qtyDec') {
      const id = target.dataset.entryId || '';
      const delta = action === 'qtyInc' ? 0.5 : -0.5;
      const entry = state.diary[state.currentDate]?.find((en) => en.id === id);
      if (entry) changeEntryQuantity(id, delta, entry.quantity);
      return;
    }
    if (action === 'editEntry') {
      const id = target.dataset.entryId || '';
      if (id) openEntryEditor(id);
      return;
    }
  });

  // Supporto tastiera (Enter/Space) per accessibilità sulla riga della entry
  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action="editEntry"]');
    if (!target) return;
    e.preventDefault();
    const id = target.dataset.entryId || '';
    if (id) openEntryEditor(id);
  });
}
