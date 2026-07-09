// Vista Dashboard: diario giornaliero con macro ring + bar + meal cards + riepilogo settimana via worker.

import { getState, openFoodSearch, setCurrentDate, emitChange, openEntryEditor } from '../lib/store';
import { removeDiaryEntry, changeEntryQuantity } from '../lib/diary';
import { calcMacroGrams, scaleNutrition, sumNutrition } from '../lib/nutrition';
import {
  escapeHtml,
  escapeAttr,
  formatDateIT,
  isToday,
  toDateKey,
  parseISODateLocal,
  isValidDateKey,
} from '../lib/utils';
import { imgTag } from '../components/img';
import { MEAL_LABELS, MEAL_ICONS, MEAL_ORDER } from '../types';
import type { DiaryEntry, MealType } from '../types';
import { computeStatsAsync } from '../worker/client';
import {
  addWaterGlass,
  removeWaterGlass,
  setSleep,
  setWeight,
  computeWeightTrend,
  computeWeightMovingAverage,
  getBiometricForDisplay,
  WATER_GLASS_ML,
  WATER_GOAL_ML,
} from '../lib/biometrics';
import { copyDiaryToClipboard } from '../lib/clipboard';
import { getRecentFoods, quickAddRecentFood } from '../lib/recentFoods';
import { computeStreak, getBadgeStatuses, countUnlockedBadges } from '../lib/gamification';
import { showToast } from '../components/toast';
// Fix CI: signature cache spostate in modulo condiviso per non rompere code-splitting
import {
  getDashRenderSig,
  setDashRenderSig,
  getWeekStats,
  setWeekStats,
  getWeekStatsInputSig,
  setWeekStatsInputSig,
  getStatsTab,
  setStatsTab,
  getMonthStats,
  setMonthStats,
  getMonthStatsInputSig,
  setMonthStatsInputSig,
  getYearStats,
  setYearStats,
  getYearStatsInputSig,
  setYearStatsInputSig,
  resetDashboardSignature as resetDashSig,
} from './signatures';
import type { StatsTab } from './signatures';
// Re-export per compatibilità (renderer importava resetDashboardSignature da qui)
export { resetDashSig as resetDashboardSignature };

let _dashBound = false;
let _weekStatsToken = 0;

