# T85 — Swipe-delete asks confirmation (no instant delete)
- **Goal:** A far right-slide arms deletion; a second explicit tap confirms it.
- **Inputs:** T84 (`item-row.tsx` far-release deletes, `delete-i1` tap deletes).
- **Outputs:** Far-slide release reveals an armed red state (`Tap to confirm delete` + Cancel) instead of deleting; tapping Delete (revealed or armed) arms rather than deletes; only the confirm tap issues DELETE (403 + rollback path unchanged); tapping the row body or Cancel disarms; short swipes still snap back.
- **Definition of Done:** Pins: far-release arms without DELETE, confirm tap deletes, cancel/body-tap disarms, revealed-tap arms, 403 banner + row stays; mouse suite unchanged; full gate green.
- **Dependencies:** T84.
