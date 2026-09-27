/**
 * Pure-TS text similarity helpers for smart-add / suggest
 * (docs/DATA_MODEL.md → Notes: SQLite LIKE prefilter + a small pure-TS
 * similarity score — Sørensen–Dice over character bigrams, no extensions).
 */

/** Unique character bigrams of the lowercased input (Sørensen–Dice tokens). */
export function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    result.add(normalized.slice(i, i + 2));
  }
  return result;
}

/**
 * Sørensen–Dice coefficient over the bigrams of the lowercased inputs:
 * 1 for identical strings, 0 when neither shares any bigram. docs/API.md
 * smart-add step 3 matches candidates at ≥ 0.6.
 */
export function diceCoefficient(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 && right.size === 0) {
    return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      shared++;
    }
  }
  return (2 * shared) / (left.size + right.size);
}

/**
 * Escapes SQL LIKE wildcards so user text matches literally.
 * Pair with `ESCAPE '\'` in the query (docs/API.md → smart-add step 2).
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