export function renderDashboard(main: HTMLElement): void {
  const state = getState();
  const diary = state.diary[state.currentDate] || [];
  const macroGrams = calcMacroGrams(state.settings.calorieGoal, state.settings.macroSplit);

  // Signature cache: se nessun dato rilevante è cambiato, skip del re-render completo.
  // Previene flickering quando emitChange viene chiamato per altri motivi (es. chiusura modal).
  const bioToday = state.biometrics[state.currentDate] ?? {};
  const renderSig = JSON.stringify({
    date: state.currentDate,
    cal: state.settings.calorieGoal,
    split: state.settings.macroSplit,
    favCount: state.favoriteFoodIds.length,
    diarySig: diary.map((e) => `${e.id}:${e.quantity}:${e.gramsOverride ?? ''}`).join('|'),
    weekSig: getWeekStats() ? `${getWeekStats()!.avgCalories}:${getWeekStats()!.days.length}` : 'null',
    statsTab: getStatsTab(),
    monthSig: getMonthStats() ? `${getMonthStats()!.avgCalories}:${getMonthStats()!.days.length}` : 'null',
    yearSig: getYearStats() ? `${getYearStats()!.avgCalories}:${getYearStats()!.days.length}` : 'null',
    bio: `${bioToday.waterMl ?? ''}:${bioToday.sleepHours ?? ''}:${bioToday.weightKg ?? ''}`,
    bioKeys: Object.keys(state.biometrics).length,
  });
  if (renderSig === getDashRenderSig()) {
    // Stato invariato: non distruggere il DOM. Aggiorna comunque le stats del tab attivo.
    launchActiveStatsWorker(state);
    return;
  }
  setDashRenderSig(renderSig);

  // Totale giornata
  const nutritions = diary.map((e) => {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    return scaleNutrition(e.foodSnapshot.nutrition, grams);
  });
  const totals = sumNutrition(nutritions);

  // Totali per meal
  const byMeal: Record<MealType, { calories: number; protein: number; carbs: number; fat: number; count: number }> = {
    breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    lunch: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    dinner: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    snack: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  };
  for (const e of diary) {
    const grams = e.gramsOverride ?? e.foodSnapshot.servingSize * e.quantity;
    const n = scaleNutrition(e.foodSnapshot.nutrition, grams);
    byMeal[e.meal].calories += n.calories;
    byMeal[e.meal].protein += n.protein;
    byMeal[e.meal].carbs += n.carbs;
    byMeal[e.meal].fat += n.fat;
    byMeal[e.meal].count += 1;
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
    const body =
      entries.length > 0
        ? `<div class="meal-entries">${entries.map((e) => entryRow(e)).join('')}</div>`
        : `<button type="button" class="add-food-btn" data-action="addMeal" data-meal="${meal}"><span aria-hidden="true">🍪</span> Aggiungi alimento</button>`;
    return `<section class="card meal-card">${header}${body}</section>`;
  }).join('');

  const statsCard = renderStatsCard(state);

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
            ${macroBar('Proteine', totals.protein, macroGrams.protein, 'var(--color-protein)')}
            ${macroBar('Carboidrati', totals.carbs, macroGrams.carbs, 'var(--color-carbs)')}
            ${macroBar('Grassi', totals.fat, macroGrams.fat, 'var(--color-fat)')}
            <div class="macro-split-info">
              <span>Obiettivo macro:</span>
              <span>P${state.settings.macroSplit.proteinPct}% · C${state.settings.macroSplit.carbsPct}% · G${state.settings.macroSplit.fatPct}%</span>
            </div>
          </div>
        </div>
      </section>

      ${statsCard}

      ${renderBiometricCard(state.currentDate)}

      ${renderRecentFoodsCard(state)}

      <div class="meals-head-row">
        <h3 class="section-title">Pasti</h3>
        <button type="button" class="btn btn-outline btn-sm" data-action="copyDiary" aria-label="Copia il diario come testo">📋 Copia</button>
      </div>
      <div class="meals">${mealCards}</div>

      ${renderStreakCard()}
    </div>
  `;

  bindDashboardEvents(main);

  // Avvia calcolo statistiche per il tab attivo (con signature cache per evitare loop)
  launchActiveStatsWorker(state);
}

// ============ Biometrica card (P1 #3) ============

/** Renderizza la card Biometrica: acqua (quick-add bicchieri), sonno, peso +
 *  mini sparkline SVG del trend peso degli ultimi 14 giorni con dato. */
function renderBiometricCard(date: string): string {
  const state = getState();
  const display = getBiometricForDisplay(state.biometrics, date);
  const waterMl = display.waterMl ?? 0;
  const waterGoal = WATER_GOAL_ML;
  const waterPct = waterGoal > 0 ? Math.min(100, Math.round((waterMl / waterGoal) * 100)) : 0;
  const glasses = Math.round(waterMl / WATER_GLASS_ML);

  // Sparkline trend peso: ultimi 14 punti con dato, con media mobile 7gg
  const allPoints = computeWeightTrend(state.biometrics);
  const recentPoints = allPoints.slice(-14);
  const maPoints = computeWeightMovingAverage(recentPoints, 7);
  const sparkline = renderWeightSparkline(maPoints);

  const weightInferredNote = display.weightKgInferred
    ? `<p class="bio-hint">Peso dall'ultima registrazione (${escapeHtml(formatDateIT(getLatestWeightDate(state.biometrics)))})</p>`
    : '';

  return `
    <section class="card biometric-card" aria-label="Biometria giornaliera">
      <div class="bio-head">
        <h3 class="section-title">Biometrica</h3>
        <span class="bio-date">${escapeHtml(formatDateIT(date))}</span>
      </div>

      <div class="bio-grid">
        <div class="bio-cell bio-water">
          <div class="bio-cell-head">
            <span class="bio-icon" aria-hidden="true">💧</span>
            <div>
              <p class="bio-label">Acqua</p>
              <p class="bio-value">${Math.round(waterMl)} <span class="bio-unit">ml</span></p>
            </div>
          </div>
          <div class="bio-water-progress">
            <div class="bio-water-fill" style="width:${waterPct}%"></div>
          </div>
          <p class="bio-sub">${glasses} bicchieri · ${waterPct}% di ${waterGoal / 1000} L</p>
          <div class="bio-water-buttons">
            <button type="button" class="qty-btn" data-action="waterDec" aria-label="Meno acqua">−</button>
            <button type="button" class="qty-btn" data-action="waterInc" aria-label="Più acqua">＋</button>
          </div>
        </div>

        <div class="bio-cell bio-sleep">
          <div class="bio-cell-head">
            <span class="bio-icon" aria-hidden="true">😴</span>
            <div>
              <p class="bio-label">Sonno</p>
              <p class="bio-value">${display.sleepHours != null ? escapeHtml(String(display.sleepHours)) : '—'} <span class="bio-unit">ore</span></p>
            </div>
          </div>
          <div class="bio-input-row">
            <input id="bio-sleep-input" type="number" min="0" max="24" step="0.5" inputmode="decimal" placeholder="ore" value="${display.sleepHours != null ? escapeAttr(String(display.sleepHours)) : ''}" aria-label="Ore di sonno" />
          </div>
        </div>

        <div class="bio-cell bio-weight">
          <div class="bio-cell-head">
            <span class="bio-icon" aria-hidden="true">⚖️</span>
            <div>
              <p class="bio-label">Peso</p>
              <p class="bio-value">${display.weightKg != null ? escapeHtml(String(display.weightKg)) : '—'} <span class="bio-unit">kg</span></p>
            </div>
          </div>
          <div class="bio-input-row">
            <input id="bio-weight-input" type="number" min="20" max="500" step="0.1" inputmode="decimal" placeholder="kg" value="${display.weightKg != null ? escapeAttr(String(display.weightKg)) : ''}" aria-label="Peso in kg" />
          </div>
          ${weightInferredNote}
        </div>
      </div>

      ${sparkline}
    </section>
  `;
}

