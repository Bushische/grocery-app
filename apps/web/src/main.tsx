import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { ApiClientError } from "./lib/api-client";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry 4xx (auth/permission/validation); retry transient failures once.
      retry: (failureCount, error) =>
        !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) &&
        failureCount < 1,
      staleTime: 30_000,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
