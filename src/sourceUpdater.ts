/**
 * Optional source rewrite: when a heal succeeds, replace the old selector string
 * with the healed one in the test source. Best-effort; never throws.
 * Ported from `sdk/playwright/self_healing_page.js`.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTS = ['.js', '.ts', '.spec.js', '.spec.ts', '.test.js', '.test.ts'];

function findFile(dir: string, oldSelector: string): string | null {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, oldSelector);
      if (found) return found;
    } else if (EXTS.some((e) => entry.name.endsWith(e))) {
      try {
        if (readFileSync(full, 'utf-8').includes(oldSelector)) return full;
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

export function updateSourceFile(
  sourceRoot: string,
  oldSelector: string,
  newSelector: string,
): boolean {
  const target = findFile(resolve(sourceRoot), oldSelector);
  if (!target) return false;
  try {
    const content = readFileSync(target, 'utf-8');
    const updated = content
      .split(`'${oldSelector}'`).join(`'${newSelector}'`)
      .split(`"${oldSelector}"`).join(`"${newSelector}"`)
      .split(`\`${oldSelector}\``).join(`\`${newSelector}\``);
    if (updated !== content) {
      writeFileSync(target, updated, 'utf-8');
      return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}