/** Helper: ritorna la data dell'ultimo peso registrato (per la nota "inferred"). */
function getLatestWeightDate(biometrics: ReturnType<typeof getState>['biometrics']): string {
  const points = computeWeightTrend(biometrics);
  return points.length > 0 ? points[points.length - 1].date : '';
}

/** Mini sparkline SVG del trend peso. Mostra punti grezzi + linea media mobile 7gg.
 *  Se ci sono meno di 2 punti, mostra un hint testuale. */
function renderWeightSparkline(points: ReturnType<typeof computeWeightMovingAverage>): string {
  if (points.length < 2) {
    return `<p class="bio-spark-empty">Registra il peso per almeno 2 giorni per vedere il trend.</p>`;
  }
  const W = 280;
  const H = 60;
  const PAD = 6;
  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1; // evita divisione per 0 se tutti uguali
  const xStep = (W - PAD * 2) / (points.length - 1);

  const yFor = (w: number): number => {
    // Invertito: peso maggiore → Y minore
    return PAD + (1 - (w - min) / range) * (H - PAD * 2);
  };

  const rawPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(PAD + i * xStep).toFixed(1)} ${yFor(p.weightKg).toFixed(1)}`)
    .join(' ');
  const maPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(PAD + i * xStep).toFixed(1)} ${yFor(p.ma7 ?? p.weightKg).toFixed(1)}`)
    .join(' ');

  const rawDots = points
    .map(
      (p, i) =>
        `<circle cx="${(PAD + i * xStep).toFixed(1)}" cy="${yFor(p.weightKg).toFixed(1)}" r="2.5" fill="var(--color-fat)" />`,
    )
    .join('');

  const delta = points[points.length - 1].weightKg - points[0].weightKg;
  const deltaSign = delta > 0 ? '+' : '';
  const deltaColor =
    Math.abs(delta) < 0.05 ? 'var(--text-muted)' : delta > 0 ? 'var(--color-danger)' : 'var(--color-primary)';

  return `
    <div class="bio-spark">
      <div class="bio-spark-head">
        <span class="bio-spark-title">Trend peso · ${points.length} registrazioni</span>
        <span class="bio-spark-delta" style="color:${deltaColor}">${deltaSign}${round1(delta)} kg</span>
      </div>
      <svg class="bio-spark-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Trend peso">
        <path d="${rawPath}" fill="none" stroke="var(--bg-muted)" stroke-width="1.5" stroke-linejoin="round" />
        <path d="${maPath}" fill="none" stroke="var(--color-fat)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${rawDots}
      </svg>
      <div class="bio-spark-legend">
        <span><span class="legend-dot" style="background:var(--color-fat)"></span> Media mobile 7gg</span>
        <span class="bio-spark-range">${escapeHtml(String(round1(min)))}–${escapeHtml(String(round1(max)))} kg</span>
      </div>
    </div>
  `;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ============ Recent foods card (P2 #2) ============

/** Renderizza la card "Aggiunti di recente" con quick-add 1-click.
 *  Nascosta se non ci sono alimenti recenti (diario vuoto). */
function renderRecentFoodsCard(_state: ReturnType<typeof getState>): string {
  const recents = getRecentFoods(10);
  if (recents.length === 0) return '';

  const chips = recents
    .map((r) => {
      const f = r.food;
      const cal = Math.round((f.nutrition.calories * f.servingSize) / 100);
      return `
        <button type="button" class="recent-chip" data-action="quickAddRecent" data-food-id="${escapeAttr(f.id)}" title="${escapeAttr(f.name)} · ${f.servingSize}g · ${cal} kcal · usato ${r.useCount}×" aria-label="Aggiungi rapidamente ${escapeAttr(f.name)}">
          ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
          <div class="recent-chip-info">
            <p class="recent-chip-name">${escapeHtml(f.name)}</p>
            <p class="recent-chip-meta">${f.servingSize}g · ${cal} kcal</p>
          </div>
          <span class="recent-chip-add" aria-hidden="true">＋</span>
        </button>
      `;
    })
    .join('');

  return `
    <section class="card recent-card" aria-label="Aggiunti di recente">
      <div class="recent-head">
        <h3 class="section-title">Aggiunti di recente</h3>
        <span class="recent-hint">1-tap per aggiungere alla data corrente</span>
      </div>
      <div class="recent-list">${chips}</div>
    </section>
  `;
}

// ============ Streak & badges card (P3 #1) ============

/** Renderizza la card gamification: streak corrente + badge sbloccabili.
 *  Card sempre visibile (anche con streak 0) per motivare l'utente. */
function renderStreakCard(): string {
  const state = getState();
  const streak = computeStreak(state.diary);
  const badges = getBadgeStatuses(state);
  const unlockedCount = countUnlockedBadges(state);
  const totalCount = badges.length;

  const streakFlame = streak.current > 0 ? '🔥' : '💤';
  const streakLabel =
    streak.current > 0 ? `${streak.current} ${streak.current === 1 ? 'giorno' : 'giorni'} consecutivi` : 'Inizia oggi!';
  const streakSub =
    streak.longest > 0
      ? `Record personale: ${streak.longest} giorni`
      : 'Registra almeno 1 alimento per iniziare lo streak';

  const badgesHtml = badges
    .map((b) => {
      const cls = b.unlocked ? 'badge-tile unlocked' : 'badge-tile locked';
      return `
        <div class="${cls}" title="${escapeAttr(b.name)} — ${escapeAttr(b.description)}">
          <span class="badge-tile-icon" aria-hidden="true">${b.icon}</span>
          <div class="badge-tile-info">
            <p class="badge-tile-name">${escapeHtml(b.name)}</p>
            <p class="badge-tile-desc">${escapeHtml(b.description)}</p>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <section class="card streak-card" aria-label="Streak e badge">
      <div class="streak-head">
        <h3 class="section-title">Il tuo percorso</h3>
        <span class="streak-count">${unlockedCount}/${totalCount} badge</span>
      </div>
      <div class="streak-current">
        <span class="streak-flame" aria-hidden="true">${streakFlame}</span>
        <div>
          <p class="streak-label">${escapeHtml(streakLabel)}</p>
          <p class="streak-sub">${escapeHtml(streakSub)}</p>
        </div>
      </div>
      <div class="badge-grid">${badgesHtml}</div>
    </section>
  `;
}

// ============ Stats card con tab Settimana/Mese/Anno (P1 #1) ============

/** Renderizza la card Statistiche con 3 tab (Settimana/Mese/Anno) + trend peso SVG. */
function renderStatsCard(state: ReturnType<typeof getState>): string {
  const tab = getStatsTab();
  const tabBtn = (id: StatsTab, label: string) =>
    `<button type="button" class="tab-btn${tab === id ? ' active' : ''}" data-action="statsTab" data-tab="${id}">${escapeHtml(label)}</button>`;

  let body: string;
  if (tab === 'week') {
    body = renderWeekTab(state);
  } else if (tab === 'month') {
    body = renderMonthTab(state);
  } else {
    body = renderYearTab(state);
  }

  // Trend peso: mostra solo se ci sono almeno 2 registrazioni.
  const weightChart = renderWeightTrendChart(state);

  return `
    <section class="card stats-card" aria-label="Statistiche">
      <div class="stats-head">
        <h3 class="section-title">Statistiche</h3>
        <div class="stats-tabs" role="tablist">
          ${tabBtn('week', 'Settimana')}
          ${tabBtn('month', 'Mese')}
          ${tabBtn('year', 'Anno')}
        </div>
      </div>
      <div class="stats-body">${body}</div>
      ${weightChart}
    </section>
  `;
}

/** Tab Settimana: 7 barre verticali (comportamento originale). */
function renderWeekTab(state: ReturnType<typeof getState>): string {
  const stats = getWeekStats();
  if (!stats) {
    return `<div class="week-loading"><div class="spinner" aria-hidden="true"></div> Calcolo statistiche…</div>`;
  }
  const bars = stats.days
    .map((d) => {
      const ratio = state.settings.calorieGoal > 0 ? Math.min(d.calories / state.settings.calorieGoal, 1.2) : 0;
      const over = d.calories > state.settings.calorieGoal && state.settings.calorieGoal > 0;
      const height = Math.max(2, ratio * 60);
      const dateLabel = parseISODateLocal(d.date).toLocaleDateString('it-IT', { weekday: 'short' });
      const isCurrent = d.date === state.currentDate;
      const overPct =
        over && state.settings.calorieGoal > 0 ? Math.round((d.calories / state.settings.calorieGoal - 1) * 100) : 0;
      const overBadge = over ? ` <span class="week-bar-over">+${overPct}%</span>` : '';
      return `
        <button type="button" class="week-bar${isCurrent ? ' current' : ''}${over ? ' over' : ''}" data-action="goToDate" data-date="${escapeAttr(d.date)}" title="${escapeAttr(d.date)}: ${Math.round(d.calories)} kcal" aria-label="Vai al ${escapeAttr(formatDateIT(d.date))}: ${Math.round(d.calories)} kcal">
          <div class="week-bar-fill" style="height:${height}px"></div>
          <span class="week-bar-label">${escapeHtml(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1, 3))}</span>
          ${overBadge}
        </button>
      `;
    })
    .join('');
  return `
    <div class="week-bars">${bars}</div>
    <p class="week-avg">Media: <strong>${stats.avgCalories} kcal/giorno</strong> · ${stats.days.filter((d) => d.count > 0).length}/7 giorni registrati</p>
  `;
}

/** Tab Mese: 30 barre verticali più compatte. */
function renderMonthTab(state: ReturnType<typeof getState>): string {
  const stats = getMonthStats();
  if (!stats) {
    return `<div class="week-loading"><div class="spinner" aria-hidden="true"></div> Calcolo statistiche…</div>`;
  }
  const maxCal = Math.max(1, ...stats.days.map((d) => d.calories));
  const bars = stats.days
    .map((d) => {
      const ratio = maxCal > 0 ? Math.min(d.calories / maxCal, 1) : 0;
      const height = Math.max(2, ratio * 50);
      const over = d.calories > state.settings.calorieGoal && state.settings.calorieGoal > 0;
      const isCurrent = d.date === state.currentDate;
      return `
        <button type="button" class="month-bar${isCurrent ? ' current' : ''}${over ? ' over' : ''}" data-action="goToDate" data-date="${escapeAttr(d.date)}" title="${escapeAttr(d.date)}: ${Math.round(d.calories)} kcal" aria-label="Vai al ${escapeAttr(formatDateIT(d.date))}: ${Math.round(d.calories)} kcal">
          <div class="month-bar-fill" style="height:${height}px"></div>
        </button>
      `;
    })
    .join('');
  const tracked = stats.days.filter((d) => d.count > 0).length;
  return `
    <div class="month-bars">${bars}</div>
    <div class="month-axis"><span>30 giorni fa</span><span>oggi</span></div>
    <p class="week-avg">Media: <strong>${stats.avgCalories} kcal/giorno</strong> · ${tracked}/30 giorni registrati</p>
  `;
}

/** Tab Anno: heatmap 365 giorni stile GitHub contribution graph.
 *  Griglia di settimane (colonne) × giorni (righe). Colore per intensità calorica
 *  relativa all'obiettivo. */
function renderYearTab(state: ReturnType<typeof getState>): string {
  const stats = getYearStats();
  if (!stats) {
    return `<div class="week-loading"><div class="spinner" aria-hidden="true"></div> Calcolo statistiche…</div>`;
  }
  const goal = state.settings.calorieGoal;
  // Costruisci una mappa date -> calories per lookup veloce
  const calMap = new Map<string, number>();
  for (const d of stats.days) calMap.set(d.date, d.calories);

  // La heatmap ha 53 colonne (settimane) × 7 righe (giorni).
  // Allineiamo la prima colonna al giorno della settimana della prima data.
  const firstDate = parseISODateLocal(stats.days[0].date);
  const firstDayOfWeek = firstDate.getDay(); // 0=dom, 1=lun, ...
  const cellSize = 11;
  const gap = 2;
  const cols = 53;
  const rows = 7;
  const W = cols * (cellSize + gap);
  const H = rows * (cellSize + gap);

  // Funzione colore: 5 livelli stile GitHub
  const colorFor = (cal: number | undefined): string => {
    if (cal == null || cal === 0) return 'var(--bg-muted)';
    if (goal <= 0) {
      // Senza obiettivo: scala sul max osservato
      if (cal < 500) return 'rgba(16, 185, 129, 0.25)';
      if (cal < 1500) return 'rgba(16, 185, 129, 0.5)';
      if (cal < 2500) return 'rgba(16, 185, 129, 0.75)';
      return 'var(--color-primary)';
    }
    const ratio = cal / goal;
    if (ratio < 0.25) return 'rgba(16, 185, 129, 0.2)';
    if (ratio < 0.5) return 'rgba(16, 185, 129, 0.4)';
    if (ratio < 0.75) return 'rgba(16, 185, 129, 0.6)';
    if (ratio <= 1.0) return 'var(--color-primary)';
    // Over goal: rosso
    return 'var(--color-danger)';
  };

  const cells: string[] = [];
  // Offset iniziale: i primi firstDayOfWeek slot della prima colonna sono vuoti
  // (la prima data inizia dal suo giorno della settimana).
  // Iteriamo per 53 settimane × 7 giorni = 371 slot, ma mostriamo solo i 365 giorni.
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const slotIndex = col * rows + row;
      const dayOffset = slotIndex - firstDayOfWeek;
      if (dayOffset < 0 || dayOffset >= stats.days.length) {
        // Slot vuoto (padding iniziale o finale)
        continue;
      }
      const d = stats.days[dayOffset];
      const cal = calMap.get(d.date) ?? 0;
      const x = col * (cellSize + gap);
      const y = row * (cellSize + gap);
      const isCurrent = d.date === state.currentDate;
      const stroke = isCurrent ? 'stroke="var(--color-primary)" stroke-width="1.5"' : '';
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colorFor(cal)}" ${stroke} data-action="goToDate" data-date="${escapeAttr(d.date)}" role="button" tabindex="-1" aria-label="${escapeAttr(formatDateIT(d.date))}: ${Math.round(cal)} kcal"><title>${escapeAttr(d.date)}: ${Math.round(cal)} kcal</title></rect>`,
      );
    }
  }

  const tracked = stats.days.filter((d) => d.count > 0).length;
  return `
    <div class="year-heatmap-wrap">
      <svg class="year-heatmap" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Heatmap calorie ultimi 365 giorni">${cells.join('')}</svg>
    </div>
    <div class="year-legend">
      <span>meno</span>
      <span class="legend-cell" style="background:var(--bg-muted)"></span>
      <span class="legend-cell" style="background:rgba(16,185,129,0.2)"></span>
      <span class="legend-cell" style="background:rgba(16,185,129,0.4)"></span>
      <span class="legend-cell" style="background:rgba(16,185,129,0.6)"></span>
      <span class="legend-cell" style="background:var(--color-primary)"></span>
      <span class="legend-cell" style="background:var(--color-danger)"></span>
      <span>oltre obiettivo</span>
    </div>
    <p class="week-avg">Media: <strong>${stats.avgCalories} kcal/giorno</strong> · ${tracked}/365 giorni registrati</p>
  `;
}

