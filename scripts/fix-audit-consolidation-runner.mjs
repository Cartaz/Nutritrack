import fs from 'node:fs';

const path = 'scripts/apply-audit-consolidation.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldResetBlock = `  source = replaceOnce(\n    source,\n    \`  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`,\n    \`  void clearRuntimeDataCaches();\\n  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`,\n    'reset cache cleanup',\n  );`;
const newResetBlock = `  {\n    const resetStart = source.indexOf('export function resetApplicationData(): ResetApplicationDataResult {');\n    if (resetStart < 0) throw new Error('Missing resetApplicationData');\n    const anchor = \`  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`;\n    const index = source.indexOf(anchor, resetStart);\n    if (index < 0) throw new Error('Missing reset cache cleanup anchor');\n    source =\n      source.slice(0, index) +\n      \`  void clearRuntimeDataCaches();\\n\` +\n      source.slice(index);\n  }`;
if (!source.includes(oldResetBlock)) throw new Error('Expected reset consolidation block not found');
source = source.replace(oldResetBlock, newResetBlock);

const oldDebounceBlock = `  source = replaceBetween(\n    source,\n    'const scheduleSearch = debounce((query: string) => {',\n    '// ============ Event bindings (una sola volta) ============',\n    '// ============ Event bindings (una sola volta) ============\\n\\n',\n    'debounced search trigger',\n  );`;
const newDebounceBlock = `  source = replaceOnce(\n    source,\n    \`const scheduleSearch = debounce((query: string) => {\\n  void executeSearch(query);\\n}, SEARCH_DEBOUNCE_MS);\\n\\n\`,\n    '',\n    'debounced search trigger',\n  );`;
if (!source.includes(oldDebounceBlock)) throw new Error('Expected debounce consolidation block not found');
source = source.replace(oldDebounceBlock, newDebounceBlock);

fs.writeFileSync(path, source);
