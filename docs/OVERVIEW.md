# Grocery List — What It Can Do

Family grocery lists, self-hosted on your Synology NAS, usable from the web,
Yandex Alice, and Telegram. One shared backend, three ways in.

## Lists and items

- **Multiple lists** (Home, Dacha, …) with colored **categories**; items carry
  quantities (`2x`, `500g`), photos, and prices.
- **Fast capture:** type-ahead suggestions from what you bought before,
  smart re-activation (re-adding a bought item revives it instead of
  duplicating), quantities parsed from text (`2 milk`).
- **Bought flow:** tap a row to mark bought (it jumps to the top of Bought),
  tap again to return it. Drag rows with the ≡ handle to reorder.
- **Details per item:** edit title/quantity/category, attach a photo,
  record prices per shop, see the price history chart.
- **Search** across your lists.

## Sharing and roles

- Invite family by email with a role: **viewer** (read-only), **editor**
  (groceries), **owner** (members + settings). Everything permission-checked.
- **Admins** manage users; **API tokens** (`glc_…`) let AI agents work the
  same API the app uses.

## Three ways to use it

- **Web app + PWA:** mobile-first, installable on Android/iOS, offline shell,
  stays logged in.
- **Yandex Alice:** voice control on the bound list — add, list, mark bought,
  return; fuzzy name matching so «молоко» finds Milk.
- **Telegram:** the same app inside Telegram (one-time link, then passwordless
  open) **plus** a chat bot: `/buy milk, bread`, `/list`, `/bought milk`,
  `/unbuy milk` in private or groups (privacy-ON); `/grocery_lists` shows
  lists, `/use_list Dacha` or a tap sets the chat's remembered list, so the
  next bare `/buy` just lands.

## Running it

- ARM64 Docker images built on the laptop, no registry, no open ports
  (Cloudflare Tunnel → HTTPS). SQLite + photos on NAS volumes.
- **Backups:** daily consistent DB snapshots + weekly photo archives, with a
  tested restore drill. Migrations apply automatically on upgrade.

## On the roadmap (specced, pending)

- Nicely formatted bot replies; category-grouped drag-and-drop (whole-group
  moves) in TO BUY and BOUGHT; swipe-left Edit / swipe-right Delete on rows;
  📸 badge on rows with photos; shorter Alice answers with paged readout
  (5 at a time, newest first); last-5 bought dates and prices on the item card.
