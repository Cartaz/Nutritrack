import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing end ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const apiPath = 'src/lib/api.ts';
const apiOriginal = read(apiPath);
if (apiOriginal.includes('One semantic search action maps to one remote request.')) {
  console.log('Audit consolidation already applied');
  process.exit(0);
}

// ---- OFF search contract: one user search -> one remote request, no suffix fan-out or retry/fallback.
{
  let source = apiOriginal;
  source = source.replace('  PARTIAL_MATCH_SUFFIXES,\n', '');
  source = replaceBetween(
    source,
    '/** Cerca prodotti su Open Food Facts con fallback multi-istanza */',
    '// ============ Partial match (suffix expansion) ============',
    `// One semantic search action maps to one remote request.\n// OFF documents a search rate limit of 10 requests/minute/IP; keep one slot of client-side margin.\nconst SEARCH_WINDOW_MS = 60_000;\nconst SEARCH_WINDOW_MAX = 9;\nconst _searchTimestamps: number[] = [];\n\nfunction acquireSearchSlot(now = Date.now()): void {\n  while (_searchTimestamps.length > 0 && now - _searchTimestamps[0] >= SEARCH_WINDOW_MS) {\n    _searchTimestamps.shift();\n  }\n  if (_searchTimestamps.length >= SEARCH_WINDOW_MAX) {\n    throw new ApiError('Troppe ricerche ravvicinate. Attendi qualche secondo e riprova.', 'RateLimitError', 429);\n  }\n  _searchTimestamps.push(now);\n}\n\nasync function searchGetJson<T>(url: string, signal?: AbortSignal): Promise<T> {\n  if (signal?.aborted) throw new ApiError('Aborted', 'AbortError');\n  if (typeof navigator !== 'undefined' && navigator.onLine === false) {\n    throw new ApiError('Sei offline. Verifica la connessione e riprova.', 'OfflineError');\n  }\n\n  const controller = new AbortController();\n  const onAbort = (): void => controller.abort();\n  signal?.addEventListener('abort', onAbort, { once: true });\n  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);\n\n  try {\n    const response = await fetch(url, {\n      headers: { Accept: 'application/json' },\n      signal: controller.signal,\n    });\n    if (response.status === 429) {\n      throw new ApiError('Limite richieste Open Food Facts raggiunto', 'RateLimitError', 429);\n    }\n    if (!response.ok) {\n      throw new ApiError(\`Errore Open Food Facts: \${response.status}\`, 'ApiError', response.status);\n    }\n    const contentType = response.headers.get('content-type') || '';\n    if (!contentType.includes('application/json')) {\n      throw new ApiError('Risposta Open Food Facts non JSON', 'ApiError');\n    }\n    return (await response.json()) as T;\n  } catch (error) {\n    if (error instanceof ApiError) throw error;\n    const err = error as { name?: string };\n    if (err?.name === 'AbortError') {\n      if (signal?.aborted) throw new ApiError('Aborted', 'AbortError');\n      throw new ApiError('Timeout Open Food Facts', 'TimeoutError');\n    }\n    if (err?.name === 'TypeError') throw new ApiError('Network', 'NetworkError');\n    throw error;\n  } finally {\n    clearTimeout(timeoutId);\n    signal?.removeEventListener('abort', onAbort);\n  }\n}\n\n/** Cerca prodotti su Open Food Facts. Una chiamata corrisponde a una sola richiesta HTTP. */\nexport async function searchOff(\n  query: string,\n  opts: SearchOffOpts = {},\n): Promise<{ products: OffProduct[]; count: number; page: number; pageSize: number }> {\n  const normalizedQuery = query.trim();\n  const page = opts.page ?? 1;\n  const pageSize = opts.pageSize ?? OFF_PAGE_SIZE;\n  if (!normalizedQuery) return { products: [], count: 0, page, pageSize };\n\n  acquireSearchSlot();\n  const params = new URLSearchParams({\n    search_terms: normalizedQuery,\n    search_simple: '1',\n    action: 'process',\n    json: '1',\n    page: String(page),\n    page_size: String(pageSize),\n    sort_by: 'unique_scans_n',\n  });\n  if (opts.italianOnly) {\n    params.set('tagtype_0', 'countries');\n    params.set('tag_contains_0', 'contains');\n    params.set('tag_0', 'italia');\n  }\n\n  const base = OFF_INSTANCES[0];\n  const data = await searchGetJson<OffSearchResponse | null>(\n    \`\${base}/cgi/search.pl?\${params.toString()}\`,\n    opts.signal,\n  );\n  if (!data || typeof data !== 'object') return { products: [], count: 0, page, pageSize };\n\n  const normalizeNum = (value: unknown, fallback: number): number => {\n    if (typeof value === 'number' && Number.isFinite(value)) return value;\n    if (typeof value === 'string') {\n      const parsed = Number(value);\n      if (Number.isFinite(parsed)) return parsed;\n    }\n    return fallback;\n  };\n\n  return {\n    products: Array.isArray(data.products) ? data.products : [],\n    count: normalizeNum(data.count, 0),\n    page: normalizeNum(data.page, page),\n    pageSize: normalizeNum(data.page_size, pageSize),\n  };\n}\n\n`,
    'searchOff implementation',
  );
  source = replaceBetween(
    source,
    '// ============ Partial match (suffix expansion) ============',
    '/** Recupera un prodotto per barcode.',
    `// ============ Search compatibility ============\n\n/** Compatibility wrapper: automatic suffix expansion was removed to preserve the OFF rate-limit contract. */\nexport interface SearchOffResult {\n  products: OffProduct[];\n  count: number;\n  page: number;\n  pageSize: number;\n  effectiveQuery: string;\n}\n\nexport async function searchOffWithPartialMatch(query: string, opts: SearchOffOpts = {}): Promise<SearchOffResult> {\n  const result = await searchOff(query, opts);\n  return { ...result, effectiveQuery: query.trim() };\n}\n\n/** Test-only reset for deterministic rate-limit tests. */\nexport function __resetSearchLimiterForTesting(): void {\n  _searchTimestamps.length = 0;\n}\n\n`,
    'partial-match implementation',
  );
  write(apiPath, source);
}