/** Trend peso con line chart SVG (più grande dello sparkline nella card Biometrica).
 *  Mostra tutti i punti peso registrati con media mobile 7gg. Nascosto se < 2 punti. */
function renderWeightTrendChart(state: ReturnType<typeof getState>): string {
  const points = computeWeightTrend(state.biometrics);
  if (points.length < 2) return '';
  const maPoints = computeWeightMovingAverage(points, 7);

  const W = 320;
  const H = 110;
  const PAD_L = 36;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 18;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  // Aggiungi padding verticale del 10% per non toccare i bordi
  const yMin = min - range * 0.1;
  const yMax = max + range * 0.1;
  const yRange = yMax - yMin || 1;

  const xStep = plotW / (points.length - 1);
  const xFor = (i: number) => PAD_L + i * xStep;
  const yFor = (w: number) => PAD_T + (1 - (w - yMin) / yRange) * plotH;

  const rawPath = maPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.weightKg).toFixed(1)}`)
    .join(' ');
  const maPath = maPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.ma7 ?? p.weightKg).toFixed(1)}`)
    .join(' ');
  const dots = maPoints
    .map(
      (p, i) =>
        `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.weightKg).toFixed(1)}" r="2" fill="var(--color-fat)" />`,
    )
    .join('');

  // Etichette asse Y (min / max)
  const yMinLabel = `<text x="${PAD_L - 4}" y="${yFor(yMin).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text-muted)">${round1(yMin)}</text>`;
  const yMaxLabel = `<text x="${PAD_L - 4}" y="${yFor(yMax).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text-muted)">${round1(yMax)}</text>`;

  // Etichette asse X (prima e ultima data)
  const firstDate = points[0].date.slice(5); // MM-DD
  const lastDate = points[points.length - 1].date.slice(5);
  const xFirstLabel = `<text x="${PAD_L}" y="${H - 4}" text-anchor="start" font-size="9" fill="var(--text-muted)">${escapeHtml(firstDate)}</text>`;
  const xLastLabel = `<text x="${W - PAD_R}" y="${H - 4}" text-anchor="end" font-size="9" fill="var(--text-muted)">${escapeHtml(lastDate)}</text>`;

  const delta = points[points.length - 1].weightKg - points[0].weightKg;
  const deltaSign = delta > 0 ? '+' : '';
  const deltaColor =
    Math.abs(delta) < 0.05 ? 'var(--text-muted)' : delta > 0 ? 'var(--color-danger)' : 'var(--color-primary)';

  return `
    <div class="stats-weight-chart">
      <div class="stats-weight-head">
        <span class="stats-weight-title">Trend peso · ${points.length} registrazioni</span>
        <span class="stats-weight-delta" style="color:${deltaColor}">${deltaSign}${round1(delta)} kg</span>
      </div>
      <svg class="stats-weight-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trend peso nel tempo">
        ${yMinLabel}${yMaxLabel}
        <path d="${rawPath}" fill="none" stroke="var(--bg-muted)" stroke-width="1" stroke-linejoin="round" />
        <path d="${maPath}" fill="none" stroke="var(--color-fat)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
        ${xFirstLabel}${xLastLabel}
      </svg>
    </div>
  `;
}

