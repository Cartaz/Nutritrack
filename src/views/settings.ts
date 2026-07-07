// Vista Settings: calorie goal, macro split, TDEE calculator, export/import, reset, about.

import { getState, setCalorieGoal, setMacroSplit, updateSettings, emitChange, openConfirmReset } from '../lib/store';
import { calcMacroGrams, calcBMR, calcTDEE, normalizeMacroSplit, kcalFromMacros } from '../lib/nutrition';
import { escapeHtml, escapeAttr, clamp, debounce } from '../lib/utils';
import { handleExport, handleImport } from '../components/exportImport';
import { showToast } from '../components/toast';
import { applyTheme } from '../components/renderer';
import { MACRO_PRESETS, ACTIVITY_LABELS } from '../types';
import type { MacroSplit, Theme, Sex, ActivityLevel } from '../types';

let _settingsBound = false;
let _localSplit: MacroSplit | null = null;
// Signature cache: previene re-render inutili mentre l'utente digita nei campi del form
let _settingsRenderSig = '';

/** Reset signature cache (chiamato dal renderer al cambio vista) */
export function resetSettingsSignature(): void {
  _settingsRenderSig = '';
}

const _emit = debounce(() => { _settingsRenderSig = ''; emitChange(); }, 80);

export function renderSettings(main: HTMLElement): void {
  const s = getState().settings;
  const split = _localSplit ?? s.macroSplit;

  // Signature cache: skip se niente è cambiato.
  // Importante: NON includere cal/split qui — altrimenti ogni keystroke/slide
  // distrugge il focus del calorie input e interrompe il drag dei macro slider.
  // Quei valori vengono gestiti via input handler con update mirato del DOM.
  const renderSig = JSON.stringify({
    theme: s.theme,
    sex: s.sex ?? '',
    activity: s.activityLevel ?? '',
    weight: s.weightKg ?? '',
    height: s.heightCm ?? '',
    age: s.ageYears ?? '',
  });
  if (renderSig === _settingsRenderSig) return;
  _settingsRenderSig = renderSig;

  const macroGrams = calcMacroGrams(s.calorieGoal, split);
  const splitSum = split.proteinPct + split.carbsPct + split.fatPct;
  const kcalCheck = kcalFromMacros(macroGrams);

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
        <input id="calorie-slider" type="range" min="1000" max="4000" step="50" value="${clamp(s.calorieGoal, 1000, 4000)}" />
        <div class="slider-range"><span>1000</span><span>4000</span></div>
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
        _localSplit = { ...preset.split };
        setMacroSplit(_localSplit);
        showToast(`Preset "${preset.name}" applicato`, 'success');
      }
      return;
    }
    if (action === 'applySplit') {
      if (!_localSplit) {
        showToast('Nessuna modifica da salvare', 'info');
        return;
      }
      const normalized = normalizeMacroSplit(_localSplit);
      _localSplit = normalized;
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
      // Range sanity check
      if (w > 500 || h > 300 || a > 150) {
        showToast('Valori fuori range realistico', 'error');
        return;
      }
      const bmr = calcBMR(w, h, a, sex);
      const tdee = calcTDEE(bmr, activity);
      if (!Number.isFinite(tdee) || tdee <= 0) {
        showToast('Calcolo TDEE fallito', 'error');
        return;
      }
      setCalorieGoal(tdee);
      updateSettings({ weightKg: w, heightCm: h, ageYears: a, sex, activityLevel: activity });
      showToast(`Obiettivo calorie aggiornato a ${tdee} kcal/giorno`, 'success');
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
      openConfirmReset();
      return;
    }
  });

  main.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'calorie-input') {
      const v = Math.max(500, Number((target as HTMLInputElement).value) || 0);
      setCalorieGoal(v);
      _emit();
      return;
    }
    if (target.id === 'calorie-slider') {
      const v = Number((target as HTMLInputElement).value);
      setCalorieGoal(v);
      _emit();
      return;
    }
    if (target.dataset.action === 'slideMacro') {
      const key = target.dataset.macroKey as 'proteinPct' | 'carbsPct' | 'fatPct';
      const v = Number((target as HTMLInputElement).value);
      const base = _localSplit ?? { ...getState().settings.macroSplit };
      _localSplit = { ...base, [key]: v };
      _emit();
      return;
    }
  });

  main.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).id === 'import-file') {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) handleImport(file);
      input.value = '';
      return;
    }
  });
}
