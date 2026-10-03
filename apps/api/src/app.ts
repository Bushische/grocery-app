import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { MAX_IMAGE_UPLOAD_BYTES } from "@grocery/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { aliceWebhookRoutes } from "./alice/webhook";
import type { AppConfig } from "./config";
import { type Db, createDb, createSqlite } from "./db/client";
import { oauthRoutes } from "./oauth/routes";
import { registerAuth } from "./plugins/auth";
import { registerDb } from "./plugins/db";
import { applyErrorHandling } from "./plugins/error-handler";
import { apiTokenRoutes } from "./routes/api-tokens";
import { authRoutes } from "./routes/auth";
import { categoryRoutes } from "./routes/categories";
import { healthRoutes } from "./routes/health";
import { itemRoutes } from "./routes/items";
import { listRoutes } from "./routes/lists";
import { priceRoutes } from "./routes/prices";
import { searchRoutes } from "./routes/search";
import { userRoutes } from "./routes/users";
import { botWebhookRoutes } from "./telegram/botWebhook";
import { telegramRoutes } from "./telegram/routes";
import { checkUploadsWritable } from "./uploads-probe";

export type AppDependencies = { db?: Db };

/** The uploads directory, decorated onto the instance for image writes (T10). */
declare module "fastify" {
  interface FastifyInstance {
    uploadsRoot: string;
  }
}

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

  app.decorate("uploadsRoot", uploadsRoot);

  // T38: fail fast on a non-writable uploads volume (e.g. a named volume that
  // pre-dates the non-root app user stays root-owned forever) instead of
  // surfacing an opaque 500 on the first image upload.
  checkUploadsWritable(uploadsRoot, { isProduction: config.isProduction, log: app.log });

  app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  app.register(cors, { credentials: true, origin: config.corsOrigins });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } });
  // T4.5: images are content-addressed (T10: `<id>-<hash>.webp`), so bytes at a
  // URL never change — cache them forever; a re-upload changes the URL instead.
  // The default ETag stays enabled as a fallback for non-immutable use.
  app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/static/",
    setHeaders: (reply) => {
      reply.header("cache-control", "public, max-age=31536000, immutable");
    },
  });
  registerAuth(app, config.jwtSecret);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(oauthRoutes);
  app.register(userRoutes);
  app.register(apiTokenRoutes);
  app.register(listRoutes);
  app.register(categoryRoutes);
  app.register(itemRoutes);
  app.register(priceRoutes);
  app.register(searchRoutes);
  app.register(aliceWebhookRoutes, { skillId: config.aliceSkillId });
  app.register(telegramRoutes, {
    botToken: config.telegramBotToken,
    maxAgeSeconds: config.telegramAuthMaxAgeSeconds,
  });
  app.register(botWebhookRoutes, {
    botToken: config.telegramBotToken,
    webhookSecret: config.telegramWebhookSecret,
    miniAppUrl: config.telegramMiniAppUrl,
  });

  return app;
}
