import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Missing ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

{
  const path = 'test/api.test.ts';
  let source = fs.readFileSync(path, 'utf8');
  const marker = "describe('searchOffWithPartialMatch - suffix expansion', () => {";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Missing obsolete suffix-expansion tests');
  source =
    source.slice(0, start) +
    `describe('searchOffWithPartialMatch - compatibility wrapper', () => {\n  function offResponse(count: number) {\n    const products = Array.from({ length: count }, (_, index) => ({\n      _id: \`product-\${index}\`,\n      product_name: \`Product \${index}\`,\n    }));\n    return mockResponse(200, { count, page: 1, page_size: 30, products });\n  }\n\n  it('preserves the original query and performs one request', async () => {\n    fetchMock.mockResolvedValueOnce(offResponse(2));\n    const result = await searchOffWithPartialMatch('melanzan');\n    expect(result.products).toHaveLength(2);\n    expect(result.effectiveQuery).toBe('melanzan');\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('keeps an empty result empty instead of multiplying requests', async () => {\n    fetchMock.mockResolvedValueOnce(offResponse(0));\n    const result = await searchOffWithPartialMatch('xyzqwerty');\n    expect(result.products).toEqual([]);\n    expect(result.effectiveQuery).toBe('xyzqwerty');\n    expect(fetchMock).toHaveBeenCalledTimes(1);\n  });\n\n  it('propagates an already-aborted external signal without fetch', async () => {\n    const ctrl = new AbortController();\n    ctrl.abort();\n    await expect(searchOffWithPartialMatch('melanzan', { signal: ctrl.signal })).rejects.toMatchObject({\n      name: 'AbortError',\n    });\n    expect(fetchMock).not.toHaveBeenCalled();\n  });\n});\n`;
  fs.writeFileSync(path, source);
}

{
  const path = 'test/app-smoke.test.ts';
  let source = fs.readFileSync(path, 'utf8');
  const old = `    searchInput!.value = 'pasta';\n    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));\n    await flushUi();\n\n    expect(searchMocks.searchFoods).toHaveBeenCalledWith('pasta', {\n`;
  const replacement = `    searchInput!.value = 'pasta';\n    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));\n    await flushUi();\n    expect(searchMocks.searchFoods).not.toHaveBeenCalled();\n\n    const searchButton = document.querySelector<HTMLButtonElement>('[data-search-action="runSearch"]');\n    expect(searchButton).not.toBeNull();\n    searchButton!.click();\n    await flushUi();\n\n    expect(searchMocks.searchFoods).toHaveBeenCalledWith('pasta', {\n`;
  source = replaceOnce(source, old, replacement, 'explicit search smoke trigger');
  fs.writeFileSync(path, source);
}
