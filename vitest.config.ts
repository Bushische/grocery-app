import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      // `virtual:pwa-register/react` only exists under the web vite config
      // (vite-plugin-pwa, T47); the root vitest run maps it to an idle-state
      // stub so component tests resolve it without a service worker.
      "virtual:pwa-register/react": path.resolve(
        __dirname,
        "apps/web/src/test/pwa-register-stub.ts",
      ),
    },
  },
});
