import jwt from "@fastify/jwt";
import { API_TOKEN_PREFIX, type AuthUser, type UserRole, authUserSchema } from "@grocery/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { FastifyHttpError } from "../errors";
import { authenticateApiToken } from "../services/apiTokenService";

/**
 * JWT claims carried by the 15-min access token (docs/PROJECT.md → Auth).
 * `sub` is the user id; `email`/`role` are denormalized so `requireAuth`
 * never needs a DB roundtrip.
 */
export const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["user", "admin"]),
});

export type JwtClaims = z.infer<typeof jwtClaimsSchema>;

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtClaims;
    user: AuthUser;
  }
}

/** Registers @fastify/jwt: access tokens expire after 15 minutes. */
export function registerAuth(app: FastifyInstance, jwtSecret: string): void {
  app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: "15m" },
    formatUser: (payload) => {
      const claims = jwtClaimsSchema.parse(payload);
      return authUserSchema.parse({ id: claims.sub, email: claims.email, role: claims.role });
    },
  });
}

/** Signs the access token for a user (15-min expiry via the plugin default). */
export function signAccessToken(
  app: FastifyInstance,
  user: { id: string; email: string; role: UserRole },
): string {
  return app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
}

/**
 * Middleware (docs/API.md → Conventions): validates the `Authorization` header
 * and populates `request.user` ({ id, email, role }) or throws 401
 * UNAUTHORIZED. Accepts either a 15-min JWT access token or a `glc_…` API
 * token (T13 — acts as the user who created it; `lastUsedAt` is bumped).
 */
export const requireAuth: preHandlerHookHandler = async (request, _reply) => {
  const presented = authHeaderToken(request.headers.authorization);
  if (presented?.startsWith(API_TOKEN_PREFIX)) {
    const user = authenticateApiToken(request.server.db, presented);
    if (!user) {
      throw new FastifyHttpError(401, "UNAUTHORIZED", "Invalid API token");
    }
    request.user = authUserSchema.parse({ id: user.id, email: user.email, role: user.role });
    return;
  }
  try {
    await request.jwtVerify();
  } catch {
    throw new FastifyHttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
};

/** Extracts the credential from a `Bearer <token>` header. */
function authHeaderToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}
