import type {
  CreatePriceObservationRequest,
  PriceObservation,
  PricesResponse,
} from "@grocery/shared";
import { DEFAULT_PAGE_LIMIT } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { items, priceObservations } from "../db/schema";
import { FastifyHttpError } from "../errors";

/**
 * SQLite rowid — breaks ties between observations sharing one `observedAt`
 * second (the schema's timestamp granularity): the later insert wins, so
 * "current price = latest observation" stays deterministic.
 */
const rowid = sql<number>`rowid`;

/** Joined shape for price reads: the observation columns plus the rowid tiebreaker. */
const priceRowSelection = {
  priceCents: priceObservations.priceCents,
  shop: priceObservations.shop,
  observedAt: priceObservations.observedAt,
  rowid,
};

/** Observation columns as stored; `rowid` is only needed for ordering/tiebreaks. */
type PriceColumns = {
  priceCents: number;
  shop: string;
  observedAt: Date;
};

type PriceRow = PriceColumns & { rowid: number };

/** Converts integer cents to the decimal-number DTO (docs/API.md → Conventions). */
function toPriceDto(row: PriceColumns): PriceObservation {
  return {
    price: row.priceCents / 100,
    shop: row.shop,
    observedAt: row.observedAt.toISOString(),
  };
}

const itemNotFound = (itemId: string) =>
  new FastifyHttpError(404, "NOT_FOUND", `Item ${itemId} not found`);

const cursorPayloadSchema = z.tuple([z.iso.datetime(), z.number().int().min(0)]);

function decodeCursor(cursor: string): { observedAt: Date; rowid: number } {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", "Invalid cursor");
  }
  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", "Invalid cursor");
  }
  return { observedAt: new Date(parsed.data[0]), rowid: parsed.data[1] };
}

function encodeCursor(row: PriceRow): string {
  return Buffer.from(JSON.stringify([row.observedAt.toISOString(), row.rowid])).toString(
    "base64url",
  );
}

/** Keyset condition "older than the cursor": strictly older second, or same second and lower rowid. */
function olderThanCursor(cursor: { observedAt: Date; rowid: number }) {
  const unixSeconds = Math.floor(cursor.observedAt.getTime() / 1000);
  return or(
    sql`${priceObservations.observedAt} < ${unixSeconds}`,
    and(eq(priceObservations.observedAt, cursor.observedAt), sql`rowid < ${cursor.rowid}`),
  );
}

/**
 * `POST /items/:id/prices` (docs/API.md → Prices): appends one observation;
 * the price is stored as integer cents, `observedAt` defaults to server time.
 */
export function createPriceObservation(
  db: Db,
  itemId: string,
  request: CreatePriceObservationRequest,
  now: Date = new Date(),
): PriceObservation {
  const item = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get();
  if (!item) {
    throw itemNotFound(itemId);
  }
  const row = db
    .insert(priceObservations)
    .values({
      id: createId(),
      itemId,
      priceCents: Math.round(request.price * 100),
      shop: request.shop,
      observedAt: request.observedAt ? new Date(request.observedAt) : now,
    })
    .returning()
    .get();
  return toPriceDto(row);
}

/**
 * Full price history of an item, newest first (docs/API.md → GET /items/:id
 * exposes `prices` in this order).
 */
export function listAllPriceObservations(db: Db, itemId: string): PriceObservation[] {
  return db
    .select(priceRowSelection)
    .from(priceObservations)
    .where(eq(priceObservations.itemId, itemId))
    .orderBy(desc(priceObservations.observedAt), desc(rowid))
    .all()
    .map(toPriceDto);
}

/**
 * `GET /items/:id/prices?cursor=&limit=` (docs/API.md → Prices): newest first,
 * keyset pagination on (observedAt, rowid); `nextCursor` null on the last page.
 */
export function listPriceObservations(
  db: Db,
  itemId: string,
  pagination: { cursor?: string; limit?: number } = {},
): PricesResponse {
  const limit = pagination.limit ?? DEFAULT_PAGE_LIMIT;
  const cursor = pagination.cursor ? decodeCursor(pagination.cursor) : undefined;
  const rows = db
    .select(priceRowSelection)
    .from(priceObservations)
    .where(and(eq(priceObservations.itemId, itemId), cursor ? olderThanCursor(cursor) : undefined))
    .orderBy(desc(priceObservations.observedAt), desc(rowid))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    observations: page.map(toPriceDto),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/**
 * Latest observation per item — the derived current price (docs/DATA_MODEL.md
 * → Notes: no duplicated column, one source of truth). Ties on `observedAt`
 * are broken by insertion order (rowid): the later insert wins.
 */
export function currentPricesByItem(db: Db, itemIds: string[]): Map<string, PriceObservation> {
  const latest = new Map<string, PriceObservation>();
  if (itemIds.length === 0) {
    return latest;
  }
  const rows = db
    .select({ itemId: priceObservations.itemId, ...priceRowSelection })
    .from(priceObservations)
    .where(inArray(priceObservations.itemId, itemIds))
    .all();
  const latestRows = new Map<string, PriceRow>();
  for (const row of rows) {
    const incumbent = latestRows.get(row.itemId);
    const newerThan =
      incumbent === undefined
        ? true
        : row.observedAt.getTime() > incumbent.observedAt.getTime() ||
          (row.observedAt.getTime() === incumbent.observedAt.getTime() &&
            row.rowid > incumbent.rowid);
    if (newerThan) {
      latestRows.set(row.itemId, row);
    }
  }
  for (const [itemId, row] of latestRows) {
    latest.set(itemId, toPriceDto(row));
  }
  return latest;
}

/** Current price of a single item, or null when it has no observations. */
export function currentPriceOf(db: Db, itemId: string): PriceObservation | null {
  return currentPricesByItem(db, [itemId]).get(itemId) ?? null;
}
