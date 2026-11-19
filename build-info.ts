// Informazioni di build iniettate nell'app come costanti globali (vedi src/vite-env.d.ts):
// versione da package.json, data del build e commit (GITHUB_SHA in CI, altrimenti git locale).

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function currentCommit(): string {
  const fromCi = process.env.GITHUB_SHA?.slice(0, 7);
  if (fromCi) return fromCi;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export function buildInfoDefines(): Record<string, string> {
  const { version } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  };
  return {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(currentCommit()),
  };
}
