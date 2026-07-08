// Header: logo + titolo + nav tabs (mobile bottom nav).
// Render via innerHTML strutturato. Click delegati via data-action in renderer.ts.

import { escapeHtml } from '../lib/utils';
import type { ViewName } from '../types';

interface NavItem {
  id: ViewName;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Oggi', icon: '🏠' },
  { id: 'foods', label: 'Alimenti', icon: '🥕' },
  { id: 'recipes', label: 'Ricette', icon: '👨‍🍳' },
  { id: 'settings', label: 'Impost.', icon: '⚙️' },
];

export function renderHeader(_currentView: ViewName): string {
  return `
    <header class="app-header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-icon" aria-hidden="true">🍎</span>
          <span class="brand-name">NutriTrack</span>
        </div>
      </div>
    </header>
  `;
}

export function renderBottomNav(currentView: ViewName): string {
  const items = NAV_ITEMS.map((it) => {
    const active = it.id === currentView ? ' active' : '';
    const ariaCurrent = it.id === currentView ? ' aria-current="page"' : '';
    return `
      <button
        type="button"
        class="nav-item${active}"
        data-action="switchView"
        data-view="${escapeHtml(it.id)}"
        aria-label="${escapeHtml(it.label)}"
        ${ariaCurrent}
      >
        <span class="nav-icon" aria-hidden="true">${it.icon}</span>
        <span class="nav-label">${escapeHtml(it.label)}</span>
      </button>
    `;
  }).join('');
  return `<nav class="bottom-nav" role="navigation" aria-label="Navigazione principale">${items}</nav>`;
}
