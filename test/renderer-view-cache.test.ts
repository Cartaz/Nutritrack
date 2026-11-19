import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../src/components/renderer';
import { addDiaryEntry, emitChange, emitViewChange, getState, setState, subscribe } from '../src/lib/store';

const DATE = '2026-08-31';
const frames = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

subscribe(render);
// jsdom non implementa matchMedia (usato dal tema "system").
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
);

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  setState({ foods: [], diary: {}, recipes: [], favoriteFoodIds: [], biometrics: {}, dialog: null });
  setState({ currentView: 'dashboard', currentDate: DATE, settings: { ...getState().settings } });
});

async function renderedDashboard(): Promise<Element> {
  await vi.waitFor(() => expect(document.querySelector('.dashboard')).not.toBeNull());
  return document.querySelector('.dashboard')!;
}

describe('renderer view cache', () => {
  it('does not rebuild the view for an emit that changes nothing the view shows', async () => {
    render();
    const before = await renderedDashboard();
    emitChange(); // es. un tasto nella ricerca: cambia solo lo stato di un dialog
    await frames();
    expect(document.querySelector('.dashboard')).toBe(before);
  });

  it('rebuilds when view-local state or data change', async () => {
    render();
    const first = await renderedDashboard();
    emitViewChange();
    await frames();
    const second = document.querySelector('.dashboard');
    expect(second).not.toBe(first);

    addDiaryEntry({
      date: DATE,
      meal: 'lunch',
      foodSnapshot: {
        id: 'f',
        name: 'Pasta',
        source: 'custom',
        servingSize: 100,
        nutrition: { calories: 350, protein: 12, carbs: 70, fat: 2 },
        createdAt: 1,
      },
      quantity: 1,
    });
    await frames();
    expect(document.querySelector('.dashboard')).not.toBe(second);
    expect(document.querySelector('.meal-entries')?.textContent).toContain('Pasta');
  });
});
