import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import { type Db, createDb, createSqlite } from "./db/client";
import { registerAuth } from "./plugins/auth";
import { registerDb } from "./plugins/db";
import { applyErrorHandling } from "./plugins/error-handler";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type AppDependencies = { db?: Db };

export function buildApp(config: AppConfig, dependencies: AppDependencies = {}): FastifyInstance {
  const uploadsRoot = resolve(config.uploadsPath);
  mkdirSync(uploadsRoot, { recursive: true });

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie"] },
    },
    trustProxy: true,
  });

  applyErrorHandling(app);

  // The in-memory default keeps the app self-contained for tests; index.ts
  // injects the real on-disk database.
  registerDb(app, dependencies.db ?? createDb(createSqlite(":memory:")));

  app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  app.register(cors, { credentials: true, origin: config.corsOrigins });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  app.register(fastifyStatic, { root: uploadsRoot, prefix: "/static/" });
  registerAuth(app, config.jwtSecret);
  app.register(healthRoutes);
  app.register(authRoutes);

  return app;
}
