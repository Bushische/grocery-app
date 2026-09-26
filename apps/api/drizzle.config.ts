import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_PATH ?? "data/grocery.db";
if (url !== ":memory:") {
  mkdirSync(dirname(resolve(url)), { recursive: true });
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
