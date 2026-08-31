import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, content) {
  fs.writeFileSync(path, content);
}
function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Start marker not found: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  if (end < 0) throw new Error(`End marker not found: ${endMarker}`);
  return source.slice(0, start) + replacement + (endMarker ? source.slice(end) : '');
}
function replaceTest(source, title, replacement) {
  const marker = `  it('${title}'`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Test not found: ${title}`);
  const nextIt = source.indexOf('\n  it(', start + marker.length);
  const describeEnd = source.indexOf('\n});', start + marker.length);
  const end = nextIt >= 0 && nextIt < describeEnd ? nextIt + 1 : describeEnd;
  if (end < 0) throw new Error(`Test end not found: ${title}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// ---- API: replace obsolete suffix-fanout tests with rate-limit/single-request contracts.
{
  const path = 'test/api.test.ts';
  let source = read(path);
  source = source.replace(
    "import { apiGetJson, ApiError, isTransientError, searchOffWithPartialMatch } from '../src/lib/api';",
    "import { apiGetJson, ApiError, isTransientError, searchOff, searchOffWithPartialMatch, __resetSearchLimiterForTesting } from '../src/lib/api';",
  );
  source = source.replace(
    "  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });\n});",
    "  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });\n  __resetSearchLimiterForTesting();\n});",
  );
  source = source.replace(
    '// Verifica la logica di suffix expansion per query parziali (issue #2):\n// - Query completa con risultati → nessun suffix expansion\n// - Query parziale con 0 risultati → prova suffissi \'e\',\'i\',\'a\',\'o\'\n// - Query già terminante con suffisso → nessun expansion\n// - Page > 1 → nessun expansion (usa già effectiveQuery)\n// - Errore transitorio su un suffisso → ignora e continua con gli altri\n',
    '// Verifica il contratto delle ricerche testuali OFF:\n// - una singola azione utente produce una sola richiesta HTTP\n// - nessuna suffix expansion/fan-out automatica\n// - 429 non viene aggirato cambiando host\n// - limiter locale mantiene margine sotto il limite documentato da OFF\n',
  );
  const replacement = `describe('searchOff - bounded remote search', () => {\n  function mockOffResponse(count: number, productName = 'product') {\n    const products = Array.from({ length: count }, (_, i) => ({\n      product_name: \`${'${productName}'} ${'${i}'}\`,\n    }));\n    return mockResponse(200, { count, page: 1, page_size: 30, products });\n  }\n\n  it('una ricerca produce una sola richiesta HTTP e preserva la query', async () => {\n    fetchMock.mockResolvedValueOnce(mockOffResponse(3, 'pasta'));\n\n    const result = await searchOffWithPartialMatch('  pasta  ');\n\n    expect(result.products).toHaveLength(3);\n    expect(result.effectiveQuery).toBe('pasta');\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('query senza risultati non genera suffix expansion', async () => {\n    fetchMock.mockResolvedValueOnce(mockOffResponse(0));\n\n    const result = await searchOffWithPartialMatch('melanzan');\n\n    expect(result.products).toHaveLength(0);\n    expect(result.effectiveQuery).toBe('melanzan');\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('pagina successiva resta una singola richiesta', async () => {\n    fetchMock.mockResolvedValueOnce(mockOffResponse(30, 'pasta'));\n\n    const result = await searchOff('pasta', { page: 2 });\n\n    expect(result.page).toBe(1);\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n    expect(String(fetchMock.mock.calls[0][0])).toContain('page=2');\n  });\n\n  it('429 viene propagato senza tentare altri host', async () => {\n    fetchMock.mockResolvedValueOnce(mockResponse(429, {}));\n\n    await expect(searchOff('pasta')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('limiter locale blocca il decimo search nello stesso minuto prima della rete', async () => {\n    fetchMock.mockResolvedValue(mockOffResponse(1));\n    for (let i = 0; i < 9; i++) await searchOff(\`query-${'${i}'}\`);\n\n    await expect(searchOff('query-10')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });\n    expect(fetchMock).toHaveBeenCalledTimes(9);\n  });\n\n  it('AbortSignal già abortito non effettua richieste', async () => {\n    const controller = new AbortController();\n    controller.abort();\n\n    await expect(searchOff('pasta', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });\n    expect(fetchMock).not.toHaveBeenCalled();\n  });\n});\n`;
  source = replaceBetween(source, "describe('searchOffWithPartialMatch - suffix expansion'", null, replacement);
  write(path, source);
}

// ---- Nutrition: invalid estimates stay invalid; exact split invariant includes >100 edge.
{
  const path = 'test/nutrition.test.ts';
  let source = read(path);
  source = replaceTest(
    source,
    'ritorna 500 (clamp min) per TDEE non valido, con kcalClamped=true',
    `  it('mantiene esplicito un TDEE non valido senza inventare un target calorico', () => {\n    const r = calcGoalAdjustedCalories(0, 80, 75, 0.5, 'lose' as WeightGoalType);\n    expect(r.valid).toBe(false);\n    expect(r.kcal).toBe(0);\n    expect(r.kcalClamped).toBe(false);\n    expect(r.weeklyDeltaKg).toBe(0);\n  });\n`,
  );
  source = replaceTest(
    source,
    'ridistribuisce su fat split entro tolleranza 0.5 per garantire sum=100 esatto',
    `  it('normalizza anche gli split appena sopra 100 senza lasciare eccedenze', () => {\n    const r = normalizeMacroSplit({ proteinPct: 60, carbsPct: 40.2, fatPct: 0 });\n    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);\n    expect(r.proteinPct).toBeGreaterThanOrEqual(0);\n    expect(r.carbsPct).toBeGreaterThanOrEqual(0);\n    expect(r.fatPct).toBeGreaterThanOrEqual(0);\n  });\n\n  it('normalizza anche gli split appena sotto 100 a somma esatta', () => {\n    const r = normalizeMacroSplit({ proteinPct: 99.6, carbsPct: 0, fatPct: 0 });\n    expect(r.proteinPct + r.carbsPct + r.fatPct).toBe(100);\n  });\n`,
  );
  write(path, source);
}

// ---- Storage: backup import is complete + atomic.
{
  const path = 'test/storage.test.ts';
  let source = read(path);
  const block = `describe('importDataJson', () => {\n  function completeBackup(overrides: Record<string, unknown> = {}) {\n    return {\n      version: SCHEMA_VERSION,\n      settings: { calorieGoal: 2000, macroSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 }, theme: 'system' },\n      foods: [],\n      diary: {},\n      recipes: [],\n      favoriteFoodIds: [],\n      biometrics: {},\n      ...overrides,\n    };\n  }\n\n  it('importa un backup completo valido', () => {\n    const payload = completeBackup({\n      settings: { calorieGoal: 2500, macroSplit: { proteinPct: 40, carbsPct: 30, fatPct: 30 }, theme: 'dark' },\n      foods: [{\n        id: 'f1', name: 'Importata', source: 'custom', servingSize: 100,\n        nutrition: { calories: 100, protein: 5, carbs: 10, fat: 2 }, createdAt: 0,\n      }],\n    });\n    const r = importDataJson(JSON.stringify(payload));\n    expect(r.ok).toBe(true);\n    expect(getState().foods[0].name).toBe('Importata');\n    expect(getState().settings.calorieGoal).toBe(2500);\n  });\n\n  it('rigetta JSON non valido e non-oggetti', () => {\n    expect(importDataJson('{invalid json').ok).toBe(false);\n    expect(importDataJson('[1,2,3]').ok).toBe(false);\n  });\n\n  it('rigetta documenti non riconosciuti', () => {\n    const r = importDataJson(JSON.stringify({ random: 'data', another: 123 }));\n    expect(r.ok).toBe(false);\n  });\n\n  it('rigetta backup parziali senza cancellare i dati correnti', () => {\n    setState({\n      foods: [{\n        id: 'keep', name: 'Da conservare', source: 'custom', servingSize: 100,\n        nutrition: { calories: 50, protein: 1, carbs: 1, fat: 1 }, createdAt: 0,\n      }],\n    });\n    const before = getState().foods.map((food) => food.id);\n\n    const r = importDataJson(JSON.stringify({ version: SCHEMA_VERSION, settings: { calorieGoal: 1500 } }));\n\n    expect(r.ok).toBe(false);\n    expect(getState().foods.map((food) => food.id)).toEqual(before);\n  });\n\n  it('rigetta backup di schema futuro', () => {\n    const r = importDataJson(JSON.stringify(completeBackup({ version: SCHEMA_VERSION + 1 })));\n    expect(r.ok).toBe(false);\n  });\n\n  it('scarta entità invalide e ritorna count + skipped', () => {\n    const payload = completeBackup({\n      foods: [\n        { id: 'f1', name: 'Valida', source: 'custom', servingSize: 100, nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 } },\n        { id: 'f2', name: '', source: 'custom', servingSize: 100, nutrition: { calories: 1, protein: 1, carbs: 1, fat: 1 } },\n        { id: 'f3', name: 'Senza nutrition', source: 'custom', servingSize: 100 },\n      ],\n    });\n    const r = importDataJson(JSON.stringify(payload));\n    expect(r.ok).toBe(true);\n    if (r.ok) {\n      expect(r.count).toBe(1);\n      expect(r.skipped).toBe(2);\n    }\n  });\n\n  it('persiste il candidate prima di renderlo stato corrente', () => {\n    const payload = completeBackup({\n      foods: [{\n        id: 'f1', name: 'Persistente', source: 'custom', servingSize: 100,\n        nutrition: { calories: 100, protein: 1, carbs: 1, fat: 1 }, createdAt: 0,\n      }],\n    });\n    const r = importDataJson(JSON.stringify(payload));\n    expect(r.ok).toBe(true);\n    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);\n    expect(stored.foods).toHaveLength(1);\n    expect(stored.foods[0].name).toBe('Persistente');\n  });\n\n  it('se la persistenza fallisce, non sostituisce il dominio in memoria', () => {\n    setState({\n      foods: [{\n        id: 'old', name: 'Originale', source: 'custom', servingSize: 100,\n        nutrition: { calories: 80, protein: 2, carbs: 3, fat: 1 }, createdAt: 0,\n      }],\n    });\n    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {\n      const error = new Error('denied');\n      error.name = 'SecurityError';\n      throw error;\n    });\n\n    const r = importDataJson(JSON.stringify(completeBackup({ foods: [] })));\n\n    expect(r.ok).toBe(false);\n    expect(getState().foods.map((food) => food.id)).toEqual(['old']);\n  });\n});\n\n`;
  source = replaceBetween(source, "describe('importDataJson'", "describe('checkStorageSize'", block);
  write(path, source);
}

// ---- Complete reset owns all local storage/cache deletion through localData.ts.
{
  const path = 'src/lib/store.ts';
  let source = read(path);
  source = source.replace(
    "import { BACKUP_KEY, MAX_DIARY_ENTRIES_PER_DAY, STORAGE_KEY } from './constants';\n\nfunction clearAllStoredDataLocal(): void {\n  try {\n    localStorage.removeItem(STORAGE_KEY);\n  } catch {\n    /* ignore */\n  }\n  try {\n    localStorage.removeItem(BACKUP_KEY);\n  } catch {\n    /* ignore */\n  }\n}\n",
    "import { MAX_DIARY_ENTRIES_PER_DAY } from './constants';\nimport { clearAllLocalUserData } from './localData';\n",
  );
  source = source.replace(
    "  try {\n    clearAllStoredDataLocal();\n  } catch (e) {\n    console.warn('[store] pulizia storage fallita durante resetAll', e);\n  }",
    '  clearAllLocalUserData();',
  );
  write(path, source);
}

{
  const path = 'src/lib/storage.ts';
  let source = read(path);
  source = source.replace(
    "import { estimateStorageBytes, isStorageWarn, reconcileAll } from './normalize';",
    "import { estimateStorageBytes, isStorageWarn, reconcileAll } from './normalize';\nimport { clearLocalStorageData, clearRuntimeDataCaches } from './localData';",
  );
  const start = "export function clearAllStoredData(): void {";
  const end = "\nfunction isRecord(value: unknown): value is Record<string, unknown> {";
  const replacement = `export function clearAllStoredData(): void {\n  clearLocalStorageData();\n  void clearRuntimeDataCaches();\n  _revision = 0;\n  _lastDataSignature = '';\n  _quotaWarnedThisSession = false;\n  _stripWarnedThisSession = false;\n}\n`;
  source = replaceBetween(source, start, end, replacement);
  write(path, source);
}

// ---- Historical weight note uses the same causal source as the inferred value.
{
  const path = 'src/views/dashboard.ts';
  let source = read(path);
  source = source.replace(
    "? `<p class=\"bio-hint\">Peso dall'ultima registrazione (${escapeHtml(formatDateIT(getLatestWeightDate(state.biometrics)))})</p>`",
    "? `<p class=\"bio-hint\">Peso dall'ultima registrazione (${escapeHtml(formatDateIT(display.weightKgSourceDate ?? date))})</p>`",
  );
  source = replaceBetween(
    source,
    '/** Helper: ritorna la data dell\'ultimo peso registrato (per la nota "inferred"). */',
    '/** Mini sparkline SVG del trend peso.',
    '',
  );
  write(path, source);
}

// ---- Remove misleading clinical wording from technical clamps in Settings.
{
  const path = 'src/views/settings.ts';
  let source = read(path);
  source = source.replaceAll('range sicuro', 'range tecnico');
  source = source.replaceAll('rateo sicuro', 'rateo configurato');
  write(path, source);
}

console.log('Audit fixups applied.');