// ---- Semantic food-search module keeps UI simple but no longer multiplies textual searches.
{
  const path = 'src/lib/food-search.ts';
  let source = read(path);
  source = replaceOnce(
    source,
    "import { getOffByBarcode, searchOff, searchOffWithPartialMatch } from './api';",
    "import { getOffByBarcode, searchOff } from './api';",
    'food-search api import',
  );
  source = replaceBetween(
    source,
    '/** Initial semantic food search. Partial-match and effective-query policy remain internal. */',
    '/** Continue a previous search without exposing OFF effective-query/page mechanics to UI code. */',
    `/** Initial semantic food search. Text search is never retried automatically. */\nexport async function searchFoods(query: string, options: SearchOptions = {}): Promise<FoodSearchPage> {\n  const effectiveInput = query.trim();\n  const italianOnly = options.italianOnly ?? false;\n  try {\n    const result = await searchOff(effectiveInput, { signal: options.signal, italianOnly, page: 1 });\n    return {\n      foods: mapFoods(result.products),\n      totalCount: result.count,\n      continuation: continuationFor(effectiveInput, result.page, result.pageSize, result.count, italianOnly),\n    };\n  } catch (error) {\n    if (options.signal?.aborted || isAbortError(error)) throw error;\n    throw new FoodSearchError(classifyError(error), error);\n  }\n}\n\n`,
    'searchFoods',
  );
  source = replaceBetween(
    source,
    '/** Continue a previous search without exposing OFF effective-query/page mechanics to UI code. */',
    '/** Remote OFF barcode lookup. Saved/local database precedence remains a UI/application concern. */',
    `/** Continue a previous search. Pagination is another explicit user action and maps to one request. */\nexport async function continueFoodSearch(\n  continuation: FoodSearchContinuation,\n  options: Pick<SearchOptions, 'signal'> = {},\n): Promise<FoodSearchPage> {\n  try {\n    const result = await searchOff(continuation.effectiveQuery, {\n      signal: options.signal,\n      italianOnly: continuation.italianOnly,\n      page: continuation.nextPage,\n    });\n    return {\n      foods: mapFoods(result.products),\n      totalCount: result.count,\n      continuation: continuationFor(\n        continuation.effectiveQuery,\n        result.page,\n        result.pageSize,\n        result.count,\n        continuation.italianOnly,\n      ),\n    };\n  } catch (error) {\n    if (options.signal?.aborted || isAbortError(error)) throw error;\n    throw new FoodSearchError(classifyError(error), error);\n  }\n}\n\n`,
    'continueFoodSearch',
  );
  write(path, source);
}

