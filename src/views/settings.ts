// Vista Settings: calorie goal, macro split, TDEE calculator, export/import, reset, about.

import { getState, setCalorieGoal, setMacroSplit, updateSettings, openResetConfirm, emitChange } from '../lib/store';
import { calcMacroGrams, calcBMR, calcTDEE, normalizeMacroSplit, kcalFromMacros, calcGoalAdjustedCalories } from '../lib/nutrition';
import { escapeHtml, escapeAttr, clamp } from '../lib/utils';
import { handleExport, handleImport } from '../components/exportImport';
import { showToast } from '../components/toast';
import { applyTheme } from '../components/renderer';
import { MACRO_PRESETS, ACTIVITY_LABELS, WEIGHT_GOAL_LABELS, MAX_WEEKLY_KG_RATE } from '../types';
import type { MacroSplit, Theme, Sex, ActivityLevel, WeightGoalType } from '../types';
// Fix CI: signature cache spostate in modulo condiviso per non rompere code-splitting
import { getSettingsRenderSig, setSettingsRenderSig, resetSettingsSignature as resetSettingsSig, registerViewReset } from './signatures';

let _settingsBound = false;
let _pendingMacroSplit: MacroSplit | null = null;

// Fix CI: registra il reset di _pendingMacroSplit nel registry del modulo signatures
// (così resetAllViewSignatures lo resetta senza che signatures.ts importi settings.ts)
registerViewReset(() => { _pendingMacroSplit = null; });

/** Reset signature cache + _pendingMacroSplit (chiamato dal renderer al cambio vista).
 *  Fix B6.4 (T6): resetta anche _pendingMacroSplit per evitare valori stale dopo resetAll. */
export function resetSettingsSignature(): void {
  resetSettingsSig();
  _pendingMacroSplit = null;
}

/** Update mirato del DOM per i display macro — preserva focus su input/slider.
 *  Usato durante il drag dei macro slider e la digitazione nel calorie input,
 *  invece di triggerare un full re-render che distruggerebbe il focus. */
function updateMacroDisplayLive(): void {
  const s = getState().settings;
  const split = _pendingMacroSplit ?? s.macroSplit;
  const macroGrams = calcMacroGrams(s.calorieGoal, split);
  const splitSum = split.proteinPct + split.carbsPct + split.fatPct;
  const kcalCheck = kcalFromMacros(macroGrams);

  const scope = document.querySelector('.settings-view');
  if (!scope) return;

  // Macro slider values spans (non toccare gli <input type="range">)
  const rows = scope.querySelectorAll<HTMLElement>('.macro-slider-row');
  const keys: Array<'proteinPct' | 'carbsPct' | 'fatPct'> = ['proteinPct', 'carbsPct', 'fatPct'];
  const gramsVals = [macroGrams.protein, macroGrams.carbs, macroGrams.fat];
  rows.forEach((row, i) => {
    const values = row.querySelector<HTMLElement>('.macro-slider-values');
    if (values && keys[i]) {
      values.innerHTML = `<strong>${split[keys[i]]}%</strong> · ${gramsVals[i]}g`;
    }
  });

  // Split sum badge
  const badge = scope.querySelector<HTMLElement>('.setting-head .badge');
  if (badge) {
    badge.className = `badge ${Math.abs(splitSum - 100) < 1 ? 'badge-secondary' : 'badge-danger'}`;
    badge.textContent = `Somma: ${splitSum}%`;
  }

  // Preview values
  const previewValues = scope.querySelector<HTMLElement>('.preview-values');
  if (previewValues) {
    previewValues.innerHTML = `P <strong>${macroGrams.protein}g</strong> · C <strong>${macroGrams.carbs}g</strong> · G <strong>${macroGrams.fat}g</strong>`;
  }
  const previewCheck = scope.querySelector<HTMLElement>('.preview-check');
  if (previewCheck) previewCheck.textContent = `Verifica kcal da macro: ${kcalCheck} kcal`;

  // Warning text (toggle visibility)
  let warning = scope.querySelector<HTMLElement>('.warning-text');
  if (Math.abs(splitSum - 100) > 0.5) {
    if (!warning) {
      const slidersContainer = scope.querySelector('.macro-sliders');
      if (slidersContainer) {
        warning = document.createElement('p');
        warning.className = 'warning-text';
        warning.textContent = 'Lo split non somma a 100%. Verrà normalizzato automaticamente al salvataggio.';
        slidersContainer.insertAdjacentElement('afterend', warning);
      }
    }
  } else if (warning) {
    warning.remove();
  }
}

