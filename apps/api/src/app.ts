import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import { applyErrorHandling } from "./plugins/error-handler";
import { healthRoutes } from "./routes/health";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function buildApp(config: AppConfig): FastifyInstance {
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

  app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  app.register(cors, { credentials: true, origin: config.corsOrigins });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  app.register(fastifyStatic, { root: uploadsRoot, prefix: "/static/" });
  app.register(jwt, { secret: config.jwtSecret });
  app.register(healthRoutes);

  return app;
}
