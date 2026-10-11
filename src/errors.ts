/**
 * Error classification for self-healing.
 *
 * Shared by both healing paths (string-selector in heal.ts and locator-first in
 * locator.ts). Lives in its own module so heal.ts and locator.ts can both import
 * it without creating an import cycle (heal.ts already imports from locator.ts).
 *
 * Precedence (highest first — the FIRST matching class wins):
 *   1. STALE / CONTEXT-RESTART — the execution context, page, frame, or element
 *      was torn down out from under the action: a navigation destroyed the
 *      execution context, the page crashed or closed, the browser context
 *      restarted, a frame detached, or the element went stale (detached from the
 *      DOM). Checked FIRST on purpose: several of these messages ("Target
 *      closed", "element is not attached…") overlap with retryable phrasing, yet
 *      a dead context is never merely "retry in a moment". A cached heal bound to
 *      the old context must be INVALIDATED and the action re-resolved on the LIVE
 *      page, and a heal must never be fabricated against a destroyed context.
 *   2. HEALABLE — the locator resolved to zero elements (the classic heal trigger).
 *   3. RETRYABLE — the element exists but is not actionable YET (not visible,
 *      covered by another element, disabled, off-screen, mid-navigation).
 *   4. FATAL — a real defect; never swallowed.
 */
export type ErrorClass = 'stale' | 'healable' | 'retryable' | 'fatal';

/**
 * Stale / context-restart signatures. Matched case-INSENSITIVELY because
 * Playwright varies the capitalisation of these across versions and surfaces
 * (e.g. "Target closed" vs "target closed", "Element is not attached to the
 * DOM" vs lower-case). Mirrors the messages Playwright throws when the context
 * is gone.
 */
const STALE_PATTERNS = [
  'execution context was destroyed',
  'target closed',
  'target page, context or browser has been closed',
  'target crashed',
  'navigation failed because page was closed',
  'frame was detached',
  'element is not attached to the dom',
];

const HEALABLE_PATTERNS = [
  'waiting for locator',
  'No element matches',
  'resolved to 0 elements',
  'no matching selector',
  'failed to find element',
];

const RETRYABLE_PATTERNS = [
  'not visible',
  'intercepts pointer events',
  'is not enabled',
  'is outside of the viewport',
  'navigating',
];

export function classifyError(err: unknown): ErrorClass {
  const msg = (err as Error)?.message ?? '';
  const lower = msg.toLowerCase();
  // Stale/context-restart is checked FIRST — see the precedence note above.
  for (const p of STALE_PATTERNS) if (lower.includes(p)) return 'stale';
  for (const p of HEALABLE_PATTERNS) if (msg.includes(p)) return 'healable';
  for (const p of RETRYABLE_PATTERNS) if (msg.includes(p)) return 'retryable';
  return 'fatal';
}

/** True when the error means the page / context / frame / element was torn down. */
export function isStaleError(err: unknown): boolean {
  return classifyError(err) === 'stale';
}
