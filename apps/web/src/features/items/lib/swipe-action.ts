/**
 * Touch swipe-to-action mapping for item rows (T76, reworked T84).
 *
 * Pure, so the gesture disambiguation can be unit-tested without jsdom layout
 * (same pattern as `reorderedIdsAfterDrag`): the row body calls this on every
 * touch pointermove with the press delta.
 *
 * - Horizontal intent wins past `threshold` (default 40 px) → reveal.
 * - A second, width-relative commit line (~2/3 of the row width) arms the
 *   release-to-commit: releasing a revealed row past it runs the action,
 *   shorter swipes snap back and leave tappable buttons.
 * - Vertical scroll never reveals: when |dy| dominates |dx| the result is null
 *   so the browser scroll proceeds untouched (row body is `touch-action:
 *   pan-y`, which is what delivers horizontal moves to Android Chrome).
 * - Swipe left (dx negative) reveals Edit; swipe right (dx positive) reveals
 *   Delete. Small drifts below the threshold reveal nothing.
 */
export const SWIPE_REVEAL_THRESHOLD = 40;

/** Fraction of the row width past which a revealed swipe commits on release. */
export const SWIPE_COMMIT_FRACTION = 2 / 3;

/** Row width fallback where layout is unavailable (jsdom tests report 0). */
export const SWIPE_WIDTH_FALLBACK_PX = 360;

export type SwipeReveal = "edit" | "delete" | null;

export function swipeRevealForDelta(
  dx: number,
  dy: number,
  threshold: number = SWIPE_REVEAL_THRESHOLD,
): SwipeReveal {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (!Number.isFinite(threshold)) return null;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dy) > Math.abs(dx)) return null;
  return dx < 0 ? "edit" : "delete";
}

/** True when a revealed swipe passed the commit line (release runs it). */
export function swipeCommitForDelta(dx: number, width: number): boolean {
  if (!Number.isFinite(dx)) return false;
  const measured = width > 0 ? width : SWIPE_WIDTH_FALLBACK_PX;
  return Math.abs(dx) >= measured * SWIPE_COMMIT_FRACTION;
}