/** Update mirato del DOM per il calorie goal dopo calcTdee.
 *  Fix auto-refresh: il renderSig in renderSettings NON include calorieGoal (per non
 *  distruggere il focus sul calorie-input durante la digitazione), quindi quando calcTdee
 *  chiama setCalorieGoal() + updateSettings() l'emitChange triggera render() ma renderSettings
 *  ritorna subito (signature cache hit) e l'input calorie / slider / macro preview NON si
 *  aggiornano. L'utente era costretto a cambiare pagina e tornare per vedere il nuovo valore.
 *  Questa funzione aggiorna direttamente i nodi DOM senza re-render. */
function updateCalorieGoalLive(
  newKcal: number,
  goalType: WeightGoalType,
  weeklyDeltaKg: number,
  dailyAdjustment: number,
  tdee: number,
): void {
  const scope = document.querySelector('.settings-view');
  if (!scope) return;

  // Aggiorna input calorie + slider
  const calInput = scope.querySelector<HTMLInputElement>('#calorie-input');
  if (calInput) calInput.value = String(newKcal);
  const calSlider = scope.querySelector<HTMLInputElement>('#calorie-slider');
  if (calSlider) calSlider.value = String(clamp(newKcal, 500, 10000));

  // Aggiorna macro preview (grammi target) coerenti con il nuovo obiettivo
  const s = getState().settings;
  const split = s.macroSplit;
  const macroGrams = calcMacroGrams(newKcal, split);
  const previewValues = scope.querySelector<HTMLElement>('.macro-preview .preview-values');
  if (previewValues) {
    previewValues.innerHTML = `P <strong>${macroGrams.protein}g</strong> · C <strong>${macroGrams.carbs}g</strong> · G <strong>${macroGrams.fat}g</strong>`;
  }
  const previewCheck = scope.querySelector<HTMLElement>('.macro-preview .preview-check');
  if (previewCheck) {
    const kcalCheck = macroGrams.protein * 4 + macroGrams.carbs * 4 + macroGrams.fat * 9;
    previewCheck.textContent = `Verifica kcal da macro: ${Math.round(kcalCheck)} kcal`;
  }

  // Aggiorna anche la goal-preview (se presente) con i nuovi valori
  const goalPreview = scope.querySelector<HTMLElement>('.goal-preview');
  if (goalPreview) {
    if (goalType === 'maintain') {
      goalPreview.innerHTML = `
        <p class="preview-label">Anteprima obiettivo</p>
        <p class="preview-values">TDEE: <strong>${tdee} kcal/giorno</strong> (mantenimento)</p>
      `;
    } else {
      const sign = weeklyDeltaKg > 0 ? '+' : '';
      const adjSign = dailyAdjustment > 0 ? '+' : '';
      const direction = weeklyDeltaKg < 0 ? 'deficit' : 'surplus';
      goalPreview.innerHTML = `
        <p class="preview-label">Anteprima obiettivo</p>
        <p class="preview-values">TDEE base: <strong>${tdee} kcal</strong> · Obiettivo: <strong>${newKcal} kcal/giorno</strong></p>
        <p class="preview-check">Variazione: <strong>${sign}${weeklyDeltaKg} kg/settimana</strong> (${sign}${(weeklyDeltaKg * 4).toFixed(1)} kg/mese) · ${direction} ${adjSign}${dailyAdjustment} kcal/giorno</p>
      `;
    }
  }
}

