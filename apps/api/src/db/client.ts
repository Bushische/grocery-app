import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import * as schema from "./schema";

const databasePathSchema = z.string().min(1);

const envSchema = z.object({
  DATABASE_PATH: databasePathSchema.default("data/grocery.db"),
});

export type SqliteDatabase = Database.Database;
export type Db = BetterSQLite3Database<typeof schema>;

export function createSqlite(databasePath?: string): SqliteDatabase {
  const path = databasePath ?? envSchema.parse(process.env).DATABASE_PATH;
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const sqlite = new Database(path);
  // Pragmas per docs/ARCHITECTURE.md — set once, here.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  return sqlite;
}

export function createDb(sqlite?: SqliteDatabase): Db {
  return drizzle(sqlite ?? createSqlite(), { schema });
}
