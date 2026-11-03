import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HealEvent } from '../src/types';

const VITE_NODE = join(process.cwd(), 'node_modules', 'vite-node', 'vite-node.mjs');
const CLI = join(process.cwd(), 'src', 'cli.ts');

function heal(original: string, healed: string, timestamp: number): HealEvent {
  return {
    timestamp,
    testId: 't',
    original,
    healed,
    score: 0.9,
    mode: 'heuristic',
    candidatesEvaluated: 3,
    elapsedMs: 12,
    via: 'testid',
  } as HealEvent;
}

describe('pw-self-heal report --json', () => {
  it('prints only parseable JSON of the summary to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwheal-json-'));
    try {
      const file = join(dir, 'heal-events.jsonl');
      writeFileSync(
        file,
        [
          heal('[data-testid="a"]', '[data-testid="a2"]', 1),
          heal('[data-testid="a"]', '[data-testid="a2"]', 2),
          heal('#b', '#c', 3),
        ]
          .map((e) => JSON.stringify(e))
          .join('\n') + '\n',
      );

      const stdout = execFileSync(process.execPath, [VITE_NODE, CLI, 'report', '--in', file, '--json'], {
        encoding: 'utf-8',
      });

      const summary = JSON.parse(stdout);
      expect(summary.total).toBe(3);
      expect(summary.uniqueLocators).toBe(2);
      expect(summary.byVia).toEqual({ testid: 3 });
      expect(summary.topHealed[0]).toEqual({ original: '[data-testid="a"]', healed: '[data-testid="a2"]', count: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