/** P1 #1: lancia il worker per il tab attivo (week/month/year).
 *  Fix 2.4 (T2): catch su rejection del worker per evitare spinner perenne + memory leak.
 *  Fix MEDIUM bug: ancoraggio a state.currentDate invece di new Date() — prima la sezione
 *  "Ultimi 7 giorni" mostrava sempre gli ultimi 7 giorni da today, ignorando la data
 *  selezionata nel dashboard. Ora se l'utente naviga a una data passata, vede la finestra
 *  che termina in quella data. */
function launchActiveStatsWorker(state: ReturnType<typeof getState>): void {
  launchStatsWorker(state, getStatsTab());
}

/** Helper generico: calcola le date dell'ultima finestra (7/30/365 giorni terminanti
 *  a state.currentDate), raccoglie le entry, lancia il worker se l'input è cambiato,
 *  salva il risultato nel signature cache corrispondente al tab.
 *  Fix 2.4 (T2): catch su rejection del worker per evitare spinner perenne + memory leak. */
function launchStatsWorker(state: ReturnType<typeof getState>, tab: StatsTab): void {
  // Fix MEDIUM bug: usa state.currentDate come anchor, non today.
  const anchor = isValidDateKey(state.currentDate) ? parseISODateLocal(state.currentDate) : new Date();
  const span = tab === 'week' ? 7 : tab === 'month' ? 30 : 365;
  const dates: string[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(anchor);
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

  if (tab === 'week') {
    if (sig === getWeekStatsInputSig()) return;
    setWeekStatsInputSig(sig);
  } else if (tab === 'month') {
    if (sig === getMonthStatsInputSig()) return;
    setMonthStatsInputSig(sig);
  } else {
    if (sig === getYearStatsInputSig()) return;
    setYearStatsInputSig(sig);
  }

  const token = ++_weekStatsToken;
  void computeStatsAsync(allEntries, dates)
    .then((res) => {
      if (token !== _weekStatsToken) return; // obsolete
      if (tab === 'week') setWeekStats({ days: res.days, avgCalories: res.avgCalories });
      else if (tab === 'month') setMonthStats({ days: res.days, avgCalories: res.avgCalories });
      else setYearStats({ days: res.days, avgCalories: res.avgCalories });
      emitChange();
    })
    .catch((err) => {
      console.error('[dashboard] worker stats error', err);
      // Reset signature per permettere retry al prossimo emitChange
      if (tab === 'week') setWeekStatsInputSig('');
      else if (tab === 'month') setMonthStatsInputSig('');
      else setYearStatsInputSig('');
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
  // Fix 2.9 (T2): usa floor invece di round per evitare 100% visuale prematuro
  // (prima: value/goal=0.995 → ratio=0.995 → pct=Math.round(99.5)=100 ma over=false)
  const over = value > goal;
  const pct = over ? 100 : Math.floor(ratio * 100);
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
    if (action === 'goToDate') {
      // Click su una barra della settimana → naviga a quel giorno.
      // Fix dead affordance: le .week-bar avevano cursor:pointer e tooltip ma nessun handler.
      const date = target.dataset.date || '';
      if (date && isValidDateKey(date)) {
        setCurrentDate(date);
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
      // Fix 2.2 (T2): passa gramsOverride corrente per preservare modalità grammi
      if (entry) changeEntryQuantity(id, delta, entry.quantity, entry.gramsOverride);
      return;
    }
    if (action === 'editEntry') {
      const id = target.dataset.entryId || '';
      if (id) openEntryEditor(id);
      return;
    }
    if (action === 'waterInc') {
      addWaterGlass(state.currentDate);
      return;
    }
    if (action === 'waterDec') {
      removeWaterGlass(state.currentDate);
      return;
    }
    if (action === 'statsTab') {
      const tab = target.dataset.tab as StatsTab | undefined;
      if (tab && (tab === 'week' || tab === 'month' || tab === 'year')) {
        setStatsTab(tab);
        emitChange();
      }
      return;
    }
    if (action === 'copyDiary') {
      void copyDiaryToClipboard(state.currentDate);
      return;
    }
    if (action === 'quickAddRecent') {
      const foodId = target.dataset.foodId || '';
      if (!foodId) return;
      // Recupera il food da state.foods (snapshot fresco) — i recenti derivano
      // dal diario, ma il food potrebbe essere stato eliminato nel frattempo.
      const food = state.foods.find((f) => f.id === foodId);
      if (!food) {
        showToast('Alimento non più disponibile (è stato eliminato?)', 'info', 3500);
        return;
      }
      quickAddRecentFood(food, state.currentDate);
      return;
    }
  });

  // Supporto tastiera (Enter/Space) per accessibilità sulla riga della entry
  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action="editEntry"]');
    if (!target) return;
    // Skip se il focus è su un bottone figlio (delete, +/−): lascia che il click nativo del bottone proceda
    if (e.target !== target) return;
    e.preventDefault();
    const id = target.dataset.entryId || '';
    if (id) openEntryEditor(id);
  });

  // Input biometrici (sonno / peso). Delegato sul main: si attiva solo quando
  // l'input è dentro la dashboard. Usiamo 'change' (non 'input') per evitare
  // re-render ad ogni keystroke che distruggerebbe il focus.
  main.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'bio-sleep-input') {
      const state = getState();
      const val = Number((target as HTMLInputElement).value);
      if ((target as HTMLInputElement).value === '') {
        setSleep(state.currentDate, 0); // cancella
      } else {
        setSleep(state.currentDate, val);
      }
      return;
    }
    if (target.id === 'bio-weight-input') {
      const state = getState();
      const val = Number((target as HTMLInputElement).value);
      if ((target as HTMLInputElement).value === '') {
        setWeight(state.currentDate, 0); // cancella
      } else {
        setWeight(state.currentDate, val);
      }
      return;
    }
  });
}
