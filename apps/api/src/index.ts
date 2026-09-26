import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { buildApp } from "./app";
import { loadConfig } from "./config";

const localEnvPath = resolve(".env");
if (existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: false });
}

const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = (signal: NodeJS.Signals): void => {
  app.log.info({ signal }, "shutting down");
  void app.close().finally(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
