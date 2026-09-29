import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPLASH_BACKGROUND_COLOR,
  STATIC_CACHE_MAX_AGE_SECONDS,
  STATIC_CACHE_MAX_ENTRIES,
  STATIC_CACHE_NAME,
  THEME_COLOR,
  matchesRuntimeRoute,
  matchesStaticAssetRoute,
  pwaManifest,
  pwaPluginOptions,
  pwaWorkbox,
  staticImagesRuntimeCaching,
} from "./pwa-config";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG_MAGIC = "89504e470d0a1a0a";

describe("PWA manifest (docs/TASKS.md → T24.5)", () => {
  it("names the app 'My Groceries' and opens full-screen with the brand theme color", () => {
    expect(pwaManifest.name).toBe("My Groceries");
    expect(pwaManifest.short_name).toBe("Groceries");
    expect(pwaManifest.display).toBe("fullscreen");
    expect(pwaManifest.theme_color).toBe(THEME_COLOR);
    expect(pwaManifest.background_color).toBe(SPLASH_BACKGROUND_COLOR);
    expect(pwaManifest.start_url).toBe("/");
    expect(pwaManifest.scope).toBe("/");
  });

  it("references icon files that exist on disk and are valid PNGs", () => {
    const icons = pwaManifest.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.map((icon) => icon.src)).toEqual(
      expect.arrayContaining(["pwa-192x192.png", "pwa-512x512.png", "pwa-maskable-512x512.png"]),
    );
    expect(icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
    for (const icon of icons) {
      const file = path.join(webRoot, "public", icon.src);
      expect(existsSync(file), `missing icon: ${icon.src}`).toBe(true);
      expect(readFileSync(file).subarray(0, 8).toString("hex"), icon.src).toBe(PNG_MAGIC);
    }
  });

  it("keeps index.html in sync: theme-color meta, apple-touch-icon, favicon", () => {
    const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
    expect(html).toContain(`content="${THEME_COLOR}"`);
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('href="/favicon-96x96.png"');
  });
});

describe("/static runtime cache (T24.5 DoD: images from cache, no repeat downloads)", () => {
  it("is the only runtime cache and is cache-first for GET /static responses", () => {
    expect(pwaWorkbox.runtimeCaching).toEqual([staticImagesRuntimeCaching]);
    expect(staticImagesRuntimeCaching.handler).toBe("CacheFirst");
    expect(staticImagesRuntimeCaching.method).toBe("GET");
    expect(staticImagesRuntimeCaching.options?.cacheName).toBe(STATIC_CACHE_NAME);
    expect(staticImagesRuntimeCaching.options?.cacheableResponse).toEqual({ statuses: [200] });
    expect(staticImagesRuntimeCaching.options?.expiration).toEqual({
      maxEntries: STATIC_CACHE_MAX_ENTRIES,
      maxAgeSeconds: STATIC_CACHE_MAX_AGE_SECONDS,
    });
  });

  it("matches item-image URLs on any origin but nothing else (API data stays network-only)", () => {
    expect(matchesStaticAssetRoute("GET", "https://grocery.example.com/static/i1-abc.webp")).toBe(
      true,
    );
    // LAN (http://nas:8080) and Cloudflare (https://...) both serve /static.
    expect(matchesStaticAssetRoute("GET", "http://192.168.1.10:8080/static/i1-abc.webp")).toBe(
      true,
    );
    expect(matchesStaticAssetRoute("GET", "https://grocery.example.com/static/a.webp?v=2")).toBe(
      true,
    );
    expect(matchesStaticAssetRoute("GET", "https://grocery.example.com/api/lists")).toBe(false);
    expect(matchesStaticAssetRoute("GET", "https://grocery.example.com/staticfile")).toBe(false);
    expect(matchesStaticAssetRoute("POST", "https://grocery.example.com/static/a.webp")).toBe(
      false,
    );
    expect(matchesStaticAssetRoute("GET", "https://grocery.example.com/")).toBe(false);
  });

  it("uses a self-contained matcher (generateSW serializes its source into sw.js)", () => {
    // workbox-build emits `urlPattern.toString()` into the generated service
    // worker — module-scope references would be broken identifiers there.
    // Recreate the function in a fresh scope and invoke it, exactly as sw.js
    // would: a non-self-contained matcher throws a ReferenceError.
    const matcher = staticImagesRuntimeCaching.urlPattern;
    const standalone = new Function(`return ${String(matcher)}`)();
    expect(
      matchesRuntimeRoute(
        { ...staticImagesRuntimeCaching, urlPattern: standalone as typeof matcher },
        "GET",
        "https://grocery.example.com/static/i1-abc.webp",
      ),
    ).toBe(true);
  });
});

describe("app shell (T24.5 DoD: loads shell offline, updates take over)", () => {
  it("precaches the hashed shell (html/js/css/webmanifest/icons)", () => {
    const patterns = pwaWorkbox.globPatterns ?? [];
    for (const ext of ["html", "js", "css", "webmanifest", "png"]) {
      expect(
        patterns.some((pattern) => pattern.includes(ext)),
        `missing ${ext}`,
      ).toBe(true);
    }
    // SPA deep links resolve to the precached shell; /api and /static never do.
    expect(pwaWorkbox.navigateFallback).toBe("index.html");
    const denylist = pwaWorkbox.navigateFallbackDenylist ?? [];
    const denied = (url: string) => denylist.some((re) => re.test(url));
    expect(denied("/api/lists")).toBe(true);
    expect(denied("/static/i1-abc.webp")).toBe(true);
    expect(denied("/")).toBe(false);
    expect(denied("/items/i1")).toBe(false);
  });

  it("prompts for service-worker updates and keeps it out of the dev server", () => {
    expect(pwaPluginOptions.registerType).toBe("prompt");
    expect(pwaPluginOptions.devOptions?.enabled).toBe(false);
  });
});
