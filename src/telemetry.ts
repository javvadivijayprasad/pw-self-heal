/** Heal-event telemetry — append-only JSONL writer. */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HealEvent } from './types';

export function appendHealEvent(path: string, event: HealEvent): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8');
  } catch {
    /* telemetry is best-effort; never fail a test over it */
  }
}