// ---- Search UI: typing is local state only; network starts only on Search/Enter/load-more.
{
  const path = 'src/components/search.ts';
  let source = read(path);
  source = replaceOnce(source, "import { escapeHtml, escapeAttr, debounce, safeId } from '../lib/utils';", "import { escapeHtml, escapeAttr, safeId } from '../lib/utils';", 'search utils import');
  source = replaceOnce(source, "import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from '../lib/constants';", "import { SEARCH_MIN_QUERY } from '../lib/constants';", 'search constants import');
  source = source.replace('// ============ Debounced initial search ============', '// ============ Explicit initial search ============');
  source = replaceBetween(
    source,
    'const scheduleSearch = debounce((query: string) => {',
    '// ============ Event bindings (una sola volta) ============',
    '// ============ Event bindings (una sola volta) ============\n\n',
    'debounced search trigger',
  );
  source = replaceOnce(source, '  scheduleSearch.cancel();\n', '', 'scheduleSearch cancel');
  source = replaceOnce(
    source,
    `          emitChange();\n          if (\n            tab === 'search' &&\n            _searchState.query.trim().length >= SEARCH_MIN_QUERY &&\n            _searchState.results.length === 0\n          ) {\n            _searchState.loading = true;\n            emitChange();\n            scheduleSearch(_searchState.query);\n          }\n`,
    '          emitChange();\n',
    'switch-tab auto search',
  );
  source = replaceOnce(
    source,
    `      case 'clearQuery': {\n`,
    `      case 'runSearch': {\n        if (_searchState.query.trim().length < SEARCH_MIN_QUERY) {\n          showToast(\`Inserisci almeno \${SEARCH_MIN_QUERY} caratteri\`, 'info');\n          return;\n        }\n        _searchState.loading = true;\n        emitChange();\n        void executeSearch(_searchState.query);\n        return;\n      }\n      case 'clearQuery': {\n`,
    'runSearch action',
  );
  const inputOld = `      if (_searchState.query.trim().length < SEARCH_MIN_QUERY) {\n        _searchState.results = [];\n        emitChange();\n        return;\n      }\n      _searchState.loading = true;\n      emitChange();\n      scheduleSearch(_searchState.query);\n      return;\n`;
  const inputNew = `      _searchState.results = [];\n      emitChange();\n      return;\n`;
  source = replaceOnce(source, inputOld, inputNew, 'typing network trigger');
  source = replaceOnce(
    source,
    `    if (e.key === 'Enter') {\n      if (target.id === 'new-portion-label' || target.id === 'new-portion-grams') {\n`,
    `    if (e.key === 'Enter') {\n      if (target.id === 'search-input') {\n        e.preventDefault();\n        if (_searchState.query.trim().length >= SEARCH_MIN_QUERY) {\n          _searchState.loading = true;\n          emitChange();\n          void executeSearch(_searchState.query);\n        }\n        return;\n      }\n      if (target.id === 'new-portion-label' || target.id === 'new-portion-grams') {\n`,
    'search Enter action',
  );
  source = replaceOnce(
    source,
    `          <button type="button" class="scan-btn" data-search-action="scanBarcode" aria-label="Scansiona codice a barre" title="Scansiona codice a barre">\n            <span aria-hidden="true">📷</span>\n          </button>\n`,
    `          <button type="button" class="btn btn-primary" data-search-action="runSearch">Cerca</button>\n          <button type="button" class="scan-btn" data-search-action="scanBarcode" aria-label="Scansiona codice a barre" title="Scansiona codice a barre">\n            <span aria-hidden="true">📷</span>\n          </button>\n`,
    'search button markup',
  );
  source = source.replace(
    'Database gratuito collaborativo - milioni di prodotti. Powered by Open Food Facts. Usa 📷 per scansionare il codice a barre.',
    'Database gratuito collaborativo - milioni di prodotti. Premi Cerca o Invio per interrogare Open Food Facts. Usa 📷 per il codice a barre.',
  );
  write(path, source);
}

// ---- Runtime data cache ownership.
{
  const path = 'src/lib/localData.ts';
  write(
    path,
    `const USER_DATA_CACHE_NAMES = ['nutritrack-off-api', 'nutritrack-off-img', 'nutritrack-img'] as const;\n\n/** Runtime caches may contain OFF search URLs and user-triggered remote images. */\nexport async function clearRuntimeDataCaches(): Promise<void> {\n  if (typeof caches === 'undefined') return;\n  await Promise.all(\n    USER_DATA_CACHE_NAMES.map(async (name) => {\n      try {\n        await caches.delete(name);\n      } catch {\n        // CacheStorage is best-effort and must not invalidate the atomic localStorage reset.\n      }\n    }),\n  );\n}\n`,
  );
}

