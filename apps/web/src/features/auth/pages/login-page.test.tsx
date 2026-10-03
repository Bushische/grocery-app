// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import { LoginPage } from "./login-page";
import "../../../test/setup";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("renders the email and password fields", async () => {
    const mock = createApiFetchMock();
    mock.stub();

    renderPage();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("blocks submit with validation errors when fields are empty", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(mock.callsTo("POST", "/api/auth/login")).toHaveLength(0);
  });

  it("shows an error for wrong credentials (401)", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/login", () =>
      json(401, { error: { code: "UNAUTHORIZED", message: "Wrong email or password" } }),
    );
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText("Email"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("logs in and stores the session on success", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/login", () => json(200, { accessToken: "token-1", user: USER }));
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByLabelText("Email"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe("token-1"));
    expect(useAuthStore.getState().user).toEqual(USER);
    const call = mock.callsTo("POST", "/api/auth/login")[0];
    expect(call?.body).toEqual({ email: "alex@example.com", password: "secret" });
  });
});

describe("LoginPage inside Telegram (one-time link, T60)", () => {
  const INIT_DATA = "auth_date=1737000000&user=%7B%22id%22%3A279058397%7D&hash=abc";

  function stubTelegramInitData(): void {
    (window as unknown as { Telegram?: unknown }).Telegram = {
      WebApp: { initData: INIT_DATA, ready: () => {}, expand: () => {} },
    };
  }

  function clearTelegramBridge(): void {
    (window as unknown as { Telegram?: unknown }).Telegram = undefined;
  }

  it("shows the link hint and posts to the link endpoint with initData", async () => {
    stubTelegramInitData();
    try {
      const mock = createApiFetchMock();
      mock.stub();
      mock.on("POST", "/api/auth/telegram/link", () =>
        json(200, { accessToken: "tg-token", user: USER }),
      );
      const user = userEvent.setup();

      renderPage();
      expect(screen.getByText(/Sign in once to link your Telegram account/)).toBeInTheDocument();

      await user.type(screen.getByLabelText("Email"), "alex@example.com");
      await user.type(screen.getByLabelText("Password"), "secret");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => expect(useAuthStore.getState().accessToken).toBe("tg-token"));
      const call = mock.callsTo("POST", "/api/auth/telegram/link")[0];
      expect(call?.body).toEqual({
        email: "alex@example.com",
        password: "secret",
        initData: INIT_DATA,
      });
      expect(mock.callsTo("POST", "/api/auth/login")).toHaveLength(0);
    } finally {
      clearTelegramBridge();
    }
  });

  it("shows the link error for wrong credentials (401) without a session", async () => {
    stubTelegramInitData();
    try {
      const mock = createApiFetchMock();
      mock.stub();
      mock.on("POST", "/api/auth/telegram/link", () =>
        json(401, { error: { code: "UNAUTHORIZED", message: "Invalid email or password" } }),
      );
      const user = userEvent.setup();

      renderPage();
      await user.type(screen.getByLabelText("Email"), "alex@example.com");
      await user.type(screen.getByLabelText("Password"), "wrong");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
      expect(useAuthStore.getState().accessToken).toBeNull();
    } finally {
      clearTelegramBridge();
    }
  });
});
