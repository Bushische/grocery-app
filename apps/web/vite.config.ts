import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "") };
  // Dev proxy target: API_URL (see .env.example) or API_HOST/API_PORT (docker-compose),
  // falling back to the laptop dev server on :3000.
  const apiTarget =
    env.API_URL ??
    (process.env.API_HOST
      ? `http://${process.env.API_HOST}:${process.env.API_PORT ?? "3000"}`
      : "http://localhost:3000");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        // The Fastify app serves routes at the root (no /api prefix), so the
        // prefix is stripped here; production nginx (T21) must do the same rewrite.
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        // /static is a real prefix on the api (@fastify/static) — forwarded as-is.
        "/static": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
