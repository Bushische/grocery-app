import { useCallback, useRef } from "react";

/**
 * Long-press (500 ms, mobile) for the row body (docs/PROJECT.md → Mobile & UX
 * Constraints). The timer is canceled on movement (> 10 px), scroll, or release,
 * so it never fights scrolling or drag-and-drop. Mouse users get details via
 * right-click instead (also on the row body).
 *
 * The hook also tracks whether the active press moved beyond the tap threshold:
 * `movedSinceDown` lets the row suppress a tap action (toggle) for gestures that
 * were a scroll, not a tap — even on browsers that still fire click after a
 * scroll (older mobile WebViews).
 */
export function useLongPress(onLongPress: () => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const movedSinceDown = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    startPoint.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      movedSinceDown.current = false;
      startPoint.current = { x: event.clientX, y: event.clientY };
      if (!enabled || event.pointerType === "mouse") return;
      timer.current = setTimeout(() => {
        timer.current = null;
        onLongPress();
      }, 500);
    },
    [enabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = startPoint.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        movedSinceDown.current = true;
        clear();
      }
    },
    [clear],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    movedSinceDown,
  };
}
