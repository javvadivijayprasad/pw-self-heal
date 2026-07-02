#!/usr/bin/env node
/** pw-self-heal CLI — summarize or render the heal-event log. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HealEvent } from './types';
import { renderHtmlReport, summarize } from './report';

function loadEvents(path: string): HealEvent[] {
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as HealEvent);
  } catch {
    return [];
  }
}

function textReport(events: HealEvent[]): void {
  if (events.length === 0) {
    console.log('No heal events found.');
    return;
  }
  const s = summarize(events);
  console.log('pw-self-heal report');
  console.log('-'.repeat(48));
  console.log(`Total heals:      ${s.total}`);
  console.log(`Unique locators:  ${s.uniqueLocators}`);
  console.log(`Avg confidence:   ${s.avgScore.toFixed(4)}`);
  console.log(`Avg heal time:    ${Math.round(s.avgLatencyMs)} ms`);
  console.log(`By locator type:  ${Object.entries(s.byVia).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log('\nMost-healed locators:');
  for (const t of s.topHealed) console.log(`  ${String(t.count).padStart(3)}x  ${t.original} -> ${t.healed}`);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : '';
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const inPath = argValue(rest, '--in') || '.pwheal/heal-events.jsonl';

  if (cmd !== 'report') {
    console.log('Usage: pw-self-heal report [--in <heal-events.jsonl>] [--html [out.html]]');
    process.exitCode = cmd ? 1 : 0;
    return;
  }

  const events = loadEvents(inPath);
  const htmlArg = argValue(rest, '--html');
  if (htmlArg !== undefined) {
    const out = htmlArg || '.pwheal/report.html';
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderHtmlReport(events), 'utf-8');
    console.log(`Wrote HTML report: ${out} (${events.length} heals)`);
  } else {
    textReport(events);
  }
}

main();
