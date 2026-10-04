# T81 — Recognize "need to buy / нужно купить" as add (bare = list)
- **Goal:** `need to buy: mellon, marakuya` adds both instead of JEV misreading it as mark-bought.
- **Inputs:** T63 (`parseTelegramIntent`), T66 (JEV criteria), live report (`need to buy:` → JEV `buy` verdict → single fuzzy hit on the bought melon, rest ignored).
- **Outputs:** Telegram verb mapping: `need to buy[:]? <rest>` / `нужно купить[:]? <rest>` → add flow (comma split downstream), bare phrase → list intent; JEV `add` criteria names both phrases (belt-and-braces — deterministic hits never reach JEV).
- **Definition of Done:** `need to buy: a, b` → add intent with both names; bare `need to buy` → list; RU mirrors; end-to-end multi-add green; full gate green.
- **Dependencies:** T80.
