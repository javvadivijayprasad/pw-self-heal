/**
 * HTML + summary report generation from the heal-event log.
 * Standalone, dependency-free HTML (inline styles, dark-mode aware) so the
 * output file opens anywhere and is easy to screenshot / attach to a PR.
 */

import type { HealEvent } from './types';

export interface HealSummary {
  total: number;
  uniqueLocators: number;
  avgScore: number;
  avgLatencyMs: number;
  byVia: Record<string, number>;
  byMode: Record<string, number>;
  topHealed: Array<{ original: string; healed: string; count: number }>;
}

export function summarize(events: HealEvent[]): HealSummary {
  const byOriginal = new Map<string, HealEvent[]>();
  const byVia: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let totalScore = 0;
  let totalMs = 0;
  for (const e of events) {
    totalScore += e.score;
    totalMs += e.elapsedMs;
    byVia[e.via ?? 'string'] = (byVia[e.via ?? 'string'] ?? 0) + 1;
    byMode[e.mode] = (byMode[e.mode] ?? 0) + 1;
    const arr = byOriginal.get(e.original) ?? [];
    arr.push(e);
    byOriginal.set(e.original, arr);
  }
  const n = events.length || 1;
  const topHealed = [...byOriginal.entries()]
    .map(([original, evs]) => ({ original, healed: evs[evs.length - 1].healed, count: evs.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return {
    total: events.length,
    uniqueLocators: byOriginal.size,
    avgScore: events.length ? totalScore / events.length : 0,
    avgLatencyMs: events.length ? totalMs / n : 0,
    byVia,
    byMode,
    topHealed,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bar(score: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const color = score >= 0.8 ? '#1d9e75' : score >= 0.6 ? '#ba7517' : '#888780';
  return `<div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

const VIA_LABEL: Record<string, string> = {
  testid: 'getByTestId', role: 'getByRole', label: 'getByLabel', text: 'getByText',
  placeholder: 'getByPlaceholder', altText: 'getByAltText', title: 'getByTitle',
  css: 'locator(css)', xpath: 'locator(xpath)', string: 'string selector',
};

export function renderHtmlReport(events: HealEvent[], title = 'pw-self-heal report'): string {
  const s = summarize(events);
  const fmtTime = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
  const viaChips = Object.entries(s.byVia)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="chip">${esc(VIA_LABEL[k] ?? k)} · ${v}</span>`)
    .join('');

  const rows = events
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (e) => `
      <tr>
        <td><span class="pill pill-ok">healed</span></td>
        <td class="mono"><span class="old">${esc(e.original)}</span> <span class="arrow">→</span> <span class="new">${esc(e.healed)}</span></td>
        <td class="mono small">${esc(VIA_LABEL[e.via ?? 'string'] ?? (e.via ?? 'string'))}</td>
        <td>${bar(e.score)}<span class="score">${e.score.toFixed(2)}</span></td>
        <td class="small">${e.mode}</td>
        <td class="small muted">${Math.round(e.elapsedMs)} ms</td>
        <td class="small muted">${fmtTime(e.timestamp)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#fff;--surface:#f7f6f2;--card:#fff;--text:#1a1a18;--muted:#6b6a64;--border:#e6e4dc;--ok-bg:#e1f5ee;--ok-fg:#0f6e56;}
  @media(prefers-color-scheme:dark){:root{--bg:#1a1a18;--surface:#232320;--card:#202018;--text:#ece9e0;--muted:#a3a299;--border:#33332e;--ok-bg:#0f3d31;--ok-fg:#5dcaa5;}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;padding:28px;max-width:1000px;margin:0 auto}
  h1{font-size:20px;font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}
  .metric{background:var(--surface);border-radius:10px;padding:14px 16px}
  .metric .label{font-size:12px;color:var(--muted)}
  .metric .num{font-size:24px;font-weight:600;margin-top:2px}
  .chips{margin-bottom:20px;display:flex;flex-wrap:wrap;gap:8px}
  .chip{background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:12px;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:var(--muted);font-weight:500;font-size:12px;padding:8px 10px;border-bottom:1px solid var(--border)}
  td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .small{font-size:12px}.muted{color:var(--muted)}
  .old{color:var(--muted);text-decoration:line-through}.new{color:var(--text)}.arrow{color:var(--muted)}
  .pill{font-size:11px;padding:3px 9px;border-radius:6px}
  .pill-ok{background:var(--ok-bg);color:var(--ok-fg)}
  .bar{display:inline-block;width:80px;height:6px;border-radius:3px;background:var(--surface);overflow:hidden;vertical-align:middle;margin-right:6px}
  .bar-fill{height:100%}
  .score{font-size:12px;color:var(--muted)}
  footer{margin-top:24px;color:var(--muted);font-size:12px}
</style></head><body>
  <h1>${esc(title)}</h1>
  <div class="sub">${s.total} heals · ${s.uniqueLocators} unique locators · generated ${fmtTime(Date.now())}</div>
  <div class="cards">
    <div class="metric"><div class="label">Healed</div><div class="num" style="color:var(--ok-fg)">${s.total}</div></div>
    <div class="metric"><div class="label">Unique locators</div><div class="num">${s.uniqueLocators}</div></div>
    <div class="metric"><div class="label">Avg confidence</div><div class="num">${s.avgScore.toFixed(2)}</div></div>
    <div class="metric"><div class="label">Avg heal time</div><div class="num">${Math.round(s.avgLatencyMs)}<span style="font-size:13px;color:var(--muted)"> ms</span></div></div>
  </div>
  <div class="chips">${viaChips}</div>
  <table>
    <thead><tr><th>Status</th><th>Locator</th><th>Via</th><th>Confidence</th><th>Mode</th><th>Time</th><th>When</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">No heals recorded.</td></tr>'}</tbody>
  </table>
  <footer>Generated by @vijaypjavvadi/pw-self-heal · in-process locator self-healing</footer>
</body></html>`;
}