// ---- Persistence: no modal-driven pending state, complete reset caches, import rollback on persistence failure.
{
  const path = 'src/lib/storage.ts';
  let source = read(path);
  source = replaceOnce(
    source,
    "import { migratePersistedDocument, type MigrationFailureReason } from './migrations';",
    "import { migratePersistedDocument, type MigrationFailureReason } from './migrations';\nimport { clearRuntimeDataCaches } from './localData';",
    'storage localData import',
  );
  source = source.replace('type PendingMultiTabUpdate = ParsedPersistedPayload;\n', '');
  source = source.replace('let _pendingMultiTabUpdate: PendingMultiTabUpdate | null = null;\n', '');
  source = source.replace(/\n  if \(_pendingMultiTabUpdate && !isRemoteNewer\(_pendingMultiTabUpdate\)\) \{\n    _pendingMultiTabUpdate = null;\n  \}/, '');
  source = source.replace(/\n\s*_pendingMultiTabUpdate = null;/g, '');
  source = replaceBetween(
    source,
    'function queuePendingRemote(remote: PendingMultiTabUpdate): void {',
    '/**\n * Se due tab hanno prodotto la stessa revisione',
    '/**\n * Se due tab hanno prodotto la stessa revisione',
    'pending remote queue',
  );
  source = replaceOnce(
    source,
    `  if (hasUnsyncedLocalState()) {\n    const saved = saveData();\n    if (!saved.ok) {\n      queuePendingRemote(remote);\n      return;\n    }\n    if (!isRemoteNewer(remote)) return;\n  }\n`,
    `  if (hasUnsyncedLocalState()) {\n    const saved = saveData();\n    if (!saved.ok) return;\n    if (!isRemoteNewer(remote)) return;\n  }\n`,
    'storage-event pending fallback',
  );
  source = replaceBetween(
    source,
    '/**\n * Riprova ad applicare l\'ultimo snapshot remoto rimasto pending',
    '/**\n * Reset interno per test',
    '/**\n * Reset interno per test',
    'flushPendingMultiTabUpdate',
  );
  source = replaceOnce(
    source,
    `  const result = writeLocalSnapshot(buildStateSnapshot(), null, baseRevision, 'reset');\n  if (!result.ok) {\n`,
    `  const result = writeLocalSnapshot(buildStateSnapshot(), null, baseRevision, 'reset');\n  if (!result.ok) {\n`,
    'reset write anchor',
  );
  source = replaceOnce(
    source,
    `  _storageOK = true;\n  _quotaWarnedThisSession = false;\n`,
    `  void clearRuntimeDataCaches();\n  _storageOK = true;\n  _quotaWarnedThisSession = false;\n`,
    'reset cache cleanup',
  );
  source = replaceOnce(
    source,
    `  applyStateSnapshot(importedState);\n  // Non adottare revision/origin presenti nel file importato: un import è una nuova\n`,
    `  const beforeState: AppState = { ...getState() };\n  applyStateSnapshot(importedState);\n  // Non adottare revision/origin presenti nel file importato: un import è una nuova\n`,
    'import rollback snapshot',
  );
  source = replaceOnce(
    source,
    `  if (!saveResult.ok) {\n    return { ok: false, error: saveResult.error };\n  }\n  emitChange();\n`,
    `  if (!saveResult.ok) {\n    setState(beforeState);\n    return { ok: false, error: saveResult.error };\n  }\n  emitChange();\n`,
    'import rollback restore',
  );
  write(path, source);
}

// ---- Renderer no longer knows or triggers multi-tab retry policy.
{
  const path = 'src/components/renderer.ts';
  let source = read(path);
  source = replaceOnce(
    source,
    "import { flushPendingMultiTabUpdate, resetApplicationData } from '../lib/storage';",
    "import { resetApplicationData } from '../lib/storage';",
    'renderer storage import',
  );
  source = replaceOnce(
    source,
    `    // Quando tutti i dialog sono chiusi, applica eventuali update cross-tab ricevuti\n    // durante un workflow modale.\n    flushPendingMultiTabUpdate();\n`,
    '',
    'renderer modal flush',
  );
  write(path, source);
}

