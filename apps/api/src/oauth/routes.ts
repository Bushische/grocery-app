import {
  OAUTH_SCOPE_ALICE,
  YANDEX_BROKER_REDIRECT,
  oauthAuthorizeFormSchema,
  oauthAuthorizeQuerySchema,
  oauthTokenRequestSchema,
  oauthTokenResponseSchema,
} from "@grocery/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { oauthClients } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { authenticate } from "../services/authService";
import {
  consumeAuthorizationCode,
  issueAuthorizationCode,
  issueTokenPair,
  refreshTokenPair,
  verifyOAuthClient,
} from "./oauthService";

/** Escape user-controlled values interpolated into the consent HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Consent page served by the API (no web-app changes in v1): email login form
 * plus the "Allow Alice" confirmation. Posts back to POST /oauth/authorize.
 */
function consentPage(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  email: string;
  error: string | null;
}): string {
  const { clientId, redirectUri, scope, state, email, error } = params;
  const hiddenFields: Array<{ name: string; value: string }> = [
    { name: "client_id", value: clientId },
    { name: "redirect_uri", value: redirectUri },
    { name: "scope", value: scope },
    { name: "state", value: state },
  ];
  const hidden = hiddenFields
    .map(({ name, value }) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`)
    .join("\n    ");
  const alert = error ? `<p role="alert" style="color:#b91c1c">${escapeHtml(error)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8" /><title>Привязка аккаунта — Grocery List</title></head>
<body>
  <h1>Привязка аккаунта к Алисе</h1>
  <p>Приложение «Алиса» запрашивает доступ к вашим спискам покупок.</p>
  ${alert}
  <form method="post" action="/oauth/authorize">
    ${hidden}
    <label>Электронная почта
      <input type="email" name="email" required autocomplete="username" value="${escapeHtml(email)}" />
    </label>
    <label>Пароль
      <input type="password" name="password" required autocomplete="current-password" />
    </label>
    <button type="submit">Разрешить доступ</button>
  </form>
</body>
</html>
`;
}

function requireBrokerRedirectUri(redirectUri: string): void {
  if (redirectUri !== YANDEX_BROKER_REDIRECT) {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", "Unsupported redirect_uri");
  }
}

function requireKnownClient(db: FastifyInstance["db"], clientId: string): void {
  const row = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
  if (!row) {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", `Unknown client_id "${clientId}"`);
  }
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  // Yandex posts forms as application/x-www-form-urlencoded; Fastify has no
  // built-in parser for it, so decode into a plain string-valued object.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => {
        try {
          const parsed: Record<string, string> = {};
          for (const [key, value] of new URLSearchParams(body as string)) {
            parsed[key] = value;
          }
          done(null, parsed);
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }

  app.get("/oauth/authorize", async (request, reply) => {
    const query = oauthAuthorizeQuerySchema.parse(request.query);
    requireKnownClient(db, query.client_id);
    requireBrokerRedirectUri(query.redirect_uri);
    const html = consentPage({
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope ?? OAUTH_SCOPE_ALICE,
      state: query.state ?? "",
      email: "",
      error: null,
    });
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.post("/oauth/authorize", async (request, reply) => {
    const body = oauthAuthorizeFormSchema.parse(request.body);
    requireKnownClient(db, body.client_id);
    requireBrokerRedirectUri(body.redirect_uri);
    // 401 UNAUTHORIZED on unknown email or wrong password — no code is issued.
    const user = await authenticate(db, body.email, body.password);
    const { code } = issueAuthorizationCode(db, {
      userId: user.id,
      clientId: body.client_id,
      scope: body.scope ?? OAUTH_SCOPE_ALICE,
    });
    const target = new URL(body.redirect_uri);
    target.searchParams.set("code", code);
    // `state` is echoed verbatim so Yandex can match the linking session.
    if (body.state !== undefined && body.state !== "") {
      target.searchParams.set("state", body.state);
    }
    return reply.redirect(target.toString());
  });

  app.post("/oauth/token", async (request) => {
    const body = oauthTokenRequestSchema.parse(request.body);
    // Client authentication failure stays 401; grant redemption failures below
    // map to 400 (invalid_grant semantics Yandex expects).
    const client = verifyOAuthClient(db, body.client_id, body.client_secret);
    if (!client) {
      throw new FastifyHttpError(401, "UNAUTHORIZED", "Invalid client credentials");
    }

    if (body.grant_type === "authorization_code") {
      let binding: { userId: string; clientId: string; scope: string };
      try {
        binding = consumeAuthorizationCode(db, {
          code: body.code as string,
          clientId: body.client_id,
        });
      } catch (error) {
        if (error instanceof FastifyHttpError) {
          throw new FastifyHttpError(400, "VALIDATION_ERROR", error.message);
        }
        throw error;
      }
      const pair = issueTokenPair(db, {
        userId: binding.userId,
        clientId: binding.clientId,
        scope: binding.scope,
      });
      const response = oauthTokenResponseSchema.parse({
        access_token: pair.accessToken,
        refresh_token: pair.refreshToken,
        token_type: "Bearer",
        expires_in: pair.expiresIn,
      });
      const serialized = JSON.stringify(response);
      if (serialized.length > 5000) {
        throw new FastifyHttpError(400, "VALIDATION_ERROR", "Token response exceeds size limit");
      }
      return response;
    }

    try {
      const rotated = refreshTokenPair(db, {
        refreshToken: body.refresh_token as string,
        clientId: body.client_id,
      });
      const response = oauthTokenResponseSchema.parse({
        access_token: rotated.accessToken,
        refresh_token: rotated.refreshToken,
        token_type: "Bearer",
        expires_in: rotated.expiresIn,
      });
      const serialized = JSON.stringify(response);
      if (serialized.length > 5000) {
        throw new FastifyHttpError(400, "VALIDATION_ERROR", "Token response exceeds size limit");
      }
      return response;
    } catch (error) {
      if (error instanceof FastifyHttpError && error.status === 401) {
        throw new FastifyHttpError(400, "VALIDATION_ERROR", error.message);
      }
      throw error;
    }
  });
}
