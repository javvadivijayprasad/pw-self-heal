/**
 * Faithful port of Python's `difflib.SequenceMatcher.ratio()`
 * (Ratcliff/Obershelp). The trained ranking model and the heuristic scorer were
 * fit against difflib semantics, so string-similarity features MUST match
 * Python byte-for-byte. Autojunk is irrelevant here (it only engages for
 * sequences >= 200 chars; locator strings are short), so it is omitted.
 */

function buildB2J(b: string): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    const arr = b2j.get(ch);
    if (arr) arr.push(j);
    else b2j.set(ch, [j]);
  }
  return b2j;
}

function findLongestMatch(
  a: string,
  b2j: Map<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): [number, number, number] {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();

  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const indices = b2j.get(a[i]);
    if (indices) {
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = newj2len;
  }
  return [besti, bestj, bestsize];
}

/** Total size of all matching blocks between `a` and `b`. */
function matchingBlocksSize(a: string, b: string): number {
  const b2j = buildB2J(b);
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  let total = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(a, b2j, alo, ahi, blo, bhi);
    if (k > 0) {
      total += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return total;
}

/** `SequenceMatcher(None, a, b).ratio()` — 2*M / (len(a)+len(b)). */
export function ratio(a: string, b: string): number {
  const len = a.length + b.length;
  if (len === 0) return 1.0;
  return (2.0 * matchingBlocksSize(a, b)) / len;
}
