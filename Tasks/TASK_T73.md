# T73 — BotFather command names: grocery_lists + use_list
- **Goal:** The bot understands the renamed commands (`/grocery_lists`, `/use_list Dacha`).
- **Inputs:** T69/T72 (command parsing + stripping), user's BotFather list.
- **Outputs:** `grocery_lists` alias of `lists`, `use_list <name>` alias of `use` (old names keep working); help/need_choice/miss texts point at the new names; bare `/grocery_lists` survives stripping; docs + setcommands updated.
- **Definition of Done:** `/grocery_lists` lists with ●/🔒, `/use_list <name>` switches, old `/lists`+`/use` still work; full gate green.
- **Dependencies:** T72.