// ---- Store owns date validity at its boundary.
{
  const path = 'src/lib/store.ts';
  let source = read(path);
  source = replaceOnce(source, "import { safeId, toDateKey } from './utils';", "import { isValidDateKey, safeId, toDateKey } from './utils';", 'store utils import');
  source = replaceOnce(
    source,
    `export function setCurrentDate(date: string): void {\n  state.currentDate = date;\n  emitChange();\n}\n`,
    `export function setCurrentDate(date: string): void {\n  if (!isValidDateKey(date)) return;\n  state.currentDate = date;\n  emitChange();\n}\n`,
    'setCurrentDate guard',
  );
  write(path, source);
}

// ---- Update semantic search regression tests.
{
  const path = 'test/food-search.test.ts';
  write(
    path,
    `import { beforeEach, describe, expect, it, vi } from 'vitest';\nimport type { FoodItem, OffProduct } from '../src/types';\n\nconst mocks = vi.hoisted(() => ({\n  searchOff: vi.fn(),\n  getOffByBarcode: vi.fn(),\n  buildFoodFromOff: vi.fn(),\n}));\n\nvi.mock('../src/lib/api', () => ({\n  searchOff: mocks.searchOff,\n  getOffByBarcode: mocks.getOffByBarcode,\n}));\n\nvi.mock('../src/lib/normalize', () => ({\n  buildFoodFromOff: mocks.buildFoodFromOff,\n}));\n\nimport { continueFoodSearch, lookupFoodByBarcode, searchFoods } from '../src/lib/food-search';\n\nconst FOOD: FoodItem = {\n  id: 'off-1',\n  name: 'Melanzane',\n  source: 'openfoodfacts',\n  servingSize: 100,\n  nutrition: { calories: 25, protein: 1, carbs: 6, fat: 0.2 },\n  createdAt: 1,\n};\nconst PRODUCT = { code: '123' } as OffProduct;\n\nbeforeEach(() => {\n  vi.useRealTimers();\n  vi.clearAllMocks();\n  mocks.buildFoodFromOff.mockReturnValue(FOOD);\n});\n\ndescribe('food search policy', () => {\n  it('maps one initial search to one searchOff call and keeps pagination opaque', async () => {\n    mocks.searchOff.mockResolvedValue({ products: [PRODUCT], count: 5, page: 1, pageSize: 2 });\n\n    const result = await searchFoods(' melanzan ', { italianOnly: true });\n\n    expect(mocks.searchOff).toHaveBeenCalledTimes(1);\n    expect(mocks.searchOff).toHaveBeenCalledWith('melanzan', { signal: undefined, italianOnly: true, page: 1 });\n    expect(result.foods).toEqual([FOOD]);\n    expect(result.continuation).toEqual({ effectiveQuery: 'melanzan', nextPage: 2, italianOnly: true });\n  });\n\n  it('continues pagination with exactly one explicit request', async () => {\n    mocks.searchOff.mockResolvedValue({ products: [PRODUCT], count: 5, page: 2, pageSize: 2 });\n    const result = await continueFoodSearch({ effectiveQuery: 'melanzan', nextPage: 2, italianOnly: true });\n    expect(mocks.searchOff).toHaveBeenCalledTimes(1);\n    expect(result.continuation).toEqual({ effectiveQuery: 'melanzan', nextPage: 3, italianOnly: true });\n  });\n\n  it('does not retry a transient textual-search failure automatically', async () => {\n    mocks.searchOff.mockRejectedValue(Object.assign(new Error('network'), { name: 'NetworkError' }));\n    await expect(searchFoods('pasta')).rejects.toMatchObject({ name: 'FoodSearchError', kind: 'network' });\n    expect(mocks.searchOff).toHaveBeenCalledTimes(1);\n  });\n});\n\ndescribe('barcode lookup policy', () => {\n  it('keeps a single retry for point barcode lookup', async () => {\n    vi.useFakeTimers();\n    mocks.getOffByBarcode\n      .mockRejectedValueOnce(Object.assign(new Error('network'), { name: 'NetworkError' }))\n      .mockResolvedValueOnce(PRODUCT);\n    const pending = lookupFoodByBarcode('123');\n    await vi.advanceTimersByTimeAsync(10_000);\n    await expect(pending).resolves.toEqual({ kind: 'found', food: FOOD });\n    expect(mocks.getOffByBarcode).toHaveBeenCalledTimes(2);\n  });\n\n  it('distinguishes not-found from nutritionally incomplete products', async () => {\n    mocks.getOffByBarcode.mockResolvedValueOnce(null).mockResolvedValueOnce(PRODUCT);\n    mocks.buildFoodFromOff.mockReturnValueOnce(null);\n    await expect(lookupFoodByBarcode('missing')).resolves.toEqual({ kind: 'not-found' });\n    await expect(lookupFoodByBarcode('incomplete')).resolves.toEqual({ kind: 'incomplete' });\n  });\n});\n`,
  );
}

