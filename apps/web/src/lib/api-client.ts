import {
  API_BASE_PATH,
  type AuthUser,
  type LoginResponse,
  loginRequestSchema,
  loginResponseSchema,
} from "@grocery/shared";
import type { ZodType } from "zod";

/** Error thrown for every non-2xx response (body shape per docs/API.md → Conventions). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

/** Bridges the transport with the in-memory session state (Zustand store). */
export interface AuthAdapter {
  getAccessToken(): string | null;
  setSession(user: AuthUser, accessToken: string): void;
  clearSession(): void;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/** Endpoints whose 401 means "bad credentials", never "access token expired". */
const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/refresh"]);

async function toApiError(response: Response): Promise<ApiClientError> {
  let code = `HTTP_${response.status}`;
  let message = response.statusText || `Request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Non-JSON error body — keep the status-based fallbacks.
  }
  return new ApiClientError(response.status, code, message);
}

/**
 * Thin fetch wrapper around docs/API.md:
 * - prefixes every path with the shared API_BASE_PATH ("/api"),
 * - attaches the in-memory access token as `Authorization: Bearer …`,
 * - validates every response through a zod schema (boundaries, docs/CONVENTIONS.md),
 * - on 401 runs a single-flight `POST /auth/refresh` and retries the request once
 *   (docs/CONVENTIONS.md → Frontend); a failed refresh clears the session.
 */
export function createApiClient(adapter: AuthAdapter) {
  let refreshInFlight: Promise<AuthUser | null> | null = null;

  /** Silent refresh; concurrent callers share one request (single-flight). */
  function refreshSession(): Promise<AuthUser | null> {
    refreshInFlight ??= performRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function performRefresh(): Promise<AuthUser | null> {
    try {
      const response = await fetch(`${API_BASE_PATH}/auth/refresh`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        // Missing/expired/revoked refresh cookie → anonymous.
        adapter.clearSession();
        return null;
      }
      const session = loginResponseSchema.parse(await response.json());
      adapter.setSession(session.user, session.accessToken);
      return session.user;
    } catch {
      adapter.clearSession();
      return null;
    }
  }

  async function request<T>(
    path: string,
    options: ApiRequestOptions & { schema?: ZodType<T> },
    attempt = 0,
  ): Promise<T> {
    const { method = "GET", body, signal, schema } = options;
    const headers = new Headers({ accept: "application/json" });
    // FormData carries its own content-type (multipart boundary) — never set it here.
    const isFormData = body instanceof FormData;
    if (body !== undefined && !isFormData) headers.set("content-type", "application/json");
    const accessToken = adapter.getAccessToken();
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

    const response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
      credentials: "same-origin",
    });

    if (response.status === 401 && attempt === 0 && !NO_REFRESH_PATHS.has(path)) {
      const user = await refreshSession();
      if (user) return request<T>(path, options, attempt + 1);
    }

    if (!response.ok) throw await toApiError(response);
    if (!schema) return undefined as T;
    return schema.parse(await response.json());
  }

  return {
    refreshSession,
    async login(email: string, password: string): Promise<AuthUser> {
      const body = loginRequestSchema.parse({ email, password });
      const session = await request<LoginResponse>("/auth/login", {
        method: "POST",
        body,
        schema: loginResponseSchema,
      });
      adapter.setSession(session.user, session.accessToken);
      return session.user;
    },
    async logout(): Promise<void> {
      try {
        await request("/auth/logout", { method: "POST" });
      } finally {
        adapter.clearSession();
      }
    },
    get<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
      return request<T>(path, { schema, signal });
    },
    post<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
      return request<T>(path, { method: "POST", body, schema, signal });
    },
    /** Multipart POST (e.g. item images) — body is sent as-is, no JSON encoding. */
    upload<T>(
      path: string,
      formData: FormData,
      schema: ZodType<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      return request<T>(path, { method: "POST", body: formData, schema, signal });
    },
    postVoid(path: string, body?: unknown, signal?: AbortSignal): Promise<void> {
      return request<void>(path, { method: "POST", body, signal });
    },
    patch<T>(path: string, body: unknown, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
      return request<T>(path, { method: "PATCH", body, schema, signal });
    },
    del(path: string, signal?: AbortSignal): Promise<void> {
      return request<void>(path, { method: "DELETE", signal });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
