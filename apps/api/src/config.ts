import { z } from "zod";

const DEV_JWT_SECRET = "dev-only-insecure-secret";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  DATABASE_PATH: z.string().min(1).default("data/grocery.db"),
  UPLOADS_PATH: z.string().min(1).default("data/images"),
  CORS_ORIGIN: z
    .string()
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
});

export type LogLevel = z.infer<typeof envSchema>["LOG_LEVEL"];

export type AppConfig = {
  env: z.infer<typeof envSchema>["NODE_ENV"];
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: LogLevel;
  jwtSecret: string;
  databasePath: string;
  uploadsPath: string;
  corsOrigins: string[] | true;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === "production" && parsed.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error("JWT_SECRET must be set in production (see .env.example)");
  }
  const corsOrigins =
    parsed.CORS_ORIGIN === undefined
      ? undefined
      : parsed.CORS_ORIGIN.split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
  return {
    env: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === "production",
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    jwtSecret: parsed.JWT_SECRET,
    databasePath: parsed.DATABASE_PATH,
    uploadsPath: parsed.UPLOADS_PATH,
    corsOrigins: !corsOrigins || corsOrigins.length === 0 ? true : corsOrigins,
  };
}
