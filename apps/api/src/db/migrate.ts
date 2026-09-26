import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Applies pending SQL migrations from apps/api/drizzle (safe to call repeatedly). */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
