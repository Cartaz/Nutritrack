import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStorageInternalForTesting,
  flushPendingMultiTabUpdate,
  initMultiTabSync,
  saveData,
} from '../src/lib/storage';
import { STORAGE_KEY } from '../src/lib/constants';
import { getState, setState } from '../src/lib/store';

function resetStore(): void {
  setState({
    settings: {
      calorieGoal: 2000,
      macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
      theme: 'system',
    },
    foods: [],
    diary: {},
    recipes: [],
    favoriteFoodIds: [],
    biometrics: {},
    _searchOpen: false,
    _editingFoodId: null,
    _editingRecipeId: null,
    _viewingRecipeId: null,
    _confirmReset: false,
    _confirmDeleteFoodId: null,
    _confirmDeleteRecipeId: null,
    _addRecipeToMealPickerId: null,
    _editingEntryId: null,
  });
}

function storedPayload(): Record<string, unknown> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('expected persisted NutriTrack payload');
  return JSON.parse(raw) as Record<string, unknown>;
}

function remoteSnapshot(calorieGoal: number, revision: number, originTabId = 'remote-tab'): string {
  const current = storedPayload();
  const settings = current.settings as Record<string, unknown>;
  return JSON.stringify({
    ...current,
    revision,
    originTabId,
    settings: { ...settings, calorieGoal },
  });
}

function dispatchRemote(raw: string): void {
  const previous = localStorage.getItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, raw);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: STORAGE_KEY,
      oldValue: previous,
      newValue: raw,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetStorageInternalForTesting();
  resetStore();
  expect(saveData().ok).toBe(true);
  initMultiTabSync();
});

afterEach(() => {
  __resetStorageInternalForTesting();
  localStorage.clear();
});

describe('revisioned multi-tab synchronization', () => {
  it('applies a newer clean remote snapshot', () => {
    const baseRevision = Number(storedPayload().revision);
    const remote = remoteSnapshot(1800, baseRevision + 1);

    dispatchRemote(remote);

    expect(getState().settings.calorieGoal).toBe(1800);
  });

  it('does not let a pending remote snapshot overwrite a newer local edit', () => {
    const baseRevision = Number(storedPayload().revision);
    const remoteRevision = baseRevision + 1;

    setState({ _searchOpen: true });
    dispatchRemote(remoteSnapshot(1800, remoteRevision));
    expect(getState().settings.calorieGoal).toBe(2000);

    // The user saves locally while the modal is still open. The RAF autosave may not
    // have run yet; flush must still recognize this persisted state as dirty.
    setState({
      settings: { ...getState().settings, calorieGoal: 2200 },
      _searchOpen: false,
    });

    flushPendingMultiTabUpdate();

    expect(getState().settings.calorieGoal).toBe(2200);
    const persisted = storedPayload();
    expect((persisted.settings as Record<string, unknown>).calorieGoal).toBe(2200);
    expect(Number(persisted.revision)).toBeGreaterThan(remoteRevision);
  });

  it('applies a deferred remote snapshot when no local persisted state changed', () => {
    const baseRevision = Number(storedPayload().revision);

    setState({ _searchOpen: true });
    dispatchRemote(remoteSnapshot(1750, baseRevision + 1));
    expect(getState().settings.calorieGoal).toBe(2000);

    setState({ _searchOpen: false });
    flushPendingMultiTabUpdate();

    expect(getState().settings.calorieGoal).toBe(1750);
  });

  it('keeps only the newest pending remote snapshot', () => {
    const baseRevision = Number(storedPayload().revision);
    setState({ _searchOpen: true });

    dispatchRemote(remoteSnapshot(1900, baseRevision + 1, 'remote-a'));
    dispatchRemote(remoteSnapshot(1850, baseRevision + 2, 'remote-b'));

    setState({ _searchOpen: false });
    flushPendingMultiTabUpdate();

    expect(getState().settings.calorieGoal).toBe(1850);
  });
});
