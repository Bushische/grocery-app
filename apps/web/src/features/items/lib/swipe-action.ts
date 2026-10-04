/**
 * Touch swipe-to-action mapping for item rows (T76).
 *
 * Pure, so the gesture disambiguation can be unit-tested without jsdom layout
 * (same pattern as `reorderedIdsAfterDrag`): the row body calls this on every
 * touch pointermove with the press delta.
 *
 * - Horizontal intent wins past `threshold` (default 40 px).
 * - Vertical scroll never reveals: when |dy| dominates |dx| the result is null
 *   so the browser scroll proceeds untouched.
 * - Swipe left (dx negative) reveals Edit; swipe right (dx positive) reveals
 *   Delete. Small drifts below the threshold reveal nothing.
 */
export const SWIPE_REVEAL_THRESHOLD = 40;

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
