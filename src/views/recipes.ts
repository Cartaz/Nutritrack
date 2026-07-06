// Vista Recipes: elenco ricette custom con search, view, edit, delete, add-to-diary.

import { getState, openRecipeEditor, openRecipeViewer, openRecipeMealPicker, emitChange } from '../lib/store';
import { requestDeleteRecipe } from '../lib/recipes';
import { escapeHtml, escapeAttr, debounce, round } from '../lib/utils';
import { scaleNutrition, sumNutrition } from '../lib/nutrition';
import type { Recipe } from '../types';

let _recipesBound = false;
let _query = '';
// Signature cache: previene re-render inutili
let _recipesRenderSig = '';

/** Reset signature cache (chiamato dal renderer al cambio vista) */
export function resetRecipesSignature(): void {
  _recipesRenderSig = '';
}

const _filterRecipes = debounce(() => { _recipesRenderSig = ''; emitChange(); }, 80);

export function renderRecipes(main: HTMLElement): void {
  const state = getState();
  const q = _query.trim().toLowerCase();

  // Signature cache
  const renderSig = JSON.stringify({
    q: _query,
    recipes: state.recipes.map((r) => `${r.id}:${r.name}:${r.description ?? ''}:${r.servings}:${r.ingredients.length}`).join('|'),
  });
  if (renderSig === _recipesRenderSig) return;
  _recipesRenderSig = renderSig;

  const filtered = state.recipes.filter((r) => {
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
  });

  const listHtml = state.recipes.length === 0
    ? `
      <section class="card empty-state">
        <div class="empty-icon" aria-hidden="true">👨‍🍳</div>
        <h3>Nessuna ricetta</h3>
        <p>Crea la tua prima ricetta personalizzata combinando ingredienti da Open Food Facts o dai tuoi alimenti salvati. I valori nutrizionali vengono calcolati automaticamente per porzione.</p>
        <button type="button" class="btn btn-primary" data-action="newRecipe"><span aria-hidden="true">＋</span> Crea ricetta</button>
      </section>
    `
    : filtered.length === 0
      ? `<section class="card empty-state muted">Nessuna ricetta trovata per "${escapeHtml(_query)}"</section>`
      : `<div class="recipes-grid">${filtered.map((r) => recipeCard(r)).join('')}</div>`;

  main.innerHTML = `
    <div class="recipes-view">
      <div class="view-head">
        <div>
          <h1 class="view-title">Ricette</h1>
          <p class="view-subtitle">${state.recipes.length} ricette custom</p>
        </div>
        <button type="button" class="btn btn-primary" data-action="newRecipe"><span aria-hidden="true">＋</span> Nuova</button>
      </div>
      <div class="search-input-wrap">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input id="recipes-search" type="search" placeholder="Cerca tra le ricette…" value="${escapeAttr(_query)}" autocomplete="off" />
      </div>
      ${listHtml}
    </div>
  `;

  bindRecipesEvents(main);
}

function recipeCard(r: Recipe): string {
  const per = calcPerServing(r);
  return `
    <article class="card recipe-card">
      <button type="button" class="recipe-card-body" data-action="viewRecipe" data-recipe-id="${escapeAttr(r.id)}">
        <h3 class="recipe-card-name">${escapeHtml(r.name)}</h3>
        <div class="recipe-card-meta">
          <span>👥 ${r.servings} porz.</span>
          <span>·</span>
          <span>${r.ingredients.length} ingredienti</span>
        </div>
        ${r.description ? `<p class="recipe-card-desc">${escapeHtml(r.description)}</p>` : ''}
        <div class="recipe-card-stats">
          ${statBox('kcal', String(Math.round(per.calories)))}
          ${statBox('P', `${per.protein}g`)}
          ${statBox('C', `${per.carbs}g`)}
          ${statBox('G', `${per.fat}g`)}
        </div>
      </button>
      <div class="recipe-card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="addRecipeToMeal" data-recipe-id="${escapeAttr(r.id)}"><span aria-hidden="true">＋</span> Aggiungi al diario</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="editRecipe" data-recipe-id="${escapeAttr(r.id)}">✏️ Modifica</button>
        <button type="button" class="icon-btn danger" data-action="deleteRecipe" data-recipe-id="${escapeAttr(r.id)}" aria-label="Elimina">🗑</button>
      </div>
    </article>
  `;
}

function statBox(label: string, value: string): string {
  return `<div class="stat-box"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p></div>`;
}

function calcPerServing(r: Recipe): { calories: number; protein: number; carbs: number; fat: number } {
  const nutritions = r.ingredients.map((ing) => scaleNutrition(ing.foodSnapshot.nutrition, ing.grams));
  const t = sumNutrition(nutritions);
  return {
    calories: r.servings > 0 ? round(t.calories / r.servings, 1) : 0,
    protein:  r.servings > 0 ? round(t.protein  / r.servings, 1) : 0,
    carbs:    r.servings > 0 ? round(t.carbs    / r.servings, 1) : 0,
    fat:      r.servings > 0 ? round(t.fat      / r.servings, 1) : 0,
  };
}

function bindRecipesEvents(main: HTMLElement): void {
  if (_recipesBound) return;
  _recipesBound = true;

  main.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'newRecipe') {
      openRecipeEditor('new');
      return;
    }
    if (action === 'viewRecipe') {
      const id = target.dataset.recipeId || '';
      if (id) openRecipeViewer(id);
      return;
    }
    if (action === 'editRecipe') {
      const id = target.dataset.recipeId || '';
      if (id) openRecipeEditor(id);
      return;
    }
    if (action === 'deleteRecipe') {
      const id = target.dataset.recipeId || '';
      if (id) requestDeleteRecipe(id);
      return;
    }
    if (action === 'addRecipeToMeal') {
      const id = target.dataset.recipeId || '';
      if (id) openRecipeMealPicker(id);
      return;
    }
  });

  main.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).id === 'recipes-search') {
      _query = (e.target as HTMLInputElement).value;
      _filterRecipes();
    }
  });
}
