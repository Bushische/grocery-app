import { vi } from "vitest";

export interface MockResponseSpec {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type MockRouteHandler = (context: { body: unknown; headers: Headers }) => MockResponseSpec;

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

/**
 * Minimal fetch double for the API: routes are matched by `${METHOD} ${path}`
 * (paths include the /api prefix as built by the api client). Unmatched requests
 * throw, so tests fail loudly on unexpected calls.
 */
export function createApiFetchMock() {
  const routes = new Map<string, MockRouteHandler>();
  const calls: RecordedCall[] = [];

  function on(method: string, path: string, handler: MockRouteHandler): void {
    routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  function callsTo(method: string, path: string): RecordedCall[] {
    return calls.filter((call) => call.method === method && call.path === path);
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else if (init?.body !== undefined) {
        // FormData / Blob bodies are recorded as-is (multipart uploads).
        body = init.body;
      }
      calls.push({ method, path: url.pathname, body, headers });
      const handler = routes.get(`${method} ${url.pathname}`);
      if (!handler) {
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }
      const spec = handler({ body, headers });
      const status = spec.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(spec.headers),
        json: async () => spec.body,
      } as Response;
    },
  );

  function stub(): void {
    vi.stubGlobal("fetch", fetchMock);
  }

  return { on, callsTo, stub, calls };
}

/** Convenience response builder. */
export function json(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): MockResponseSpec {
  return { status, body, headers };
}
