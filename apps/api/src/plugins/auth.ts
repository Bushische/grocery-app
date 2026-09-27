import jwt from "@fastify/jwt";
import { type AuthUser, type UserRole, authUserSchema } from "@grocery/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { FastifyHttpError } from "../errors";

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
 * Middleware: validates the `Authorization: Bearer <accessToken>` header and
 * populates `request.user` ({ id, email, role }) or throws 401 UNAUTHORIZED.
 */
export const requireAuth: preHandlerHookHandler = async (request, _reply) => {
  try {
    await request.jwtVerify();
  } catch {
    throw new FastifyHttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
};
