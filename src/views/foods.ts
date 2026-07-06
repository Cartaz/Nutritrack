// Vista Foods: elenco alimenti salvati con search, preferiti, edit, delete.

import { getState, openFoodEditor, toggleFoodFavorite, emitChange } from '../lib/store';
import { requestDeleteFood } from '../lib/foods';
import { escapeHtml, escapeAttr, debounce } from '../lib/utils';
import { imgTag } from '../components/img';
import type { FoodItem } from '../types';

let _foodsBound = false;
let _query = '';
// Signature cache: previene re-render inutili di main.innerHTML
let _foodsRenderSig = '';

/** Reset signature cache (chiamato dal renderer al cambio vista) */
export function resetFoodsSignature(): void {
  _foodsRenderSig = '';
}

const _filterFoods = debounce(() => { _foodsRenderSig = ''; emitChange(); }, 80);

export function renderFoods(main: HTMLElement): void {
  const state = getState();
  const q = _query.trim().toLowerCase();
  const filtered = state.foods.filter((f) => {
    if (!q) return true;
    return f.name.toLowerCase().includes(q) || (f.brand || '').toLowerCase().includes(q);
  });

  // Signature cache: skip se niente è cambiato
  const renderSig = JSON.stringify({
    q: _query,
    foods: state.foods.map((f) => `${f.id}:${f.name}:${f.brand ?? ''}:${f.nutrition.calories}`).join('|'),
    favs: state.favoriteFoodIds.slice().sort().join(','),
  });
  if (renderSig === _foodsRenderSig) return;
  _foodsRenderSig = renderSig;

  const sorted = [...filtered].sort((a, b) => {
    const aFav = state.favoriteFoodIds.includes(a.id) ? 0 : 1;
    const bFav = state.favoriteFoodIds.includes(b.id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return b.createdAt - a.createdAt;
  });

  const listHtml = state.foods.length === 0
    ? `
      <section class="card empty-state">
        <div class="empty-icon" aria-hidden="true">🍴</div>
        <h3>Nessun alimento salvato</h3>
        <p>Crea il tuo primo alimento custom oppure cerca su Open Food Facts dalla dashboard. Gli alimenti che aggiungi al diario vengono salvati automaticamente qui.</p>
        <button type="button" class="btn btn-primary" data-action="newFood"><span aria-hidden="true">＋</span> Crea alimento custom</button>
      </section>
    `
    : sorted.length === 0
      ? `<section class="card empty-state muted">Nessun alimento trovato per "${escapeHtml(_query)}"</section>`
      : `<div class="foods-list">${sorted.map((f) => foodCard(f, state.favoriteFoodIds.includes(f.id))).join('')}</div>`;

  main.innerHTML = `
    <div class="foods-view">
      <div class="view-head">
        <div>
          <h1 class="view-title">Alimenti</h1>
          <p class="view-subtitle">${state.foods.length} salvati · ${state.favoriteFoodIds.length} preferiti</p>
        </div>
        <button type="button" class="btn btn-primary" data-action="newFood"><span aria-hidden="true">＋</span> Nuovo</button>
      </div>
      <div class="search-input-wrap">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input id="foods-search" type="search" placeholder="Cerca tra i tuoi alimenti…" value="${escapeAttr(_query)}" autocomplete="off" />
      </div>
      ${listHtml}
    </div>
  `;

  bindFoodsEvents(main);
}

function foodCard(f: FoodItem, isFav: boolean): string {
  return `
    <article class="card food-card">
      <div class="food-card-body">
        ${imgTag(f.image, f.name, 'thumb', f.source === 'custom' ? '✏️' : '🥫')}
        <div class="food-card-info">
          <p class="food-card-name">${escapeHtml(f.name)}</p>
          ${f.brand ? `<p class="food-card-brand">${escapeHtml(f.brand)}</p>` : ''}
          <div class="badge-row">
            <span class="badge badge-secondary">${f.nutrition.calories} kcal/100g</span>
            <span class="badge">P ${f.nutrition.protein}g</span>
            <span class="badge">C ${f.nutrition.carbs}g</span>
            <span class="badge">G ${f.nutrition.fat}g</span>
            <span class="badge">Porz: ${f.servingSize}g</span>
          </div>
        </div>
        <div class="food-card-actions">
          <button type="button" class="icon-btn fav${isFav ? ' active' : ''}" data-action="toggleFav" data-food-id="${escapeAttr(f.id)}" aria-label="Preferito">${isFav ? '★' : '☆'}</button>
          <button type="button" class="icon-btn" data-action="editFood" data-food-id="${escapeAttr(f.id)}" aria-label="Modifica">✏️</button>
          <button type="button" class="icon-btn danger" data-action="deleteFood" data-food-id="${escapeAttr(f.id)}" aria-label="Elimina">🗑</button>
        </div>
      </div>
    </article>
  `;
}

function bindFoodsEvents(main: HTMLElement): void {
  if (_foodsBound) return;
  _foodsBound = true;

  main.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'newFood') {
      openFoodEditor('new');
      return;
    }
    if (action === 'editFood') {
      const id = target.dataset.foodId || '';
      if (id) openFoodEditor(id);
      return;
    }
    if (action === 'deleteFood') {
      const id = target.dataset.foodId || '';
      if (id) requestDeleteFood(id);
      return;
    }
    if (action === 'toggleFav') {
      const id = target.dataset.foodId || '';
      if (id) toggleFoodFavorite(id);
      return;
    }
  });

  main.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).id === 'foods-search') {
      _query = (e.target as HTMLInputElement).value;
      _filterFoods();
    }
  });
}