// ---- Direct API contract tests.
{
  write(
    'test/off-search-contract.test.ts',
    `import { beforeEach, describe, expect, it, vi } from 'vitest';\nimport { __resetSearchLimiterForTesting, searchOff } from '../src/lib/api';\n\nconst fetchMock = vi.fn();\n\nfunction response(status: number, body: unknown): Response {\n  return {\n    ok: status >= 200 && status < 300,\n    status,\n    headers: new Headers({ 'content-type': 'application/json' }),\n    json: async () => body,\n  } as unknown as Response;\n}\n\nbeforeEach(() => {\n  fetchMock.mockReset();\n  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;\n  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });\n  __resetSearchLimiterForTesting();\n});\n\ndescribe('OFF textual search request budget', () => {\n  it('uses exactly one HTTP request for one search action', async () => {\n    fetchMock.mockResolvedValue(response(200, { count: 0, page: 1, page_size: 30, products: [] }));\n    await searchOff('pasta');\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('does not evade a 429 by retrying or switching host', async () => {\n    fetchMock.mockResolvedValue(response(429, {}));\n    await expect(searchOff('pasta')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('blocks the tenth client-side search inside a rolling minute', async () => {\n    fetchMock.mockResolvedValue(response(200, { count: 0, page: 1, page_size: 30, products: [] }));\n    for (let i = 0; i < 9; i++) await searchOff(\`pasta-\${i}\`);\n    await expect(searchOff('pasta-9')).rejects.toMatchObject({ name: 'RateLimitError', status: 429 });\n    expect(fetchMock).toHaveBeenCalledTimes(9);\n  });\n});\n`,
  );
}

// ---- Cross-cutting regressions unique to the consolidation.
{
  write(
    'test/audit-consolidation.test.ts',
    `import { beforeEach, describe, expect, it, vi } from 'vitest';\nimport { clearRuntimeDataCaches } from '../src/lib/localData';\nimport { __resetStorageInternalForTesting, importDataJson } from '../src/lib/storage';\nimport { getState, setCurrentDate, setState } from '../src/lib/store';\nimport { SCHEMA_VERSION } from '../src/lib/constants';\n\nbeforeEach(() => {\n  localStorage.clear();\n  __resetStorageInternalForTesting();\n});\n\ndescribe('audit consolidation invariants', () => {\n  it('rolls back an import when persistence fails', () => {\n    setState({ foods: [], settings: { ...getState().settings, calorieGoal: 2100 } });\n    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {\n      throw new Error('write failed');\n    });\n\n    const result = importDataJson(\n      JSON.stringify({\n        version: SCHEMA_VERSION,\n        settings: { ...getState().settings, calorieGoal: 1300 },\n        foods: [],\n        diary: {},\n        recipes: [],\n        favoriteFoodIds: [],\n        biometrics: {},\n      }),\n    );\n\n    expect(result.ok).toBe(false);\n    expect(getState().settings.calorieGoal).toBe(2100);\n  });\n\n  it('rejects an impossible dashboard date at the store boundary', () => {\n    setState({ currentDate: '2026-01-01' });\n    setCurrentDate('2026-02-30');\n    expect(getState().currentDate).toBe('2026-01-01');\n  });\n\n  it('clears only runtime caches that can contain user-triggered remote activity', async () => {\n    const deleteCache = vi.fn().mockResolvedValue(true);\n    const previousCaches = globalThis.caches;\n    Object.defineProperty(globalThis, 'caches', { configurable: true, value: { delete: deleteCache } });\n    try {\n      await clearRuntimeDataCaches();\n      expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([\n        'nutritrack-off-api',\n        'nutritrack-off-img',\n        'nutritrack-img',\n      ]);\n    } finally {\n      Object.defineProperty(globalThis, 'caches', { configurable: true, value: previousCaches });\n    }\n  });\n});\n`,
  );
}

console.log('Audit consolidation applied');
