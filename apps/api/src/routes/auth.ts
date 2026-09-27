import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TTL_SECONDS,
  authUserSchema,
  loginRequestSchema,
  loginResponseSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { FastifyHttpError } from "../errors";
import { requireAuth, signAccessToken } from "../plugins/auth";
import {
  authenticate,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../services/authService";

/**
 * Cookie contract from docs/API.md → Auth: HttpOnly; Secure; SameSite=Strict;
 * Path=/api/auth; Max-Age=2592000. Secure is unconditional — the app is only
 * ever reached over HTTPS (Cloudflare Tunnel) or http://localhost.
 */
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: REFRESH_COOKIE_PATH,
  maxAge: REFRESH_TTL_SECONDS,
} as const;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post("/auth/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);
    const user = await authenticate(db, body.email, body.password);
    const refreshToken = issueRefreshToken(db, user.id);
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken.token, REFRESH_COOKIE_OPTIONS);
    return loginResponseSchema.parse({
      accessToken: signAccessToken(app, user),
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE_NAME];
    if (!presented) {
      throw new FastifyHttpError(401, "UNAUTHORIZED", "Missing refresh token");
    }
    const { user, refreshToken } = rotateRefreshToken(db, presented);
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken.token, REFRESH_COOKIE_OPTIONS);
    return loginResponseSchema.parse({
      accessToken: signAccessToken(app, user),
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE_NAME];
    if (presented) {
      revokeRefreshToken(db, presented);
    }
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request) =>
    authUserSchema.parse(request.user),
  );
}
