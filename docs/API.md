# API Contract

The AI agent must follow these endpoints and payload shapes **verbatim**. Any change requires
updating `packages/shared` (zod schemas + DTO types) in the same task.

## Conventions
- Base path: `/api` (dev: `http://localhost:3000`; prod: same-origin via nginx).
- Auth: `Authorization: Bearer <accessToken>` (15-min JWT) **or** `Authorization: Bearer glc_…`
  (API token, for AI agents). Browser clients additionally hold the refresh token in an HttpOnly
  cookie (Path=`/api/auth`).
- Success: `2xx` with the resource JSON directly (no envelope).
- Error: proper HTTP status + `{ "error": { "code": "...", "message": "..." } }`.
  Codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
  `CONFLICT` 409.
- Dates: ISO 8601 UTC strings. Money: decimal numbers (`1.99`).
- Pagination: `?cursor=&limit=` (default 50, max 100) on paginated endpoints.
- All timestamps are server-generated; clients never send `createdAt`.

## Permissions (per list)
| Action | VIEWER | EDITOR | OWNER |
|---|---|---|---|
| Read lists/items/categories/prices | ✅ | ✅ | ✅ |
| Create/edit/move/reorder/delete items, add prices, upload images | ❌ | ✅ | ✅ |
| Create/edit categories | ❌ | ✅ | ✅ |
| Delete category, edit/delete list, manage members | ❌ | ❌ | ✅ |

API tokens act as the user who created them (their memberships apply).

---

## Health
```
GET /health
→ 200 { "status": "ok" }
```

## Auth
```
POST /auth/login
Request:  { "email": "alex@example.com", "password": "secret" }
Response: 200
  { "accessToken": "eyJ...", "user": { "id": "u1", "email": "alex@example.com", "role": "admin" } }
Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000

POST /auth/refresh        (cookie sent automatically by the browser)
Response: same shape as login; refresh token is ROTATED (old one revoked).

POST /auth/logout
Response: 204; cookie cleared, refresh token revoked.

GET /me
Response: 200 { "id": "u1", "email": "alex@example.com", "role": "admin" }
```

## Users (admin only)
```
GET    /users                → 200 [{ "id", "email", "role", "createdAt" }]
POST   /users                → 201 user
       Request: { "email": "mom@example.com", "password": "secret", "role": "user" }
DELETE /users/:id            → 204  (409 if the user owns lists)
```

## API tokens (for AI agents)
```
GET    /api-tokens           → 200 [{ "id", "name", "lastUsedAt", "createdAt" }]
POST   /api-tokens           → 201 { "id": "t1", "token": "glc_xxx..." }   // plaintext shown ONCE
       Request: { "name": "ai-agent" }
DELETE /api-tokens/:id       → 204
```

## Lists
```
GET  /lists
→ 200 [{ "id": "l1", "title": "Weekly", "role": "OWNER",
         "itemCounts": { "toBuy": 5, "bought": 2 } }]

POST /lists        { "title": "Weekly" }
→ 201 list; creator becomes OWNER; default category "Other" (#6B7280) is created automatically.

GET    /lists/:id  → 200 { "id", "title", "owner": { "id", "email" },
                             "members": [{ "userId", "email", "role" }] }
PATCH  /lists/:id  { "title": "…" }                     → 200 (OWNER)
DELETE /lists/:id                                      → 204 (OWNER)

POST   /lists/:id/members           { "email": "mom@example.com", "role": "EDITOR" } → 201 (OWNER)
PATCH  /lists/:id/members/:userId   { "role": "VIEWER" }                             → 200 (OWNER)
DELETE /lists/:id/members/:userId                                                  → 204 (OWNER)
```

## Categories
```
GET  /lists/:id/categories
→ 200 [{ "id": "c1", "title": "Dairy", "color": "#3B82F6", "sortOrder": 0, "itemCount": 4 }]

POST   /lists/:id/categories  { "title": "Dairy", "color": "#3B82F6" }   → 201 (EDITOR+)
PATCH  /categories/:id        { "title"?, "color"? }                     → 200 (EDITOR+)
DELETE /categories/:id                                                   → 204 (OWNER); 409 if items assigned
GET    /categories/:id/items  → 200 items in this category (any status)
```

## Items
```
GET /lists/:id/items?status=to_buy|bought
→ 200 { "items": [{
      "id": "i1", "title": "Milk", "qtyText": "2x", "status": "TO_BUY",
      "sortOrder": 0, "addedAt": "2026-09-27T08:00:00Z", "daysInList": 3,
      "category": { "id": "c1", "title": "Dairy", "color": "#3B82F6" },
      "imageFilename": null,
      "currentPrice": { "price": 1.99, "shop": "Tops", "observedAt": "2026-09-25T10:00:00Z" } | null
    }] }
Ordered by sortOrder ASC, addedAt ASC.

POST /lists/:id/items   { "title": "Milk", "categoryId": "c1"?, "qtyText": "2x"? }
→ 201 item (status TO_BUY, appended to the end: sortOrder = max+1).

POST /lists/:id/items/smart-add   { "text": "semi milk" }
→ 200 { "created": false, "matchedBy": "substring", "item": {…} }   // existing item moved back to TO_BUY
→ 201 { "created": true,  "matchedBy": "created",   "item": {…} }   // new item in "Other" category
Algorithm (T8):
  1. exact title match (case-insensitive)  → TO_BUY: unchanged (200) | BOUGHT: re-activate (200)
  2. substring match both ways (LIKE)      → rank by usageCount DESC, then shorter title diff
  3. fuzzy match (Dice ≥ 0.6)              → best candidate
  4. else create in default "Other" category (201)

GET    /items/:id   → 200 { …item, "prices": [{ "price", "shop", "observedAt" }] }  (newest first)
PATCH  /items/:id   { "title"?, "categoryId"?, "qtyText"? }   → 200 (EDITOR+)
DELETE /items/:id                                              → 204 (EDITOR+)

POST /items/:id/move   { "status": "bought" }                  → 200 item
  to bought: boughtAt = now, sortOrder = top (existing BOUGHT rows shift down, moved item takes 0).
  to to_buy: addedAt = now, boughtAt = null, usageCount+1, sortOrder = end.

POST /items/:id/image  (multipart, form field "image", < 2 MB)
→ 200 { "imageFilename": "i1.webp" }   // sharp-resized to 600 px webp, stored under /data/images

POST /lists/:id/items/reorder   { "status": "TO_BUY", "orderedIds": ["i3","i1","i2"] }
→ 204. Validates all ids belong to the list and status; assigns sortOrder = index in one transaction.
```

## Prices
```
POST /items/:id/prices   { "price": 1.99, "shop": "Tops", "observedAt": "2026-09-27T10:00:00Z"? }
→ 201 observation (validates price > 0; shop optional, may be empty "" = unknown)

GET /items/:id/prices?cursor=&limit=
→ 200 { "observations": [{ "price", "shop", "observedAt" }],
        "nextCursor": "…" | null }        // newest first
```

## Suggest & Search
```
GET /items/suggest?q=mi&listId=l1
→ 200 { "groups": [{ "category": { "id", "title", "color" },
                     "items": [{ "id", "title", "qtyText", "status" }] }] }
Matches items within the given list (LIKE prefilter + fuzzy score), ordered by usageCount DESC;
max 20 items. Used by the bottom input box.

GET /search?q=mil&listId=l1?
→ 200 { "results": [{ "itemId", "listId", "title", "status", "categoryColor" }] }
Free search across the user's lists (listId optional filter). Used by the UI and AI agents.
```
