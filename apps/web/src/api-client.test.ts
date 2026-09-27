import { type AuthUser, type ListSummary, listSummarySchema } from "@grocery/shared";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "./lib/api";
import { ApiClientError } from "./lib/api-client";
import { useAuthStore } from "./stores/auth-store";
import { createApiFetchMock, json } from "./test/mock-api";

const USER: AuthUser = { id: "u1", email: "alex@example.com", role: "admin" };
const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 5, bought: 2 } },
];

afterEach(() => {
  useAuthStore.setState({ accessToken: null, user: null });
});

describe("api client transport", () => {
  it("prefixes paths with /api and sends the in-memory access token", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    useAuthStore.setState({ accessToken: "token-1", user: USER });

    const result = await api.get("/lists", listSummarySchema.array());

    expect(result).toEqual(LISTS);
    const call = mock.callsTo("GET", "/api/lists")[0];
    expect(call?.headers.get("authorization")).toBe("Bearer token-1");
    expect(call?.headers.get("accept")).toBe("application/json");
  });

  it("sends no Authorization header without a token", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists", () => json(200, LISTS));

    await api.get("/lists", listSummarySchema.array());

    const call = mock.callsTo("GET", "/api/lists")[0];
    expect(call?.headers.get("authorization")).toBeNull();
  });

  it("JSON-encodes POST bodies and parses responses through the schema", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/lists", () =>
      json(201, { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 0, bought: 0 } }),
    );

    const created = await api.post("/lists", { title: "Weekly" }, listSummarySchema);

    expect(created.title).toBe("Weekly");
    const call = mock.callsTo("POST", "/api/lists")[0];
    expect(call?.body).toEqual({ title: "Weekly" });
    expect(call?.headers.get("content-type")).toBe("application/json");
  });

  it("resolves to undefined for 204 responses without a schema", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("DELETE", "/api/lists/l1", () => json(204));

    await expect(api.del("/lists/l1")).resolves.toBeUndefined();
  });

  it("maps the API error envelope onto ApiClientError", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists/unknown", () =>
      json(404, { error: { code: "NOT_FOUND", message: "List not found" } }),
    );

    const error = await api
      .get("/lists/unknown", listSummarySchema)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(404);
    expect((error as ApiClientError).code).toBe("NOT_FOUND");
    expect((error as ApiClientError).message).toBe("List not found");
  });

  it("falls back to a status-based code for non-JSON error bodies", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists", () => ({ status: 502, body: "Bad Gateway" }));

    const error = await api
      .get("/lists", listSummarySchema.array())
      .catch((caught: unknown) => caught);

    expect((error as ApiClientError).code).toBe("HTTP_502");
  });
});

describe("api client silent refresh (401 → single-flight refresh → retry once)", () => {
  it("refreshes once for concurrent 401s and retries with the new token", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    let listsCalls = 0;
    mock.on("GET", "/api/lists", () => {
      listsCalls += 1;
      return listsCalls <= 2
        ? json(401, { error: { code: "UNAUTHORIZED", message: "Token expired" } })
        : json(200, LISTS);
    });
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-2", user: USER }));
    useAuthStore.setState({ accessToken: "expired", user: USER });

    const [first, second] = await Promise.all([
      api.get("/lists", listSummarySchema.array()),
      api.get("/lists", listSummarySchema.array()),
    ]);

    expect(first).toEqual(LISTS);
    expect(second).toEqual(LISTS);
    expect(mock.callsTo("POST", "/api/auth/refresh")).toHaveLength(1);
    expect(useAuthStore.getState().accessToken).toBe("token-2");
    const listCalls = mock.callsTo("GET", "/api/lists");
    expect(listCalls[2]?.headers.get("authorization")).toBe("Bearer token-2");
    expect(listCalls[3]?.headers.get("authorization")).toBe("Bearer token-2");
  });

  it("clears the session and surfaces 401 when the refresh cookie is gone", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Token expired" } }),
    );
    mock.on("POST", "/api/auth/refresh", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Missing refresh token" } }),
    );
    useAuthStore.setState({ accessToken: "expired", user: USER });

    await expect(api.get("/lists", listSummarySchema.array())).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("retries only once — a second 401 after a successful refresh throws", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("GET", "/api/lists", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Token expired" } }),
    );
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-2", user: USER }));
    useAuthStore.setState({ accessToken: "expired", user: USER });

    await expect(api.get("/lists", listSummarySchema.array())).rejects.toMatchObject({
      status: 401,
    });
    expect(mock.callsTo("GET", "/api/lists")).toHaveLength(2);
    expect(mock.callsTo("POST", "/api/auth/refresh")).toHaveLength(1);
  });

  it("does not refresh-and-retry on failed logins (401 there means bad credentials)", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/login", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Wrong email or password" } }),
    );

    await expect(api.login("alex@example.com", "wrong")).rejects.toMatchObject({ status: 401 });
    expect(mock.callsTo("POST", "/api/auth/refresh")).toHaveLength(0);
    expect(mock.callsTo("POST", "/api/auth/login")).toHaveLength(1);
  });
});

describe("api client auth flows", () => {
  it("login normalizes the email, stores the session, and returns the user", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/login", () => json(200, { accessToken: "token-1", user: USER }));

    const user = await api.login("  Alex@Example.COM  ", "secret");

    expect(user).toEqual(USER);
    expect(useAuthStore.getState().accessToken).toBe("token-1");
    expect(useAuthStore.getState().user).toEqual(USER);
    const call = mock.callsTo("POST", "/api/auth/login")[0];
    expect(call?.body).toEqual({ email: "alex@example.com", password: "secret" });
  });

  it("logout calls the endpoint and clears the session even when it fails", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/logout", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    useAuthStore.setState({ accessToken: "token-1", user: USER });

    await expect(api.logout()).rejects.toMatchObject({ status: 500 });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("refreshSession stores the refreshed session and returns the user", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-2", user: USER }));

    await expect(api.refreshSession()).resolves.toEqual(USER);
    expect(useAuthStore.getState().accessToken).toBe("token-2");
  });

  it("refreshSession clears the session when the cookie is missing", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/refresh", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Missing refresh token" } }),
    );
    useAuthStore.setState({ accessToken: "stale", user: USER });

    await expect(api.refreshSession()).resolves.toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
