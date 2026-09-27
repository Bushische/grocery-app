import { createHash } from "node:crypto";
import { readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_IMAGE_DIMENSION } from "@grocery/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { items } from "../db/schema";
import { FastifyHttpError } from "../errors";

const itemNotFound = (itemId: string) =>
  new FastifyHttpError(404, "NOT_FOUND", `Item ${itemId} not found`);

/**
 * `POST /items/:id/image` (docs/TASKS.md → T10): resizes the upload to fit
 * within 600 px (auto-oriented from EXIF, never enlarged), encodes it as webp,
 * names the file `<itemId>-<sha256(output)>.webp` — content-addressed, so a
 * re-upload yields a new URL and the T4.5 immutable cache headers stay safe —
 * writes it under the uploads root and records it on the item. Superseded
 * files of the same item are removed (their URLs are no longer referenced).
 */
export async function saveItemImage(
  db: Db,
  itemId: string,
  uploadsRoot: string,
  bytes: Buffer,
): Promise<string> {
  // Lazy import: sharp (native, ~30 MB RSS) is only paid when an image is
  // actually uploaded — boot memory stays at the T4 baseline.
  const sharp = (await import("sharp")).default;
  let output: Buffer;
  try {
    output = await sharp(bytes)
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer();
  } catch {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", "Uploaded file is not a valid image");
  }

  const hash = createHash("sha256").update(output).digest("hex");
  const filename = `${itemId}-${hash}.webp`;
  writeFileSync(join(uploadsRoot, filename), output);

  const result = db
    .update(items)
    .set({ imageFilename: filename })
    .where(eq(items.id, itemId))
    .run();
  if (result.changes === 0) {
    // The item vanished between the role check and the write — don't leave the
    // file behind.
    try {
      unlinkSync(join(uploadsRoot, filename));
    } catch {
      // best effort
    }
    throw itemNotFound(itemId);
  }

  const prefix = `${itemId}-`;
  for (const entry of readdirSync(uploadsRoot)) {
    if (entry !== filename && entry.startsWith(prefix) && entry.endsWith(".webp")) {
      try {
        unlinkSync(join(uploadsRoot, entry));
      } catch {
        // best effort — a leftover file only wastes disk, it is never served
      }
    }
  }

  return filename;
}
