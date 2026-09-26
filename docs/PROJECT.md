# Grocery List — Project Spec

## Vision
A lightweight self-hosted grocery list web app + REST API.
Hosted on Synology DS223j (ARM64, **1 GB RAM**) via Docker Compose.
Exposed to the internet via Cloudflare Tunnel (no router port forwarding).
REST API is consumable by both the UI and AI agents (scoped API tokens).

All development happens **on the laptop**; images are built locally (no CI/CD).

## Hardware reality (Synology DS223j)
- CPU: Realtek RTD1619B, 4× Cortex-A55 @ 1.7 GHz (ARM64)
- RAM: **1 GB DDR4** (shared with DSM; DSM itself consumes ~400 MB)
- Consequence: **no database server**. SQLite runs in-process via `better-sqlite3` (< 5 MB RSS).
  Total container budget: **< 150 MB RSS** for all three containers.

## Stack summary
| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + HeadlessUI |
| State/data | TanStack Query v5 + Zustand (access token in memory) |
| Charting | `uplot` (~10 KB) for price history |
| Backend | Node.js 20 + Fastify + TypeScript |
| ORM | **Drizzle ORM** (lightweight, type-safe) |
| DB | **SQLite** file via `better-sqlite3` (WAL mode) |
| Auth | bcrypt + JWT access (15 min) + refresh cookie (30 d, rotated) + API tokens for agents |
| Tunnel | Cloudflare Tunnels (`cloudflared`) |
| Containers | Docker Compose: `api`, `web`, `tunnel` |

## UX (must mirror "Buy Me a Pie")
- Single primary screen: a list of items.
  - Top: items "to buy", sorted by manual order (drag-and-drop), then add-date.
  - Bottom: items "bought" (most recent first).
- Each row:
  - Left vertical color bar (item's category color).
  - Title.
  - Optional quantity text (e.g., "2x", "500g").
  - Small badge: days since added ("3d").
  - Drag handle (≡) on the right of "to buy" rows.
- Bottom of screen: input box with live grouped suggestions (by category, colored bars).
- Long-press (mobile) / right-click (desktop) on a row → item details.
- Multiple lists, switchable via top tabs.

## Item Detail View
- Edit title.
- Edit category (dropdown).
- Upload / replace image (preview; resized server-side to 600 px webp).
- Add current price + shop (appends a price observation).
- Price history chart (line: dates on X, price on Y; each point shows price + shop).

## Categories
- Per list.
- Editable title + color.
- View all items in a category.
- Every list gets a default **"Other"** category (fallback for `smart-add`).

## Lists
- Title.
- Members with roles: OWNER, EDITOR, VIEWER.
- Only OWNER can manage members and delete the list.

## Auth
- Email + password (bcrypt).
- JWT access token (15 min, kept in memory) + refresh token (30 d, `HttpOnly`, `Secure`,
  `SameSite=Strict` cookie, **rotated on every refresh**, hash stored in DB).
- Separate long-lived API tokens (prefix `glc_`) for AI agents; stored sha256-hashed.
- Admin role manages users. The seeded first user is admin.

## Mobile & UX Constraints
- Mobile-first: Android/iOS touch first, desktop second. Touch targets > 40 px.
- PWA: installable via "Add to Home Screen" (`vite-plugin-pwa`).
- Persistent auth: the user logs in **once**. Access token lives in memory (Zustand);
  refresh token in HttpOnly cookie; silent refresh on app open. No re-login on iOS Safari.
- Drag & Drop: manual reordering of "to buy" items via `@dnd-kit/core` + `@dnd-kit/sortable`
  (TouchSensor: 150 ms activation delay, 5 px tolerance). Dragging is allowed **only** via the
  ≡ handle; long-press (500 ms) on the row body opens details. Never both.
- New order persists via `POST /lists/:id/items/reorder` and syncs across devices.

## Non-functional
- Total RAM (all containers): < 150 MB.
- Cold start < 5 s. UI load < 1 s on LAN.
- No external cloud services except Cloudflare Tunnel.
- All source TypeScript, strict mode.
- No CI/CD: images are built locally on the laptop and transferred to the NAS.