export function renderSettings(main: HTMLElement): void {
  const s = getState().settings;
  const split = _pendingMacroSplit ?? s.macroSplit;

  // Signature cache: skip se niente è cambiato.
  // Importante: NON includere cal qui — altrimenti ogni keystroke nel calorie input
  // distrugge il focus. cal viene gestito via input handler con update mirato del DOM.
  // split È incluso: i preset e "Salva split" devono triggerare il re-render.
  // Il drag dei macro slider usa update mirato (updateMacroDisplayLive) invece di emit,
  // quindi non triggera re-render e non interrompe il drag.
  const renderSig = JSON.stringify({
    split,
    theme: s.theme,
    sex: s.sex ?? '',
    activity: s.activityLevel ?? '',
    weight: s.weightKg ?? '',
    height: s.heightCm ?? '',
    age: s.ageYears ?? '',
    weightGoalType: s.weightGoalType ?? 'maintain',
    targetWeightKg: s.targetWeightKg ?? '',
    goalWeeks: s.goalWeeks ?? '',
  });
  if (renderSig === getSettingsRenderSig()) return;
  setSettingsRenderSig(renderSig);

  const macroGrams = calcMacroGrams(s.calorieGoal, split);
  const splitSum = split.proteinPct + split.carbsPct + split.fatPct;
  const kcalCheck = kcalFromMacros(macroGrams);

  // Preview dell'obiettivo calorico con adjustment per peso (lose/gain).
  // Ricalcolato qui per mostrare un riepilogo coerente con i dati attuali.
  const goalType: WeightGoalType = s.weightGoalType ?? 'maintain';
  const tdeePreview = (() => {
    const w = s.weightKg;
    const h = s.heightCm;
    const a = s.ageYears;
    if (w == null || h == null || a == null) return 0;
    if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(a)) return 0;
    if (w <= 0 || h <= 0 || a <= 0) return 0;
    if (!s.sex) return 0;
    if (!s.activityLevel) return 0;
    return calcTDEE(calcBMR(w, h, a, s.sex), s.activityLevel);
  })();
  const goalPreview = calcGoalAdjustedCalories(
    tdeePreview,
    s.weightKg,
    s.targetWeightKg,
    s.goalWeeks,
    goalType,
  );

  main.innerHTML = `
    <div class="settings-view">
      <div class="view-head">
        <h1 class="view-title">Impostazioni</h1>
        <p class="view-subtitle">Calibra obiettivo calorie e macro</p>
      </div>

      <section class="card setting-card">
        <h2 class="setting-title">Obiettivo calorie giornaliere</h2>
        <div class="calorie-input">
          <input id="calorie-input" type="number" min="500" max="10000" value="${s.calorieGoal}" inputmode="numeric" />
          <span class="calorie-unit">kcal/giorno</span>
        </div>
        <input id="calorie-slider" type="range" min="500" max="10000" step="50" value="${clamp(s.calorieGoal, 500, 10000)}" />
        <div class="slider-range"><span>500</span><span>10000</span></div>
      </section>

      <section class="card setting-card">
        <div class="setting-head">
          <h2 class="setting-title">Split macro personalizzato</h2>
          <span class="badge ${Math.abs(splitSum - 100) < 1 ? 'badge-secondary' : 'badge-danger'}">Somma: ${splitSum}%</span>
        </div>
        <p class="setting-label">Preset rapidi</p>
        <div class="preset-row">
          ${MACRO_PRESETS.map((p) => `<button type="button" class="btn btn-outline btn-sm" data-action="applyPreset" data-preset-id="${escapeAttr(p.id)}">${escapeHtml(p.name)}</button>`).join('')}
        </div>
        <div class="separator"></div>
        <div class="macro-sliders">
          ${macroSlider('Proteine',    split.proteinPct, macroGrams.protein, 'var(--color-protein)', 'proteinPct')}
          ${macroSlider('Carboidrati', split.carbsPct,   macroGrams.carbs,   'var(--color-carbs)',   'carbsPct')}
          ${macroSlider('Grassi',      split.fatPct,     macroGrams.fat,     'var(--color-fat)',     'fatPct')}
        </div>
        ${Math.abs(splitSum - 100) > 0.5 ? `<p class="warning-text">Lo split non somma a 100%. Verrà normalizzato automaticamente al salvataggio.</p>` : ''}
        <div class="macro-preview">
          <p class="preview-label">Anteprima grammi target</p>
          <p class="preview-values">P <strong>${macroGrams.protein}g</strong> · C <strong>${macroGrams.carbs}g</strong> · G <strong>${macroGrams.fat}g</strong></p>
          <p class="preview-check">Verifica kcal da macro: ${kcalCheck} kcal</p>
        </div>
        <button type="button" class="btn btn-primary btn-block" data-action="applySplit">Salva split macro</button>
      </section>

      <section class="card setting-card">
        <h2 class="setting-title">Calcolatore TDEE (Mifflin-St Jeor)</h2>
        <p class="setting-subtitle">Calcola automaticamente il fabbisogno calorico in base ai tuoi dati</p>
        <div class="tdee-grid">
          <label class="field"><span>Peso (kg)</span><input id="tdee-weight" type="number" inputmode="decimal" value="${s.weightKg ?? ''}" placeholder="70" /></label>
          <label class="field"><span>Altezza (cm)</span><input id="tdee-height" type="number" inputmode="decimal" value="${s.heightCm ?? ''}" placeholder="175" /></label>
          <label class="field"><span>Età</span><input id="tdee-age" type="number" inputmode="decimal" value="${s.ageYears ?? ''}" placeholder="30" /></label>
          <label class="field"><span>Sesso</span>
            <select id="tdee-sex">
              <option value="M" ${s.sex === 'M' ? 'selected' : ''}>Uomo</option>
              <option value="F" ${s.sex === 'F' ? 'selected' : ''}>Donna</option>
            </select>
          </label>
          <label class="field field-full"><span>Livello attività</span>
            <select id="tdee-activity">
              ${(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => `<option value="${k}" ${s.activityLevel === k ? 'selected' : ''}>${escapeHtml(ACTIVITY_LABELS[k])}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="separator"></div>
        <div class="goal-section">
          <p class="setting-label">Obiettivo di peso</p>
          <div class="goal-type-row" role="tablist" aria-label="Obiettivo di peso">
            ${(Object.keys(WEIGHT_GOAL_LABELS) as WeightGoalType[]).map((g) => `
              <button type="button"
                class="btn ${goalType === g ? 'btn-primary' : 'btn-outline'} btn-sm goal-type-btn"
                data-action="setGoalType" data-goal-type="${g}"
                role="tab" aria-selected="${goalType === g}">${escapeHtml(WEIGHT_GOAL_LABELS[g])}</button>
            `).join('')}
          </div>

          ${goalType !== 'maintain' ? `
            <div class="tdee-grid goal-inputs">
              <label class="field"><span>Peso target (kg)</span><input id="tdee-target-weight" type="number" inputmode="decimal" min="30" max="500" step="0.1" value="${s.targetWeightKg ?? ''}" placeholder="es. 65" /></label>
              <label class="field"><span>Settimane</span><input id="tdee-weeks" type="number" inputmode="numeric" min="1" max="156" step="1" value="${s.goalWeeks ?? ''}" placeholder="es. 12" /></label>
            </div>
            <p class="hint-text">Rateo massimo sicuro: ${MAX_WEEKLY_KG_RATE} kg/settimana (linea guida WHO/ACSM). Se la variazione richiesta supera questo limite, verrà clampata automaticamente.</p>
          ` : ''}
        </div>

        ${goalType !== 'maintain' && tdeePreview > 0 ? `
          <div class="goal-preview">
            <p class="preview-label">Anteprima obiettivo</p>
            ${(() => {
              const delta = goalPreview.weeklyDeltaKg;
              const adj = goalPreview.dailyAdjustment;
              const sign = delta > 0 ? '+' : '';
              const adjSign = adj > 0 ? '+' : '';
              const direction = delta < 0 ? 'deficit' : delta > 0 ? 'surplus' : '';
              return `
                <p class="preview-values">TDEE base: <strong>${tdeePreview} kcal</strong> · Obiettivo: <strong>${goalPreview.kcal} kcal/giorno</strong></p>
                <p class="preview-check">Variazione: <strong>${sign}${delta} kg/settimana</strong> (${sign}${(delta * 4).toFixed(1)} kg/mese) · ${direction} ${adjSign}${adj} kcal/giorno</p>
                ${goalPreview.clamped ? `<p class="warning-text">⚠ Rateo clampato a ${MAX_WEEKLY_KG_RATE} kg/settimana per sicurezza. Aumenta le settimane per un ritmo più sostenibile.</p>` : ''}
                ${Math.abs(delta) < MAX_WEEKLY_KG_RATE - 0.001 && delta !== 0 ? `<p class="hint-text">Hai margine: potresti raggiungere il target in ${Math.ceil(Math.abs((s.targetWeightKg ?? 0) - (s.weightKg ?? 0)) / MAX_WEEKLY_KG_RATE)} settimane al ritmo massimo.</p>` : ''}
              `;
            })()}
          </div>
        ` : goalType === 'maintain' && tdeePreview > 0 ? `
          <div class="goal-preview">
            <p class="preview-label">Anteprima obiettivo</p>
            <p class="preview-values">TDEE: <strong>${tdeePreview} kcal/giorno</strong> (mantenimento)</p>
          </div>
        ` : ''}

        <button type="button" class="btn btn-primary btn-block" data-action="calcTdee">Calcola e imposta come obiettivo</button>
      </section>

      <section class="card setting-card">
        <h2 class="setting-title">Tema</h2>
        <p class="setting-subtitle">Scegli l'aspetto dell'app</p>
        <div class="theme-row">
          ${(['system', 'light', 'dark'] as Theme[]).map((t) => `
            <button type="button" class="btn ${s.theme === t ? 'btn-primary' : 'btn-outline'}" data-action="setTheme" data-theme="${t}">${t === 'system' ? 'Sistema' : t === 'light' ? 'Chiaro' : 'Scuro'}</button>
          `).join('')}
        </div>
      </section>

      <section class="card setting-card">
        <h2 class="setting-title">Dati e backup</h2>
        <p class="setting-subtitle">Tutti i dati sono salvati localmente sul tuo dispositivo (localStorage). Fai regolarmente un backup per non perderli.</p>
        <div class="backup-grid">
          <button type="button" class="btn btn-outline" data-action="exportData"><span aria-hidden="true">⬇</span> Esporta</button>
          <label class="btn btn-outline" for="import-file"><span aria-hidden="true">⬆</span> Importa</label>
          <input id="import-file" type="file" accept="application/json" hidden />
        </div>
        <div class="separator"></div>
        <button type="button" class="btn btn-outline btn-block danger" data-action="resetData"><span aria-hidden="true">🗑</span> Reset tutti i dati</button>
      </section>

      <section class="card setting-card about">
        <h2 class="setting-title">Informazioni</h2>
        <p><strong>NutriTrack</strong> — clone open di Lifesum come PWA.</p>
        <p>Dati nutrizionali forniti da <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> (database collaborativo gratuito).</p>
        <p>Tutti i dati restano sul tuo dispositivo. Installabile come app dal browser (Aggiungi a Home Screen).</p>
      </section>
    </div>
  `;

  bindSettingsEvents(main);
}

function macroSlider(label: string, pct: number, grams: number, color: string, key: 'proteinPct' | 'carbsPct' | 'fatPct'): string {
  return `
    <div class="macro-slider-row">
      <div class="macro-slider-head">
        <span class="macro-slider-label"><span class="dot" style="background:${color}"></span>${escapeHtml(label)}</span>
        <span class="macro-slider-values"><strong>${pct}%</strong> · ${grams}g</span>
      </div>
      <input type="range" min="0" max="100" step="1" value="${pct}" data-action="slideMacro" data-macro-key="${key}" />
    </div>
  `;
}

function bindSettingsEvents(main: HTMLElement): void {
  if (_settingsBound) return;
  _settingsBound = true;

  main.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    if (action === 'applyPreset') {
      const id = target.dataset.presetId;
      const preset = MACRO_PRESETS.find((p) => p.id === id);
      if (preset) {
        // Fix B6.3 (T6): applica il preset solo a _pendingMacroSplit, NON persistere immediatamente
        // (prima: setMacroSplit persisteva in localStorage senza undo)
        _pendingMacroSplit = { ...preset.split };
        showToast(`Preset "${preset.name}" applicato. Clicca "Salva split macro" per confermare.`, 'info', 3500);
        emitChange();
      }
      return;
    }
    if (action === 'applySplit') {
      if (!_pendingMacroSplit) {
        showToast('Nessuna modifica da salvare', 'info');
        return;
      }
      const normalized = normalizeMacroSplit(_pendingMacroSplit);
      _pendingMacroSplit = normalized;
      setMacroSplit(normalized);
      showToast('Split macro aggiornato', 'success');
      return;
    }
    if (action === 'calcTdee') {
      const w = Number((main.querySelector('#tdee-weight') as HTMLInputElement).value);
      const h = Number((main.querySelector('#tdee-height') as HTMLInputElement).value);
      const a = Number((main.querySelector('#tdee-age') as HTMLInputElement).value);
      const sex = (main.querySelector('#tdee-sex') as HTMLSelectElement).value as Sex;
      const activity = (main.querySelector('#tdee-activity') as HTMLSelectElement).value as ActivityLevel;
      // Fix B13: validazione strict — niente NaN, niente negativi, niente Infinity
      if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(a) || w <= 0 || h <= 0 || a <= 0) {
        showToast('Inserisci peso, altezza ed età validi (positivi)', 'error');
        return;
      }
      // Range sanity check (Fix B6.2: usa >= invece di > per coerenza)
      if (w >= 500 || h >= 300 || a >= 150) {
        showToast('Valori fuori range realistico', 'error');
        return;
      }
      const bmr = calcBMR(w, h, a, sex);
      const tdee = calcTDEE(bmr, activity);
      if (!Number.isFinite(tdee) || tdee <= 0) {
        showToast('Calcolo TDEE fallito', 'error');
        return;
      }

      // Leggi obiettivo peso dai campi UI (se presenti) o dallo state.
      const currentGoalType = (getState().settings.weightGoalType ?? 'maintain') as WeightGoalType;
      let targetWeight: number | undefined;
      let goalWeeks: number | undefined;
      if (currentGoalType !== 'maintain') {
        const twEl = main.querySelector<HTMLInputElement>('#tdee-target-weight');
        const gwEl = main.querySelector<HTMLInputElement>('#tdee-weeks');
        const tw = twEl ? Number(twEl.value) : NaN;
        const gw = gwEl ? Number(gwEl.value) : NaN;
        if (!Number.isFinite(tw) || tw <= 0) {
          showToast('Inserisci un peso target valido (>0)', 'error');
          return;
        }
        if (!Number.isFinite(gw) || gw <= 0 || !Number.isInteger(gw)) {
          showToast('Inserisci un numero di settimane valido (intero >0)', 'error');
          return;
        }
        if (tw < 30 || tw > 500) {
          showToast('Peso target fuori range realistico (30-500 kg)', 'error');
          return;
        }
        if (gw > 156) {
          showToast('Le settimane devono essere <= 156 (3 anni)', 'error');
          return;
        }
        // Coerenza direzione: se l'utente dice "perdere" ma target >= current, avvisa.
        if (currentGoalType === 'lose' && tw >= w) {
          showToast('Per "perdere peso" il target deve essere inferiore al peso attuale', 'error');
          return;
        }
        if (currentGoalType === 'gain' && tw <= w) {
          showToast('Per "aumentare peso" il target deve essere superiore al peso attuale', 'error');
          return;
        }
        targetWeight = tw;
        goalWeeks = gw;
      }

      // Calcola obiettivo calorico aggiustato per l'obiettivo di peso.
      const goal = calcGoalAdjustedCalories(tdee, w, targetWeight, goalWeeks, currentGoalType);
      if (goal.kcal <= 0) {
        showToast('Calcolo obiettivo fallito', 'error');
        return;
      }

      // Persisti tutto: nuovo obiettivo calorico + dati fisici + dati obiettivo.
      setCalorieGoal(goal.kcal);
      updateSettings({
        weightKg: w,
        heightCm: h,
        ageYears: a,
        sex,
        activityLevel: activity,
        weightGoalType: currentGoalType,
        targetWeightKg: currentGoalType === 'maintain' ? undefined : targetWeight,
        goalWeeks: currentGoalType === 'maintain' ? undefined : goalWeeks,
      });

      // Fix auto-refresh: il renderSig NON include calorieGoal (per non rompere il focus
      // sul calorie-input durante la digitazione), quindi emitChange da solo non aggiorna
      // visivamente l'input calorie / slider / macro preview. Facciamo un update mirato del DOM.
      updateCalorieGoalLive(goal.kcal, currentGoalType, goal.weeklyDeltaKg, goal.dailyAdjustment, tdee);

      // Messaggio contestuale
      if (currentGoalType === 'maintain') {
        showToast(`Obiettivo calorie aggiornato a ${goal.kcal} kcal/giorno (mantenimento)`, 'success');
      } else {
        const sign = goal.dailyAdjustment > 0 ? '+' : '';
        const verb = currentGoalType === 'lose' ? 'deficit' : 'surplus';
        const deltaSign = goal.weeklyDeltaKg > 0 ? '+' : '';
        let msg = `Obiettivo: ${goal.kcal} kcal/giorno · ${verb} ${sign}${goal.dailyAdjustment} kcal · ${deltaSign}${goal.weeklyDeltaKg} kg/settimana`;
        if (goal.clamped) {
          msg += ` (rateo clampato a ${MAX_WEEKLY_KG_RATE} kg/sett.)`;
        }
        showToast(msg, 'success', 4500);
      }
      return;
    }
    if (action === 'setGoalType') {
      const g = target.dataset.goalType as WeightGoalType;
      // Persisti subito il tipo di obiettivo; se 'maintain', pulisci targetWeight/goalWeeks.
      updateSettings({
        weightGoalType: g,
        targetWeightKg: g === 'maintain' ? undefined : getState().settings.targetWeightKg,
        goalWeeks: g === 'maintain' ? undefined : getState().settings.goalWeeks,
      });
      // emitChange triggera re-render (il renderSig include i nuovi campi).
      return;
    }
    if (action === 'setTheme') {
      const t = target.dataset.theme as Theme;
      applyTheme(t);
      updateSettings({ theme: t });
      return;
    }
    if (action === 'exportData') {
      handleExport();
      return;
    }
    if (action === 'resetData') {
      openResetConfirm();
      return;
    }
  });

  main.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'calorie-input') {
      const raw = (target as HTMLInputElement).value;
      const parsed = Number(raw);
      // Se l'utente sta digitando (input event), accetta stringhe vuote o numeri
      // parziali; clamp solo se è un numero finito valido. Rifiuta silenziosamente
      // NaN (non aggiornare il goal) — la validazione finale avviene su change.
      if (raw.trim() === '' || !Number.isFinite(parsed)) {
        updateMacroDisplayLive();
        return;
      }
      const v = Math.max(500, Math.min(10000, parsed));
      setCalorieGoal(v);
      // Update mirato: aggiorna il calorie slider e i grammi macro senza re-render
      // Fix B6.7 (T6): slider range allineato a 500-10000 (prima era 1000-4000)
      const slider = main.querySelector<HTMLInputElement>('#calorie-slider');
      if (slider) slider.value = String(clamp(v, 500, 10000));
      updateMacroDisplayLive();
      return;
    }
    if (target.id === 'calorie-slider') {
      const v = Number((target as HTMLInputElement).value);
      setCalorieGoal(v);
      // Update mirato: aggiorna il calorie input e i grammi macro senza re-render
      const input = main.querySelector<HTMLInputElement>('#calorie-input');
      if (input) input.value = String(v);
      updateMacroDisplayLive();
      return;
    }
    if (target.dataset.action === 'slideMacro') {
      const key = target.dataset.macroKey as 'proteinPct' | 'carbsPct' | 'fatPct';
      const v = Number((target as HTMLInputElement).value);
      const base = _pendingMacroSplit ?? { ...getState().settings.macroSplit };
      _pendingMacroSplit = { ...base, [key]: v };
      // Update mirato: aggiorna % e grammi senza re-render (preserva il drag)
      updateMacroDisplayLive();
      return;
    }
  });

  // Fix B6.16 (T6): validazione TDEE inputs al blur (change event) per feedback immediato
  main.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'calorie-input') {
      const input = t as HTMLInputElement;
      const raw = input.value.trim();
      if (raw === '') {
        showToast('Inserisci un valore per le calorie', 'error');
        input.value = String(getState().settings.calorieGoal);
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        showToast(`Calorie: valore non valido ("${raw}")`, 'error');
        input.value = String(getState().settings.calorieGoal);
        return;
      }
      if (parsed < 500 || parsed > 10000) {
        showToast('Le calorie devono essere tra 500 e 10000', 'error');
        input.value = String(getState().settings.calorieGoal);
        return;
      }
      return;
    }
    // Fix B6.16: validazione TDEE inputs al blur
    if (t.id === 'tdee-weight' || t.id === 'tdee-height' || t.id === 'tdee-age') {
      const input = t as HTMLInputElement;
      const raw = input.value.trim();
      if (raw === '') return; // permesso (campo opzionale fino al calc)
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showToast(`Valore non valido per ${t.id === 'tdee-weight' ? 'peso' : t.id === 'tdee-height' ? 'altezza' : 'età'}`, 'error');
      }
      return;
    }
    if (t.id === 'import-file') {
      const input = t as HTMLInputElement;
      const file = input.files?.[0];
      if (file) handleImport(file);
      input.value = '';
      return;
    }
  });
}
