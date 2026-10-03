import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb, createSqlite } from "./db/client";
import { runMigrations } from "./db/migrate";
import { upsertOAuthClient } from "./oauth/oauthService";

const localEnvPath = resolve(".env");
if (existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: false });
}

const config = loadConfig();
const sqlite = createSqlite(config.databasePath);
const db = createDb(sqlite);
runMigrations(db);
// Replace the migration-seeded dev secret hash with the deploy secret from
// `.env` (T50): only the sha256 hash is ever persisted.
upsertOAuthClient(db, config.oauthClientId, config.oauthClientSecret);
const app = buildApp(config, { db });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = (signal: NodeJS.Signals): void => {
  app.log.info({ signal }, "shutting down");
  void app
    .close()
    .catch(() => {})
    .finally(() => {
      sqlite.close();
      process.exit(0);
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
