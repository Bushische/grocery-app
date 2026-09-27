import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

/** Makes the Drizzle db available to routes/services via `app.db`. */
export function registerDb(app: FastifyInstance, db: Db): void {
  app.decorate("db", db);
}
