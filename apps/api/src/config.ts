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
  OAUTH_CLIENT_ID: z.string().min(1).default("alice"),
  OAUTH_CLIENT_SECRET: z.string().min(1).default("alice-dev-secret-change-me"),
  ALICE_SKILL_ID: z.string().min(1).default("alice-dev-skill"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_MINI_APP_URL: z.string().default(""),
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
  oauthClientId: string;
  oauthClientSecret: string;
  aliceSkillId: string;
  telegramBotToken: string;
  telegramAuthMaxAgeSeconds: number;
  telegramWebhookSecret: string;
  telegramMiniAppUrl: string;
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
  if (parsed.NODE_ENV === "production" && (!corsOrigins || corsOrigins.length === 0)) {
    throw new Error(
      "CORS_ORIGIN must be set in production (comma-separated origin allowlist, see .env.prod.example): with credentials: true an unset CORS_ORIGIN would reflect any origin",
    );
  }
  if (parsed.NODE_ENV === "production" && parsed.TELEGRAM_BOT_TOKEN.trim() === "") {
    throw new Error("TELEGRAM_BOT_TOKEN must be set in production (see .env.example)");
  }
  if (parsed.NODE_ENV === "production" && parsed.TELEGRAM_WEBHOOK_SECRET.trim() === "") {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be set in production (see .env.example)");
  }
  if (parsed.NODE_ENV === "production" && parsed.TELEGRAM_MINI_APP_URL.trim() === "") {
    throw new Error("TELEGRAM_MINI_APP_URL must be set in production (see .env.example)");
  }
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
    oauthClientId: parsed.OAUTH_CLIENT_ID,
    oauthClientSecret: parsed.OAUTH_CLIENT_SECRET,
    aliceSkillId: parsed.ALICE_SKILL_ID,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramAuthMaxAgeSeconds: parsed.TELEGRAM_AUTH_MAX_AGE_SECONDS,
    telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    telegramMiniAppUrl: parsed.TELEGRAM_MINI_APP_URL,
  };
}
