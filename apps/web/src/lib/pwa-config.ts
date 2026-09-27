import type { ManifestOptions, VitePWAOptions, cachePreset } from "vite-plugin-pwa";

// Shape of one workbox runtimeCaching entry, derived from the plugin's
// re-exported cachePreset so we don't depend on workbox-build types directly.
type RuntimeCacheEntry = (typeof cachePreset)[number];

/** Brand green — must stay in sync with the theme-color meta in index.html. */
export const THEME_COLOR = "#16a34a";
/** Splash/window background while the shell loads. */
export const SPLASH_BACKGROUND_COLOR = "#ffffff";
/** Workbox cache name for item images served from the api's /static prefix. */
export const STATIC_CACHE_NAME = "item-images";
/** Retention bounds for the image cache (content-addressed URLs per T10). */
export const STATIC_CACHE_MAX_ENTRIES = 300;
export const STATIC_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Item images live at /static/<itemId>-<hash>.webp (content-addressed per T10):
 * a re-upload changes the URL instead of the bytes, so cache-first is safe.
 * The api (T4.5) and nginx (T21) already send immutable cache headers; the
 * service worker additionally serves them offline without a network request.
 *
 * IMPORTANT: the matcher function is serialized verbatim into the generated
 * service worker (generateSW mode), so it must be fully self-contained —
 * references to module-scope helpers would be broken identifiers in sw.js.
 */
export const staticImagesRuntimeCaching: RuntimeCacheEntry = {
  method: "GET",
  handler: "CacheFirst",
  urlPattern: ({ request, url }) => request.method === "GET" && url.pathname.startsWith("/static/"),
  options: {
    cacheName: STATIC_CACHE_NAME,
    expiration: {
      maxEntries: STATIC_CACHE_MAX_ENTRIES,
      maxAgeSeconds: STATIC_CACHE_MAX_AGE_SECONDS,
    },
    cacheableResponse: { statuses: [200] },
  },
};

/** Invoke a runtime cache's matcher the way workbox would at fetch time. */
export function matchesRuntimeRoute(
  route: RuntimeCacheEntry,
  method: string,
  href: string,
): boolean {
  const matcher = route.urlPattern;
  if (typeof matcher === "string") {
    return new RegExp(matcher).test(href);
  }
  if (matcher instanceof RegExp) {
    return matcher.test(href);
  }
  // Function matcher: workbox passes an ExtendableEvent too; this predicate
  // never reads it, so null stands in for the node-side test invocation.
  const options = { request: new Request(href, { method }), url: new URL(href), event: null };
  return Boolean(matcher(options as Parameters<NonNullable<typeof matcher>>[0]));
}

export function matchesStaticAssetRoute(method: string, href: string): boolean {
  return matchesRuntimeRoute(staticImagesRuntimeCaching, method, href);
}

/**
 * The web app manifest: name per docs/TASKS.md (T24.5), green theme color,
 * fullscreen display for the installed app (DoD), portrait-first (mobile).
 */
export const pwaManifest: Partial<ManifestOptions> = {
  id: "/",
  name: "My Groceries",
  short_name: "Groceries",
  description: "Self-hosted grocery lists with price history and sharing.",
  lang: "en",
  start_url: "/",
  scope: "/",
  display: "fullscreen",
  orientation: "portrait",
  background_color: SPLASH_BACKGROUND_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
    {
      src: "pwa-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    { src: "favicon-96x96.png", sizes: "96x96", type: "image/png" },
  ],
};

/**
 * Workbox settings for the generated service worker:
 * - Precache the hashed app shell (js/css/html/webmanifest/icons) so the app
 *   opens offline and loads instantly on repeat visits.
 * - Navigations fall back to the precached index.html (SPA deep links),
 *   except /api and /static which are never served the app shell.
 * - The ONLY runtime cache is /static item images (cache-first). API data is
 *   never cached: it is auth-scoped and must go to the network.
 */
export const pwaWorkbox: NonNullable<VitePWAOptions["workbox"]> = {
  globPatterns: ["**/*.{js,css,html,webmanifest,png,svg,ico,woff,woff2}"],
  navigateFallback: "index.html",
  navigateFallbackDenylist: [/^\/api\//, /^\/static\//],
  runtimeCaching: [staticImagesRuntimeCaching],
};

/**
 * vite-plugin-pwa options wired in vite.config.ts:
 * - autoUpdate: a freshly deployed service worker activates immediately
 *   (skipWaiting + clientsClaim) — no update prompt to babysit.
 * - dev SW disabled: the vite dev server already proxies /api and /static;
 *   an extra SW layer there only muddies debugging.
 */
export const pwaPluginOptions: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  manifest: pwaManifest,
  workbox: pwaWorkbox,
  devOptions: { enabled: false },
};
