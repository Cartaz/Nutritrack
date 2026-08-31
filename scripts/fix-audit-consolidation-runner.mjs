import fs from 'node:fs';

const path = 'scripts/apply-audit-consolidation.mjs';
let source = fs.readFileSync(path, 'utf8');
const oldBlock = `  source = replaceOnce(\n    source,\n    \`  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`,\n    \`  void clearRuntimeDataCaches();\\n  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`,\n    'reset cache cleanup',\n  );`;
const newBlock = `  {\n    const resetStart = source.indexOf('export function resetApplicationData(): ResetApplicationDataResult {');\n    if (resetStart < 0) throw new Error('Missing resetApplicationData');\n    const anchor = \`  _storageOK = true;\\n  _quotaWarnedThisSession = false;\\n\`;\n    const index = source.indexOf(anchor, resetStart);\n    if (index < 0) throw new Error('Missing reset cache cleanup anchor');\n    source =\n      source.slice(0, index) +\n      \`  void clearRuntimeDataCaches();\\n\` +\n      source.slice(index);\n  }`;
if (!source.includes(oldBlock)) throw new Error('Expected consolidation runner block not found');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
