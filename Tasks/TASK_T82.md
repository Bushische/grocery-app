# T82 — Generic unknown-phrasing route: modal prefixes + JEV arbitration
- **Goal:** Whatever the phrasing (`надо купить`, `хочу…`, `I need…`), the bot acts without a per-phrase keyword.
- **Inputs:** T63/T81 (verb mapping), T66 (extractor seam), live gaps (mid-sentence `купить` misparsed as mark-bought, blocking JEV).
- **Outputs:** One modal-prefix rule (modal + infinitive stripped → add products; bare → list) replacing the T81 special-case; deterministic confidence (leading-verb = firm, mid-sentence buy/unbuy = weak); weak parses go to JEV when configured — a confident disagreeing verdict wins, otherwise the deterministic intent runs; no extractor → today's behavior byte-for-byte.
- **Definition of Done:** Modal cases EN+RU parse to add (bare → list); mid-verb text calls the extractor (stub-pinned: disagree reroutes, unsure keeps deterministic); deterministic-only mode unchanged; full gate green.
- **Dependencies:** T81.
