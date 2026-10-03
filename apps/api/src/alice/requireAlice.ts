import { type AuthUser, authUserSchema } from "@grocery/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { validateAccessToken } from "../oauth/oauthService";

/**
 * Resolves the Alice caller to the linked user (docs/ALICE_PLAN.md → §2.5):
 * the OAuth access token travels BOTH as `Authorization: Bearer <token>`
 * and as `session.user.access_token`. Returns the same `request.user` shape
 * (`AuthUser` { id, email, role }) as `requireAuth`, so the existing
 * list/item guards apply as-is — or null when no (valid) token is present.
 * A null result means "unlinked or revoked": the caller answers the link
 * card again, never a 401 (Yandex surfaces get no HTTP error UX).
 */
export function resolveAliceUser(
  db: Db,
  params: { authHeader?: string; sessionToken?: string },
): AuthUser | null {
  const presented = bearerToken(params.authHeader) ?? params.sessionToken?.trim() ?? undefined;
  if (!presented) return null;
  const binding = validateAccessToken(db, presented);
  if (!binding) return null;
  const row = db.select().from(users).where(eq(users.id, binding.userId)).get();
  if (!row) return null;
  return authUserSchema.parse({ id: row.id, email: row.email, role: row.role });
}

/** Extracts the credential from a `Bearer <token>` header (mirrors `requireAuth`). */
function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}
